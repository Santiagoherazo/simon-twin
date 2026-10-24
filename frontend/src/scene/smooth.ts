import { useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { getVisual, wetness } from '../visual'

/**
 * Valores suavizados que consume toda la escena. Cada fotograma se acercan al estado visual objetivo
 * con amortiguación exponencial: ni saltos cuando llega un mensaje cada 2 s, ni cortes al
 * pasar de vivo a simulación.
 */
// ?day=0..1 fuerza la hora del día (útil para revisar el aspecto de día/noche)
const FORCE_DAY = (() => {
  try {
    const v = new URLSearchParams(location.search).get('day')
    return v == null ? null : Math.min(1, Math.max(0, Number(v)))
  } catch {
    return null
  }
})()

export const sm = {
  ready: false,
  wet: 0.6,
  wilt: 0,
  health: 1,
  heightCm: 10,
  lai: 0.5,
  day: 0.5,
  tank: 0.78,
  pump: 0,
  rain: 0,
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function Smoother() {
  useFrame((_, dtRaw) => {
    const v = getVisual()
    const dt = Math.min(dtRaw, 0.1)
    const tgt = {
      wet: wetness(v.awPct),
      wilt: v.plant.wilt,
      health: v.plant.health,
      heightCm: v.plant.heightCm,
      lai: v.plant.lai,
      day: FORCE_DAY ?? Math.min(1, Math.sqrt(Math.max(0, v.lux) / 40000)),
      tank: v.tankOk ? 0.78 : 0.05,
      pump: v.pumpOn ? 1 : 0,
      rain: v.rainMm > 0 ? 1 : 0,
    }
    if (!sm.ready) {
      if (!v.hasData) return // espera al primer dato real para no animar de un valor inventado
      Object.assign(sm, tgt, { ready: true })
      return
    }
    sm.wet = MathUtils.damp(sm.wet, tgt.wet, 2.5, dt)
    sm.wilt = MathUtils.damp(sm.wilt, tgt.wilt, 2.2, dt)
    sm.health = MathUtils.damp(sm.health, tgt.health, 2.2, dt)
    sm.heightCm = MathUtils.damp(sm.heightCm, tgt.heightCm, 3, dt)
    sm.lai = MathUtils.damp(sm.lai, tgt.lai, 3, dt)
    sm.day = MathUtils.damp(sm.day, tgt.day, 1.2, dt)
    sm.tank = MathUtils.damp(sm.tank, tgt.tank, 1.4, dt)
    sm.pump = MathUtils.damp(sm.pump, tgt.pump, 6, dt)
    sm.rain = MathUtils.damp(sm.rain, tgt.rain, 5, dt)
  }, -1)
  return null
}
