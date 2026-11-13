import { useSyncExternalStore } from 'react'
import type { AlertItem, PlantParams, SimResponse, TwinState, Telemetry } from './types'

/**
 * Estado "visual" del gemelo: lo único que la escena 3D necesita saber.
 * Se construye a partir del estado en vivo (MQTT) o de un punto de la simulación,
 * así la escena no distingue de dónde vienen los datos.
 */
export interface VisualPlant {
  heightCm: number
  leafCount: number
  lai: number
  wilt: number // 0 sano .. 1 marchito
  health: number // 0..1 (tono)
  hasTassel: boolean
  hasFruit: boolean
  yellow: number // amarillamiento (nutrientes, falta de oxígeno, enfermedad)
  scorch: number // quemadura por frío/calor/helada
  rot: number // raíz podrida
  stunt: number // enanismo frente al potencial
  dead: boolean
}

export interface VisualSensor {
  key: string
  label: string
  unit: string
  value: number | boolean | null
  status: 'low' | 'ok' | 'high' | null
}
export interface VisualActuator {
  key: string
  label: string
  on: boolean
  kind: 'fan' | 'light' | 'heater' | 'humidifier' | 'valve' | 'servo' | 'generic'
}

/** Clasifica un actuador por su clave o nombre para elegir su modelo 3D y su efecto en la escena. */
export function actuatorKind(key: string, label: string): VisualActuator['kind'] {
  const t = `${key} ${label}`.toLowerCase()
  if (/servo/.test(t)) return 'servo'
  if (/ventil|fan|extractor|aire_?fors/.test(t)) return 'fan'
  if (/luz|light|l[aá]mpara|lamp|led|grow|foco/.test(t)) return 'light'
  if (/calef|heat|resist|hornill/.test(t)) return 'heater'
  if (/humid|nebul|mist|fog|vapor/.test(t)) return 'humidifier'
  if (/v[aá]lvula|valve|electrov|solenoid/.test(t)) return 'valve'
  return 'generic'
}

export interface VisualState {
  mode: 'live' | 'sim'
  hasData: boolean
  cropId: string
  stageCode: string
  awPct: number
  vwcPct: number
  plant: VisualPlant
  lux: number
  airT: number | null
  pumpOn: boolean
  tankOk: boolean
  rainMm: number
  alerts: { probe: boolean; tank: boolean; pump: boolean }
  airRh: number | null
  soilT: number | null
  ec: number | null
  sensors: VisualSensor[]
  /** Actuadores distintos de la bomba (que tiene su propio modelo). */
  acts: VisualActuator[]
}

export const EMPTY_VISUAL: VisualState = {
  mode: 'live',
  hasData: false,
  cropId: 'maiz',
  stageCode: '',
  awPct: 55,
  vwcPct: 40,
  plant: { heightCm: 12, leafCount: 3, lai: 0.3, wilt: 0, health: 1, hasTassel: false, hasFruit: false, yellow: 0, scorch: 0, rot: 0, stunt: 0, dead: false },
  lux: 30000,
  airT: null,
  pumpOn: false,
  tankOk: true,
  rainMm: 0,
  alerts: { probe: false, tank: false, pump: false },
  airRh: null,
  soilT: null,
  ec: null,
  sensors: [],
  acts: [],
}

// ---- Almacén mínimo (la escena lee en useFrame; React solo se entera de lo discreto) ----
let current: VisualState = EMPTY_VISUAL
const subs = new Set<() => void>()
export const getVisual = () => current
export function setVisual(v: VisualState) {
  current = v
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}
/** Selector con primitivas (number/string/boolean) para no re-renderizar a 60 fps. */
export function useVisual<T extends string | number | boolean>(sel: (v: VisualState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(current), () => sel(current))
}

// ---- Color de la tierra (compartido por la escena 3D y el medidor del HUD) ----
const STOPS: [number, [number, number, number]][] = [
  [0, [196, 158, 108]], // seca: arena clara
  [0.35, [158, 114, 72]],
  [0.7, [104, 70, 44]],
  [1, [62, 41, 26]], // húmeda: chocolate
]

export function soilRgb(w: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, w))
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [x0, c0] = STOPS[i - 1]
      const [x1, c1] = STOPS[i]
      const t = (x - x0) / (x1 - x0)
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]
    }
  }
  return STOPS[STOPS.length - 1][1]
}
export function soilHex(w: number): string {
  const [r, g, b] = soilRgb(w)
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
}
/** Humedad "visual" 0..1 a partir del agua útil (100 % = capacidad de campo). */
export const wetness = (awPct: number) => Math.min(1, Math.max(0, awPct / 100))

/**
 * Altura de la planta en la escena (1 unidad = 10 cm). La maceta mide 20 cm, así que se comprime
 * con una potencia < 1: una plántula se ve casi a escala real y un maíz de 2,2 m ocupa ~1 m.
 * Por eso el HUD siempre muestra la altura real.
 */
export function plantVisualHeight(heightCm: number): number {
  const h = Math.max(0, Math.min(heightCm, 300))
  return 0.5 + 8.8 * Math.pow(h / 220, 0.7)
}

// ---- Constructores ----
const num = (x: number | null | undefined, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)

function visualPlant(p: PlantParams | null | undefined, awFallback?: number): VisualPlant {
  if (!p) return EMPTY_VISUAL.plant
  const wilt = Math.min(1, Math.max(0, num(p.wilt, 0)))
  // En la simulación health llega null: se deduce de la marchitez
  const health = p.health == null ? 1 - wilt * 0.65 : Math.min(1, Math.max(0, p.health))
  void awFallback
  return {
    heightCm: num(p.height_cm, 10),
    leafCount: Math.max(0, Math.round(num(p.leaf_count, 3))),
    lai: num(p.lai, 0.5),
    wilt,
    health,
    hasTassel: !!p.has_tassel,
    hasFruit: !!p.has_fruit,
    yellow: num(p.yellow, 0),
    scorch: num(p.scorch, 0),
    rot: num(p.rot, 0),
    stunt: num(p.stunt, 0),
    dead: !!p.dead,
  }
}

/** Qué elemento señala cada alerta crítica. */
export function alertTargets(alerts: AlertItem[] | undefined) {
  const out = { probe: false, tank: false, pump: false }
  for (const a of alerts ?? []) {
    if (a.level !== 'critical') continue
    if (a.code.startsWith('tank')) out.tank = true
    else if (a.code.startsWith('pump')) out.pump = true
    else out.probe = true
  }
  return out
}

/** Telemetría reciente (< 8 s) manda sobre el state para la bomba y el tanque: llega antes. */
const TEL_FRESH_MS = 8000

export function visualFromLive(s: TwinState | null, tel: (Telemetry & { _rx: number }) | null): VisualState {
  if (!s) return EMPTY_VISUAL
  const r = s.readings ?? {}
  const fresh = tel && performance.now() - tel._rx < TEL_FRESH_MS ? tel : null
  const hasSoil = !!s.soil
  return {
    mode: 'live',
    hasData: hasSoil && !!s.plant,
    cropId: s.crop?.id ?? 'maiz',
    stageCode: s.stage?.code ?? '',
    awPct: hasSoil ? num(s.soil!.aw_pct, 55) : EMPTY_VISUAL.awPct,
    vwcPct: num(r.vwc_pct, EMPTY_VISUAL.vwcPct),
    plant: visualPlant(s.plant),
    lux: num(fresh?.lux ?? r.lux, 0),
    airT: fresh?.air_t ?? r.air_t ?? null,
    pumpOn: !!(fresh?.pump_on ?? r.pump_on),
    tankOk: (fresh?.tank_ok ?? r.tank_ok) !== false,
    rainMm: 0,
    alerts: alertTargets(s.alerts),
    airRh: r.air_rh ?? null,
    soilT: r.soil_t ?? null,
    ec: r.ec ?? null,
    sensors: liveSensors(s),
    acts: liveActs(s),
  }
}

const BUILTIN: [keyof NonNullable<TwinState['readings']>, string, string][] = [
  ['vwc_pct', 'Humedad del suelo', '%'], ['soil_t', 'Temp. del suelo', '°C'], ['air_t', 'Temp. del aire', '°C'],
  ['air_rh', 'Humedad del aire', '%'], ['lux', 'Luz', 'lx'], ['ph', 'pH', ''], ['ec', 'EC', 'µS/cm'],
  ['n', 'Nitrógeno', ''], ['p', 'Fósforo', ''], ['k', 'Potasio', ''],
]

function liveSensors(s: TwinState): VisualSensor[] {
  const r = s.readings ?? {}
  const out: VisualSensor[] = []
  // La luz de este equipo la miden las 4 LDR (en %): el valor en lux del servidor es una estimación para el modelo, no una lectura.
  const hasLdr = (s.custom ?? []).some((c) => c.key.startsWith('ldr_'))
  for (const [k, label, unit] of BUILTIN) {
    if (k === 'lux' && hasLdr) continue
    const v = r[k]
    if (v !== undefined && v !== null) out.push({ key: k, label, unit, value: v, status: null })
  }
  for (const c of s.custom ?? []) out.push({ key: c.key, label: c.label, unit: c.unit, value: c.value, status: c.status })
  return out
}

function liveActs(s: TwinState): VisualActuator[] {
  return (s.actuators ?? [])
    .filter((a) => !/^pump$|bomba/i.test(`${a.key}`) && !/bomba/i.test(a.label))
    .map((a) => ({ key: a.key, label: a.label, on: !!a.on, kind: actuatorKind(a.key, a.label) }))
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Estado visual de la simulación en la posición fraccionaria `pos` (índice de punto). */
export function visualFromSim(sim: SimResponse, pos: number): VisualState {
  const n = sim.series.length
  const p = Math.min(n - 1, Math.max(0, pos))
  const i = Math.floor(p)
  const f = p - i
  const a = sim.series[i]
  const b = sim.series[Math.min(n - 1, i + 1)]
  const near = f < 0.5 ? a : b
  const pa = visualPlant(a.plant)
  const pb = visualPlant(b.plant)
  const irrigating = near.irrigation_mm > 0
  return {
    mode: 'sim',
    hasData: true,
    cropId: sim.inputs.crop,
    stageCode: a.stage,
    awPct: lerp(a.aw_pct, b.aw_pct, f),
    vwcPct: lerp(a.vwc_pct, b.vwc_pct, f),
    plant: {
      heightCm: lerp(pa.heightCm, pb.heightCm, f),
      leafCount: Math.round(lerp(pa.leafCount, pb.leafCount, f)),
      lai: lerp(pa.lai, pb.lai, f),
      wilt: lerp(pa.wilt, pb.wilt, f),
      health: lerp(pa.health, pb.health, f),
      hasTassel: near.plant.has_tassel,
      hasFruit: near.plant.has_fruit,
      yellow: lerp(pa.yellow, pb.yellow, f),
      scorch: lerp(pa.scorch, pb.scorch, f),
      rot: lerp(pa.rot, pb.rot, f),
      stunt: lerp(pa.stunt, pb.stunt, f),
      dead: near.plant.dead === true,
    },
    lux: lerp(a.lux, b.lux, f),
    airT: lerp(a.air_t, b.air_t, f),
    pumpOn: irrigating,
    tankOk: true,
    rainMm: near.rain_mm,
    alerts: { probe: a.ks < 0.5, tank: false, pump: false },
    airRh: null,
    soilT: null,
    ec: null,
    sensors: [
      { key: 'vwc_pct', label: 'Humedad del suelo', unit: '%', value: lerp(a.vwc_pct, b.vwc_pct, f), status: null },
      { key: 'air_t', label: 'Temp. del aire', unit: '°C', value: lerp(a.air_t, b.air_t, f), status: null },
      { key: 'lux', label: 'Luz', unit: 'lx', value: lerp(a.lux, b.lux, f), status: null },
    ],
    acts: [],
  }
}
