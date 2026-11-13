import { useSyncExternalStore } from 'react'

/** Estado compartido entre la interfaz (botones) y la escena 3D para el modo AR, el foco de cámara y el giroscopio. */
export interface XrState {
  support: 'unknown' | 'yes' | 'no'
  /** motivo legible cuando no hay AR */
  why: string
  active: boolean
  placed: boolean
  /** peticiones desde la interfaz hacia la escena */
  req: { start: number; stop: number; replace: number; scale: number }
  scale: number
}

let state: XrState = {
  support: 'unknown',
  why: '',
  active: false,
  placed: false,
  req: { start: 0, stop: 0, replace: 0, scale: 0 },
  scale: 0.07,
}
const subs = new Set<() => void>()
export const getXr = () => state
export function setXr(p: Partial<XrState>) {
  state = { ...state, ...p }
  subs.forEach((f) => f())
}
export const useXr = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
export const xrRequest = (k: keyof XrState['req']) => setXr({ req: { ...state.req, [k]: state.req[k] + 1 } })

export async function detectAr() {
  const nav = navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }
  if (!window.isSecureContext) return setXr({ support: 'no', why: 'El AR necesita HTTPS (o localhost).' })
  if (!nav.xr) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    return setXr({
      support: 'no',
      why: ios ? 'Safari en iPhone aún no permite AR en la web. En Android con Chrome sí.' : 'Este navegador no ofrece AR web. Prueba Chrome en Android.',
    })
  }
  try {
    const ok = await nav.xr.isSessionSupported('immersive-ar')
    setXr(ok ? { support: 'yes', why: '' } : { support: 'no', why: 'Este teléfono no tiene ARCore o está desactivado.' })
  } catch {
    setXr({ support: 'no', why: 'No se pudo comprobar el AR.' })
  }
}

/** Parte de la escena seleccionada con un clic (escritorio) para centrar la cámara y resaltar la tarjeta. */
export type FocusId = 'soil' | 'tank' | 'plant'
let focus: { id: FocusId; n: number } | null = null
const fsubs = new Set<() => void>()
export const setFocus = (id: FocusId | null) => {
  focus = id ? { id, n: (focus?.n ?? 0) + 1 } : null
  fsubs.forEach((f) => f())
}
export const useFocus = () =>
  useSyncExternalStore(
    (f) => {
      fsubs.add(f)
      return () => fsubs.delete(f)
    },
    () => focus,
  )

/** Clic en el modelo 3D de un actuador (luz, servo…): el dock de la pantalla principal abre su control. */
let actPick: { key: string; n: number } | null = null
const asubs = new Set<() => void>()
export const pickActuator = (key: string | null) => {
  actPick = key ? { key, n: (actPick?.n ?? 0) + 1 } : null
  asubs.forEach((f) => f())
}
export const useActuatorPick = () =>
  useSyncExternalStore(
    (f) => {
      asubs.add(f)
      return () => asubs.delete(f)
    },
    () => actPick,
  )

/** Inclinación por giroscopio (-1..1), solo móvil. */
export const gyro = { x: 0, y: 0, on: false }
