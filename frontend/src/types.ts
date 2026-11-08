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
  local_ip?: string | null
  local_host?: string | null
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
  /** Alertas del modelo de cultivo: qué pasa, por qué, qué consecuencia tiene y qué hacer. */
  title?: string
  cause?: string
  consequence?: string
  action?: string
}

/** Evento del ciclo de cultivo (estrés, enfermedad, hito de etapa…). */
export interface CropEvent {
  code: string
  level: AlertLevel
  title: string
  cause: string
  consequence: string
  action: string
  t_hour: number
  last_t_hour: number
  hours: number
  episodes: number
  active?: boolean
}

export interface CropSummary {
  yield_pct: number
  vigor_pct: number
  health_pct: number
  root_health_pct: number
  dead: boolean
  harvested: boolean
  losses: Record<string, number>
  hours: Record<string, number>
  diseases: Record<string, number>
  risks: Record<string, number>
  salinity_loss_pct: number | null
}

export interface HealthBlock {
  summary: CropSummary
  factors: Record<string, number>
  events: CropEvent[]
  window_h: number
  factor_names: Record<string, string>
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
  /** Intensidades 0–1 del motor de cultivo (opcionales: solo si hay modelo). */
  yellow?: number
  rot?: number
  scorch?: number
  stunt?: number
  spots?: number
  dead?: boolean
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
  models?: { id: string; name: string; ok: boolean; error?: string; output?: unknown; overrides?: Record<string, { was: unknown; now: number }> }[]
  prediction?: Prediction | null
  plant?: PlantParams | null
  /** true cuando las lecturas vienen directo del ESP32 (modo local, sin nube). */
  local?: boolean
  /** Variables personalizadas e indicadores definidos en el panel admin. */
  custom?: CustomVar[]
  actuators?: ActuatorState[]
  config_version?: number
  health?: HealthBlock | null
}

export interface CustomVar {
  key: string
  label: string
  unit: string
  kind: 'sensor' | 'indicator'
  value: number | boolean | null
  min_ok: number | null
  max_ok: number | null
  status: 'low' | 'ok' | 'high' | null
}
export interface ActuatorState {
  key: string
  label: string
  on: boolean | null
  max_seconds: number
}

// ---- configuración editable del dispositivo (panel admin) ----
export type SensorDriver = 'analog' | 'digital' | 'dht_t' | 'dht_h' | 'ds18b20' | 'bh1750' | 'simulated'
export type ActuatorDriver = 'relay' | 'digital_out' | 'pwm'
export interface SensorCfg {
  key: string
  label: string
  driver: SensorDriver
  pin: number | null
  param: number | null
  unit: string
  scale: number
  offset: number
  sim_min: number | null
  sim_max: number | null
  min_ok: number | null
  max_ok: number | null
  enabled: boolean
}
export interface ActuatorCfg {
  key: string
  label: string
  driver: ActuatorDriver
  pin: number | null
  active_high: boolean
  max_seconds: number
  auto_variable: string | null
  auto_on_below: number | null
  auto_on_above: number | null
  auto_off_at: number | null
  auto_seconds: number
  cooldown_s: number
  enabled: boolean
}
export interface IndicatorCfg {
  key: string
  label: string
  formula: string
  unit: string
  min_ok: number | null
  max_ok: number | null
  enabled: boolean
}
export interface DeviceConfigFull {
  device_id: string
  version: number
  report_interval_s: number
  sensors: SensorCfg[]
  actuators: ActuatorCfg[]
  indicators: IndicatorCfg[]
  warnings?: string[]
}
export interface DriverInfo {
  driver: string
  kind: 'sensor' | 'actuator'
  label: string
  needs_pin: boolean
  help: string
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
  category?: string
  yield_potential_kg_m2?: number
  sources?: string[]
  stages: { code: string; name: string; gdd_start: number }[]
}
export interface SoilCatalogItem {
  id: string
  name: string
}

// ---- simulación ----
export interface SimEventInput {
  at_hour: number
  type: 'irrigation' | 'rain' | 'fertilize'
  mm?: number
  seconds?: number
  n?: number
  p?: number
  k?: number
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
  auto_irrigation: { enabled: boolean; mm: number; trigger_aw_pct?: number | null }
  overrides: {
    crop?: string
    soil_type?: string
    vwc_pct?: number
    gdd?: number
    soil_depth_cm?: number
    crop_params?: Record<string, number>
    drainage?: 'bueno' | 'regular' | 'malo' | 'sin_salida' | null
    ph?: number
    ec?: number
    n?: number
    p?: number
    k?: number
  }
  management?: { disease_control: number; pest_control: number }
}

export interface CropParam {
  key: string
  label: string
  unit: string
  min: number
  max: number
  help: string
  value: number
}

export interface RecommendItem {
  crop: string
  name: string
  category?: string
  yield_pct: number
  vigor_pct?: number
  harvested: boolean
  days: number | null
  dead?: boolean
  yield_kg_m2?: number
  verdict: string
  issues: { title: string; level: AlertLevel; cause: string; action: string }[]
  losses?: Record<string, number>
}
export interface RecommendResponse {
  device_id: string
  basis: string
  ranking: RecommendItem[]
  disclaimer: string
}

export interface OptimizeRow {
  trigger_aw_pct: number
  mm: number
  yield_pct: number
  vigor_pct: number
  irrigation_mm: number
  critical_events: number
  dead: boolean
  score: number
  hours_water_stress: number
  waterlog_h: number
}
export interface OptimizeResponse {
  best: OptimizeRow
  top: OptimizeRow[]
  worst: OptimizeRow
  all: OptimizeRow[]
  note: string
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
  health?: number
  vigor_pct?: number
  yield_pct?: number
  root_pct?: number
  hypoxia?: number
  stress?: Record<string, number>
  vpd?: number
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
  crop_model?: CropSummary
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
  events?: CropEvent[]
}

export interface FitItem {
  crop: string
  name: string
  category?: string
  rank: number
  score: number
  health_pct: number
  dead: boolean
  current: boolean
  issues: { title: string; level: string; cause: string; action: string }[]
}
export interface FitResponse {
  device_id: string
  window_h: number
  ranking: FitItem[]
  note: string | null
  disclaimer: string
}
