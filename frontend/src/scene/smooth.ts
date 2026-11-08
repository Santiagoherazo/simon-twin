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
  yellow: 0,
  scorch: 0,
  rot: 0,
  dead: 0,
  heightCm: 10,
  lai: 0.5,
  day: 0.5,
  tank: 0.78,
  pump: 0,
  rain: 0,
  airT: 22,
  rh: 60,
  ec: 0,
  fan: 0,
  light: -1, // -1: sin actuador de luz (la lámpara sigue al día); 0..1: encendida/apagada
  heater: 0,
  humid: 0,
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function Smoother() {
  useFrame((_, dtRaw) => {
    const v = getVisual()
    const dt = Math.min(dtRaw, 0.1)
    const tgt = {
      wet: wetness(v.awPct),
      wilt: v.plant.dead ? 1 : v.plant.wilt,
      health: v.plant.health,
      yellow: v.plant.yellow,
      scorch: v.plant.scorch,
      rot: v.plant.rot,
      dead: v.plant.dead ? 1 : 0,
      heightCm: v.plant.heightCm,
      lai: v.plant.lai,
      day: FORCE_DAY ?? Math.min(1, Math.sqrt(Math.max(0, v.lux) / 40000)),
      tank: v.tankOk ? 0.78 : 0.05,
      pump: v.pumpOn ? 1 : 0,
      rain: v.rainMm > 0 ? 1 : 0,
      airT: v.airT ?? 22,
      rh: v.airRh ?? 60,
      ec: (v.ec ?? 0) / 1000, // la lectura viene en µS/cm; la escena usa dS/m
      fan: v.acts.some((a) => a.kind === 'fan' && a.on) ? 1 : 0,
      light: v.acts.some((a) => a.kind === 'light') ? (v.acts.some((a) => a.kind === 'light' && a.on) ? 1 : 0) : -1,
      heater: v.acts.some((a) => a.kind === 'heater' && a.on) ? 1 : 0,
      humid: v.acts.some((a) => a.kind === 'humidifier' && a.on) ? 1 : 0,
    }
    if (!sm.ready) {
      if (!v.hasData) return // espera al primer dato real para no animar de un valor inventado
      Object.assign(sm, tgt, { ready: true })
      return
    }
    sm.wet = MathUtils.damp(sm.wet, tgt.wet, 2.5, dt)
    sm.wilt = MathUtils.damp(sm.wilt, tgt.wilt, 2.2, dt)
    sm.health = MathUtils.damp(sm.health, tgt.health, 2.2, dt)
    sm.yellow = MathUtils.damp(sm.yellow, tgt.yellow, 2.2, dt)
    sm.scorch = MathUtils.damp(sm.scorch, tgt.scorch, 2.2, dt)
    sm.rot = MathUtils.damp(sm.rot, tgt.rot, 2.2, dt)
    sm.dead = MathUtils.damp(sm.dead, tgt.dead, 1.5, dt)
    sm.heightCm = MathUtils.damp(sm.heightCm, tgt.heightCm, 3, dt)
    sm.lai = MathUtils.damp(sm.lai, tgt.lai, 3, dt)
    sm.day = MathUtils.damp(sm.day, tgt.day, 1.2, dt)
    sm.tank = MathUtils.damp(sm.tank, tgt.tank, 1.4, dt)
    sm.pump = MathUtils.damp(sm.pump, tgt.pump, 6, dt)
    sm.rain = MathUtils.damp(sm.rain, tgt.rain, 5, dt)
    sm.airT = MathUtils.damp(sm.airT, tgt.airT, 1.5, dt)
    sm.rh = MathUtils.damp(sm.rh, tgt.rh, 1.5, dt)
    sm.ec = MathUtils.damp(sm.ec, tgt.ec, 1.5, dt)
    sm.fan = MathUtils.damp(sm.fan, tgt.fan, 1.8, dt)
    sm.light = tgt.light < 0 ? -1 : MathUtils.damp(sm.light < 0 ? tgt.light : sm.light, tgt.light, 5, dt)
    sm.heater = MathUtils.damp(sm.heater, tgt.heater, 1.5, dt)
    sm.humid = MathUtils.damp(sm.humid, tgt.humid, 1.5, dt)
  }, -1)
  return null
}
