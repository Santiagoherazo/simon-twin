import { createContext, useContext } from 'react'

/** 'off' = sin escena 3D (solo panel de datos): para celulares que no la aguantan. */
export type Quality = 'high' | 'medium' | 'low' | 'off'

export const QUALITY_LABEL: Record<Quality, string> = { high: 'Alta', medium: 'Media', low: 'Baja', off: 'Sin 3D' }
export const QUALITY_ORDER: Quality[] = ['high', 'medium', 'low', 'off']

/** Dentro del Canvas: los componentes de la escena eligen materiales y detalle según la calidad. */
export const QualityContext = createContext<Quality>('high')
export const useQuality = () => useContext(QualityContext)

const KEY = 'simon.quality.v2'   // v2: ignora valores guardados por versiones anteriores (más pesadas)

function isPhone(): boolean {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  const small = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 700
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  return native || (coarse && small)
}

/** Calidad inicial: ?q=high|medium|low > lo guardado > automático (APK o celular = baja, tableta = media, PC = alta). */
export function initialQuality(): Quality {
  try {
    const q = new URLSearchParams(location.search).get('q')
    if (q === 'high' || q === 'medium' || q === 'low' || q === 'off') return q
  } catch {
    /* sin URL: valor por defecto */
  }
  try {
    const s = localStorage.getItem(KEY)
    const phone = isPhone()
    if (s === 'low' || s === 'off' || (s === 'medium' && !phone) || (s === 'high' && !phone)) return s
    if (s === 'medium' && phone) return s
  } catch {
    /* sin almacenamiento */
  }
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  const small = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 700
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  if (native || (coarse && small)) return 'low'
  return coarse || small ? 'medium' : 'high'
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q)
  } catch {
    /* sin almacenamiento */
  }
}

/** ?adapt=0 desactiva la resolución adaptativa (capturas reproducibles). */
export const adaptiveEnabled = () => {
  try {
    return new URLSearchParams(location.search).get('adapt') !== '0'
  } catch {
    return true
  }
}
