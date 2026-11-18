import type { TwinState } from './types'

export type Mood = 'happy' | 'worried' | 'sad' | 'sleep'

/** Misma regla que backend/app/twin.py::plant_mood (se usa en el modo local, cuando el estado no trae `mood`).
 *  sad: alerta crítica, planta muerta o aptitud < 40 · worried: aviso, aptitud < 75 o tanque bajo · sleep: sin datos. */
export function moodFromState(s: TwinState | null | undefined): Mood {
  if (!s || !s.readings || (s.alerts ?? []).some((a) => a.code === 'no_data')) return 'sleep'
  const alerts = s.alerts ?? []
  const overall = s.suitability?.overall
  if (alerts.some((a) => a.level === 'critical') || s.plant?.dead === true || (typeof overall === 'number' && overall < 40)) return 'sad'
  if (alerts.some((a) => a.level === 'warn') || s.readings.tank_ok === false || (typeof overall === 'number' && overall < 75)) return 'worried'
  return 'happy'
}

export const MOOD_TEXT: Record<Mood, string> = {
  happy: 'Feliz: todo bien',
  worried: 'Preocupada: algo no está ideal',
  sad: 'Triste: estado crítico',
  sleep: 'Dormida: sin datos',
}
