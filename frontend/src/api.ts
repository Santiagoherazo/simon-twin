import { API_URL } from './config'
import type { CropInfo, DeviceInfo, SimRequest, SimResponse, SoilCatalogItem, TwinState } from './types'

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

export interface PumpResult {
  cmd_id: string
  seconds: number
  ts: number
}

export async function pump(id: string, seconds: number, apiKey: string): Promise<PumpResult> {
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
