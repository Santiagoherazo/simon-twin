import { API_URL } from './config'
import type { CropInfo, CropParam, DeviceConfigFull, DeviceInfo, DriverInfo, OptimizeResponse, RecommendResponse, FitResponse, SimRequest, SimResponse, SoilCatalogItem, TwinState } from './types'

/** Error de API con mensaje ya legible en español. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Convierte el `detail` de FastAPI (texto o lista de errores de validación) en texto legible. */
function describeDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (d && typeof d === 'object') {
          const o = d as { loc?: unknown[]; msg?: string }
          const loc = (o.loc ?? []).filter((x) => x !== 'body').join(' › ')
          return loc ? `${loc}: ${o.msg ?? 'valor inválido'}` : (o.msg ?? 'valor inválido')
        }
        return String(d)
      })
      .join('\n')
  }
  return ''
}

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, { ...init, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'No se pudo contactar con el backend. Revisa que esté encendido y que la URL sea correcta.')
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = describeDetail(body?.detail)
    } catch {
      /* cuerpo no JSON */
    }
    throw new ApiError(res.status, detail || `Error ${res.status} del backend`)
  }
  return (await res.json()) as T
}

export const getDevices = (signal?: AbortSignal) => request<DeviceInfo[]>('/devices', undefined, signal)
export const getCrops = (signal?: AbortSignal) => request<CropInfo[]>('/crops', undefined, signal)
export const getSoils = (signal?: AbortSignal) => request<SoilCatalogItem[]>('/soils', undefined, signal)
export const getState = (id: string, signal?: AbortSignal) =>
  request<TwinState>(`/devices/${encodeURIComponent(id)}/state`, undefined, signal)

export function simulate(id: string, body: SimRequest, signal?: AbortSignal) {
  return request<SimResponse>(
    `/devices/${encodeURIComponent(id)}/simulate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    signal,
  ).catch((e) => {
    if (e instanceof ApiError && e.status === 404) throw new ApiError(404, e.message || 'Dispositivo no encontrado')
    throw e
  })
}

export const getCropParams = (id: string, signal?: AbortSignal) =>
  request<CropParam[]>(`/crops/${encodeURIComponent(id)}/params`, undefined, signal)
export const getRecommend = (id: string, drainage?: string, signal?: AbortSignal) =>
  request<RecommendResponse>(`/devices/${encodeURIComponent(id)}/recommend${drainage ? `?drainage=${drainage}` : ''}`, undefined, signal)
export const getHardwarePreset = (signal?: AbortSignal) =>
  request<Pick<DeviceConfigFull, 'report_interval_s' | 'sensors' | 'actuators' | 'indicators'>>('/catalog/hardware', undefined, signal)
export const getFit = (id: string, signal?: AbortSignal) =>
  request<FitResponse>(`/devices/${encodeURIComponent(id)}/identify`, undefined, signal)
export const optimizeIrrigation = (id: string, simulation: SimRequest, signal?: AbortSignal) =>
  request<OptimizeResponse>(
    `/devices/${encodeURIComponent(id)}/optimize`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ simulation }) },
    signal,
  )

export interface PumpResult {
  cmd_id: string
  seconds: number
  ts: number
}

/** Si no hay nube pero sí ESP32 alcanzable, el riego manual va directo a su servidor local (sin API key). */
export const localRoute: { host: string | null } = { host: null }

export async function pump(id: string, seconds: number, apiKey: string): Promise<PumpResult> {
  if (localRoute.host) {
    const r = await fetch(`http://${localRoute.host}/api/pump?s=${Math.max(1, Math.floor(seconds))}`, { method: 'POST' })
    if (!r.ok) throw new ApiError(r.status, `El ESP32 rechazó el riego (${r.status}).`)
    return { cmd_id: 'local', seconds, ts: Date.now() / 1000 } as PumpResult
  }
  try {
    return await request<PumpResult>(`/devices/${encodeURIComponent(id)}/pump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ seconds }),
    })
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) throw new ApiError(401, 'Clave rechazada (401): la API key es incorrecta.')
      if (e.status === 409) throw new ApiError(409, 'El dispositivo está offline (409): no se puede regar ahora.')
      if (e.status === 503) throw new ApiError(503, 'El backend no tiene conexión con el broker MQTT (503).')
      if (e.status === 404) throw new ApiError(404, 'Dispositivo desconocido (404).')
    }
    throw e
  }
}

export interface HistoryPoint {
  t: string
  vwc_pct: number | null
  soil_t: number | null
  air_t: number | null
  air_rh: number | null
  lux: number | null
}
export interface HistoryResponse {
  bucket_seconds: number
  points: HistoryPoint[]
}
export const getHistory = (id: string, hours = 24, bucketSeconds = 900, signal?: AbortSignal) =>
  request<HistoryResponse>(`/devices/${encodeURIComponent(id)}/history?hours=${hours}&bucket_seconds=${bucketSeconds}`, undefined, signal)

// ---- panel administrativo ----
export const getCatalog = (signal?: AbortSignal) => request<{ drivers: DriverInfo[] }>('/catalog', undefined, signal)

export const getConfig = (id: string, signal?: AbortSignal) =>
  request<DeviceConfigFull>(`/devices/${encodeURIComponent(id)}/config?full=1`, undefined, signal)

export async function putConfig(
  id: string,
  cfg: Pick<DeviceConfigFull, 'report_interval_s' | 'sensors' | 'actuators' | 'indicators'>,
  apiKey: string,
): Promise<{ ok: boolean; version: number; warnings: string[] }> {
  try {
    return await request(`/admin/devices/${encodeURIComponent(id)}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(cfg),
    })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw new ApiError(401, 'Clave rechazada (401): la API key es incorrecta.')
    throw e
  }
}

export const commandActuator = (id: string, key: string, seconds: number, apiKey: string) =>
  request<{ cmd_id: string }>(`/devices/${encodeURIComponent(id)}/actuators/${encodeURIComponent(key)}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ seconds }),
  })

// ---- cuadernos de modelos (estilo Colab) ----
export interface NbCell {
  type: 'code' | 'text'
  source: string
}
export interface NbMeta {
  id: string
  name: string
  device_id: string | null
  updated_at: string
  live?: boolean
}
export interface Notebook extends NbMeta {
  cells: NbCell[]
}
export interface NbTemplate {
  id: string
  name: string
  cells: NbCell[]
}
export interface NbAlert {
  level: 'info' | 'warn' | 'critical'
  message: string
  variable?: string | null
}
export interface RunResult {
  ok: boolean
  stdout: string
  result: string | null
  error: string | null
  metrics: Record<string, number>[]
  alerts: NbAlert[]
  figures: string[]
  has_predict: boolean
  ms: number
  restarted?: boolean
}
export interface PredictResult {
  ok: boolean
  output?: unknown
  error?: string
  alerts?: NbAlert[]
  stdout?: string
  input?: Record<string, unknown>
}

const nb = <T>(path: string, apiKey: string, method = 'GET', body?: unknown) =>
  request<T>(`/admin/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e) => {
    if (e instanceof ApiError && e.status === 401) throw new ApiError(401, 'El servidor pide la API key para los modelos (o la que escribiste no coincide con API_KEY del .env). Escríbela arriba.')
    if (e instanceof ApiError && e.status === 404) throw new ApiError(404, 'El servidor no tiene los cuadernos: está corriendo una versión vieja del backend. Reconstruye con «docker compose up --build» (o redespliega).')
    throw e
  })

export const nbList = (k: string) => nb<NbMeta[]>('notebooks', k)
export const nbTemplates = (k: string) => nb<NbTemplate[]>('notebook-templates', k)
export const nbGet = (k: string, id: string) => nb<Notebook>(`notebooks/${id}`, k)
export const nbSave = (k: string, id: string, b: { name: string; device_id: string | null; cells: NbCell[] }) => nb<Notebook>(`notebooks/${id}`, k, 'PUT', b)
export const nbDelete = (k: string, id: string) => nb<{ ok: boolean }>(`notebooks/${id}`, k, 'DELETE')
export const nbRun = (k: string, id: string, code: string, timeout_s = 90) => nb<RunResult>(`notebooks/${id}/run`, k, 'POST', { code, timeout_s })
export const nbRestart = (k: string, id: string) => nb<{ ok: boolean }>(`notebooks/${id}/restart`, k, 'POST')
export const nbPredict = (k: string, id: string) => nb<PredictResult>(`notebooks/${id}/predict`, k, 'POST', {})

export const nbDeploy = (k: string, id: string, live: boolean) => nb<{ ok: boolean; live: boolean }>(`notebooks/${id}/deploy`, k, 'POST', { live })
