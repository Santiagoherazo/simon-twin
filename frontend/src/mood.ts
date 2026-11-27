import type { TwinState } from './types'

export type Mood = 'happy' | 'worried' | 'sad' | 'sleep'

/** Misma regla que backend/app/twin.py::plant_mood (se usa en el modo local, cuando el estado no trae `mood`).
 *  sad: alerta crítica, planta muerta o aptitud < 40 · worried: aviso, aptitud < 75 o tanque bajo · sleep: sin datos.
 *  `model_drought` se ignora si la sonda actual marca ≥40 %: es sequía del historial de 14 días, no de ahora. */
export const DROUGHT_WET_PCT = 40

function droughtIsCurrent(s: TwinState | null | undefined): boolean {
  const vwc = s?.readings?.vwc_pct
  if (typeof vwc === 'number') return vwc < DROUGHT_WET_PCT
  const ks = s?.soil?.ks
  if (typeof ks === 'number') return ks < 0.7
  return true
}

export function moodFromState(s: TwinState | null | undefined): Mood {
  if (!s || !s.readings || (s.alerts ?? []).some((a) => a.code === 'no_data')) return 'sleep'
  const alerts = s.alerts ?? []
  const overall = s.suitability?.overall
  const droughtNow = droughtIsCurrent(s)
  const crit = alerts.filter((a) => a.level === 'critical' && (droughtNow || a.code !== 'model_drought'))
  if (crit.length > 0 || s.plant?.dead === true || (typeof overall === 'number' && overall < 40)) return 'sad'
  if (alerts.some((a) => a.level === 'warn') || s.readings.tank_ok === false || (typeof overall === 'number' && overall < 75)) return 'worried'
  return 'happy'
}

export const MOOD_TEXT: Record<Mood, string> = {
  happy: 'Feliz: todo bien',
  worried: 'Preocupada: algo no está ideal',
  sad: 'Triste: estado crítico',
  sleep: 'Dormida: sin datos',
}
