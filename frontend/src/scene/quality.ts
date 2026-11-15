import { createContext, useContext } from 'react'
import { detectDevice } from '../device'

/** 'off' = sin escena 3D (solo panel de datos): para celulares que no la aguantan. */
export type Quality = 'high' | 'medium' | 'low' | 'off'

export const QUALITY_LABEL: Record<Quality, string> = { high: 'Alta', medium: 'Media', low: 'Baja', off: 'Sin 3D' }
export const QUALITY_ORDER: Quality[] = ['high', 'medium', 'low', 'off']

/** Dentro del Canvas: los componentes de la escena eligen materiales y detalle según la calidad. */
export const QualityContext = createContext<Quality>('high')
export const useQuality = () => useContext(QualityContext)

/** Lo que elige la persona: «auto» deja decidir al tipo de equipo (ver device.ts). */
export type QualityPref = 'auto' | Quality
export const PREF_ORDER: QualityPref[] = ['auto', 'high', 'medium', 'low', 'off']

const KEY = 'simon.quality.pref.v3'   // v3: arranca en «auto» (PC alta, celular sin 3D) e ignora lo guardado antes

const isPref = (v: unknown): v is QualityPref => v === 'auto' || v === 'high' || v === 'medium' || v === 'low' || v === 'off'

/** Preferencia inicial: ?q=high|medium|low|off (solo esta visita) > lo guardado > auto. */
export function initialPref(): QualityPref {
  try {
    const q = new URLSearchParams(location.search).get('q')
    if (isPref(q)) return q
  } catch {
    /* sin URL: valor por defecto */
  }
  try {
    const s = localStorage.getItem(KEY)
    if (isPref(s)) return s
  } catch {
    /* sin almacenamiento */
  }
  return 'auto'
}

export function savePref(p: QualityPref) {
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* sin almacenamiento */
  }
}

/** Calidad con la que arranca la escena: lo que se eligió, o lo que sugiere el tipo de equipo en «auto». */
export const initialQuality = (): Quality => {
  const p = initialPref()
  return p === 'auto' ? detectDevice().suggested : p
}

/** Un escalón menos de calidad (se usa cuando la escena va lenta). */
export const lowerQuality = (q: Quality): Quality => QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, QUALITY_ORDER.indexOf(q) + 1)]

/** ?adapt=0 desactiva la resolución adaptativa (capturas reproducibles). */
export const adaptiveEnabled = () => {
  try {
    return new URLSearchParams(location.search).get('adapt') !== '0'
  } catch {
    return true
  }
}
