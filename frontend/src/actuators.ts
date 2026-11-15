import type { ActuatorState } from './types'

/** Tipos de actuador del equipo: mini bomba, luz externa y servo. */
export type ActKind = 'pump' | 'light' | 'servo'

export const kindOf = (a: Pick<ActuatorState, 'key' | 'label'>): ActKind => {
  const t = `${a.key} ${a.label}`.toLowerCase()
  if (/servo/.test(t)) return 'servo'
  if (/luz|light|l[aá]mpara|lamp|led|grow|foco/.test(t)) return 'light'
  return 'pump'
}

/** Duraciones ofrecidas (s); siempre se recortan al tope de seguridad del actuador. */
export const OPTIONS: Record<ActKind, number[]> = { pump: [5, 10, 20, 30, 60], light: [60, 300, 900, 1800, 3600], servo: [5, 10, 20, 30] }
/** Atajos de la botonera de la pantalla principal (3 por actuador). */
export const QUICK: Record<ActKind, number[]> = { pump: [5, 10, 30], light: [300, 900, 3600], servo: [5, 10, 30] }
export const VERB: Record<ActKind, string> = { pump: 'Regar', light: 'Encender', servo: 'Abrir' }
/** El servo es un postigo: abrir lo deja abierto hasta que se cierre (no tiene temporizador). */
export const isLatch = (k: ActKind) => k === 'servo'
export const stateWord = (k: ActKind, on: boolean | null | undefined) =>
  k === 'servo' ? (on ? 'abierta' : 'cerrada') : k === 'light' ? (on ? 'encendida' : 'apagada') : on ? 'regando' : 'apagada'
export const dur = (s: number) => {
  const t = Math.round(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return [h && `${h} h`, m && `${m} min`, (sec || !t) && `${sec} s`].filter(Boolean).join(' ')
}
/** Unidades para el tiempo libre (segundos que vale cada una). */
export const UNITS = [
  { id: 's', label: 'segundos', secs: 1 },
  { id: 'min', label: 'minutos', secs: 60 },
  { id: 'h', label: 'horas', secs: 3600 },
] as const
export type UnitId = (typeof UNITS)[number]['id']
/** Convierte «1,5» + horas en segundos; null si no es un número válido. */
export const toSeconds = (raw: string, unit: UnitId): number | null => {
  const v = Number(raw.trim().replace(',', '.'))
  if (!raw.trim() || !Number.isFinite(v) || v <= 0) return null
  return Math.round(v * (UNITS.find((u) => u.id === unit)?.secs ?? 1))
}
export const optionsFor = (a: ActuatorState, quick = false) => (quick ? QUICK : OPTIONS)[kindOf(a)].filter((s) => s <= a.max_seconds)
