// Tipos del contrato del backend (state por MQTT/REST y respuesta de /simulate).
// Todo lo que el backend puede omitir o mandar en null se declara opcional/nullable:
// cuando el dispositivo aún no tiene datos el estado llega sin readings, stage, soil, etc.

export interface DeviceInfo {
  device_id: string
  name: string | null
  crop: string
  soil_type: string
  online: boolean
  status_ts: string | null
  soil_depth_cm: number
  pot_area_cm2: number
}

export interface Readings {
  vwc_pct?: number | null
  soil_t?: number | null
  ph?: number | null
  ec?: number | null
  n?: number | null
  p?: number | null
  k?: number | null
  air_t?: number | null
  air_rh?: number | null
  vpd_kpa?: number | null
  lux?: number | null
  tank_ok?: boolean | null
  pump_on?: boolean | null
  pump_ma?: number | null
}

export interface StageInfo {
  code: string
  name: string
  index: number
  count: number
  gdd: number
  progress_pct: number
  days_since_sowing: number | null
  kc: number
  root_depth_cm: number
}

export interface SoilInfo {
  vwc_pct: number
  theta: number
  theta_sat: number
  theta_fc: number
  theta_wp: number
  aw_pct: number
  dr_mm: number
  raw_mm: number
  taw_mm: number
  ks: number
  water_stress: number
  needs_irrigation: boolean
  root_depth_cm: number
}

export type VarStatus = 'ok' | 'low' | 'high' | 'n/a'

export interface SuitabilityVar {
  id: string
  label: string
  unit: string
  value: number | null
  score: number | null
  status: VarStatus
  optimal: [number, number] | null
}

export interface Suitability {
  overall: number | null
  variables: SuitabilityVar[]
}

export type AlertLevel = 'critical' | 'warn' | 'info'
export interface AlertItem {
  code: string
  level: AlertLevel
  message: string
}

export interface Prediction {
  hours_to_irrigation: number | null
  next_irrigation_ts: number | null
  horizon_h: number
  et_scale: number | null
  et_scale_confidence: string | null
  forecast_basis: string | null
}

export interface PlantParams {
  height_cm: number
  leaf_count: number
  lai: number
  wilt: number
  health: number | null
  has_tassel: boolean
  has_fruit: boolean
}

export interface TwinState {
  v: number
  device_id: string
  ts: number
  online: boolean
  ready: boolean
  crop?: { id: string; name: string; note?: string }
  soil_type?: { id: string; name: string }
  device?: {
    soil_depth_cm: number
    pot_area_cm2: number
    pump_flow_ml_min: number
    mm_per_pump_second: number
  }
  age_s?: number | null
  readings?: Readings
  stage?: StageInfo | null
  soil?: SoilInfo | null
  suitability?: Suitability | null
  alerts?: AlertItem[]
  prediction?: Prediction | null
  plant?: PlantParams | null
}

export interface Telemetry {
  ts?: number
  air_t?: number | null
  air_rh?: number | null
  lux?: number | null
  tank_ok?: boolean | null
  pump_on?: boolean | null
  pump_ma?: number | null
  soil_t?: number | null
}

// ---- catálogos ----
export interface CropInfo {
  id: string
  name: string
  stages: { code: string; name: string; gdd_start: number }[]
}
export interface SoilCatalogItem {
  id: string
  name: string
}

// ---- simulación ----
export interface SimEventInput {
  at_hour: number
  type: 'irrigation' | 'rain'
  mm?: number
  seconds?: number
}

export interface SimRequest {
  hours: number
  step_minutes: number
  weather: {
    mode: 'persist' | 'constant'
    temp_offset_c: number
    rh_offset: number
    lux_scale: number
    air_t_mean?: number
    air_t_amp?: number
    rh_mean?: number
    lux_peak?: number
  }
  events: SimEventInput[]
  auto_irrigation: { enabled: boolean; mm: number }
  overrides: {
    crop?: string
    soil_type?: string
    vwc_pct?: number
    gdd?: number
    soil_depth_cm?: number
  }
}

export interface SimPoint {
  t_hour: number
  ts: number
  theta: number
  vwc_pct: number
  aw_pct: number
  dr_mm: number
  raw_mm: number
  taw_mm: number
  ks: number
  etc_mm_h: number
  stage: string
  gdd: number
  gdd_eff: number
  air_t: number
  lux: number
  irrigation_mm: number
  rain_mm: number
  needs_irrigation: boolean
  plant: PlantParams
}

export interface SimSummary {
  first_irrigation_due_h: number | null
  irrigations: { t_hour: number; mm: number; auto: boolean }[]
  irrigation_total_mm: number
  rain_total_mm: number
  etc_total_mm: number
  min_aw_pct: number
  hours_water_stress: number
  growth_index: number
  final_stage: string
  final_plant: PlantParams
}

export interface SimResponse {
  inputs: {
    crop: string
    soil_type: string
    hours: number
    step_minutes: number
    vwc_pct0: number
    gdd0: number
    et_scale: number
    [k: string]: unknown
  }
  summary: SimSummary
  series: SimPoint[]
}
