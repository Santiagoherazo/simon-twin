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
export const stateWord = (k: ActKind, on: boolean | null | undefined) => (k === 'servo' ? (on ? 'abierta' : 'cerrada') : on ? 'activo' : 'apagado')
export const dur = (s: number) => (s >= 3600 ? `${s / 3600} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`)
export const optionsFor = (a: ActuatorState, quick = false) => (quick ? QUICK : OPTIONS)[kindOf(a)].filter((s) => s <= a.max_seconds)
