import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PLANTER_D, PLANTER_W, PLANTER_WALL, SOIL_TOP } from './layout'
import { reducedMotion, sm } from './smooth'
import { glowTexture } from './textures'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Cristales blancos dispersos (sirven para escarcha y para la costra de sales). */
function speckleTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  let s = 11
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < 1400; i++) {
    const x = r() * 256
    const y = r() * 256
    const k = 0.7 + r() * 2.6
    ctx.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.65})`
    ctx.beginPath()
    ctx.arc(x, y, k, 0, Math.PI * 2)
    ctx.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const N_HEAT = 14
const N_MIST = 26

/**
 * El clima visible: escarcha sobre el sustrato con aire frío, costra de sales con EC alta,
 * ondas de calor con aire muy caliente o calefactor encendido, y bruma con humedad alta o humidificador.
 */
export function Climate() {
  const tex = useMemo(speckleTexture, [])
  const glow = useMemo(glowTexture, [])
  const frost = useRef<THREE.MeshBasicMaterial>(null)
  const salt = useRef<THREE.MeshBasicMaterial>(null)
  const heat = useRef<(THREE.Sprite | null)[]>([])
  const mist = useRef<(THREE.Sprite | null)[]>([])
  useEffect(() => () => { tex.dispose(); glow.dispose() }, [tex, glow])

  const w = PLANTER_W - 2 * PLANTER_WALL - 0.35
  const d = PLANTER_D - 2 * PLANTER_WALL - 0.35
  const seeds = useMemo(
    () => Array.from({ length: N_HEAT + N_MIST }, (_, i) => ({ x: Math.sin(i * 12.9898) * 0.5 + 0.5, z: Math.sin(i * 78.233) * 0.5 + 0.5, p: (i * 0.6180339) % 1 })),
    [],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const still = reducedMotion()
    if (frost.current) frost.current.opacity = 0.95 * clamp01((4 - sm.airT) / 4)
    if (salt.current) salt.current.opacity = 0.9 * clamp01((sm.ec - 2.2) / 2.5)
    const h = Math.max(clamp01((sm.airT - 33) / 8), sm.heater)
    heat.current.forEach((sp, i) => {
      if (!sp) return
      const sd = seeds[i]
      const ph = (still ? sd.p : (t * 0.22 + sd.p) % 1)
      sp.position.set((sd.x - 0.5) * w * 0.9, SOIL_TOP + 0.4 + ph * 4.2, (sd.z - 0.5) * d * 0.9)
      const m = sp.material as THREE.SpriteMaterial
      m.opacity = 0.16 * h * Math.sin(Math.PI * ph)
      sp.scale.setScalar(0.9 + ph * 1.1)
    })
    const mi = Math.max(clamp01((sm.rh - 82) / 16), sm.humid)
    mist.current.forEach((sp, i) => {
      if (!sp) return
      const sd = seeds[N_HEAT + i]
      const ph = (still ? sd.p : (t * 0.09 + sd.p) % 1)
      sp.position.set((sd.x - 0.5) * w * 1.1 + Math.sin(t * 0.3 + i) * 0.25, SOIL_TOP + 0.25 + ph * 3.2, (sd.z - 0.5) * d * 1.1)
      const m = sp.material as THREE.SpriteMaterial
      m.opacity = 0.2 * mi * Math.sin(Math.PI * ph)
      sp.scale.setScalar(1.1 + ph * 1.5)
    })
  })

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, SOIL_TOP + 0.015, 0.05]} renderOrder={2}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial ref={frost} map={tex} color="#d8ecff" transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, SOIL_TOP + 0.02, 0.05]} rotation-z={1.3} renderOrder={2}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial ref={salt} map={tex} color="#f1e7cf" transparent opacity={0} depthWrite={false} />
      </mesh>
      {Array.from({ length: N_HEAT }, (_, i) => (
        <sprite key={`h${i}`} ref={(el) => { heat.current[i] = el }} renderOrder={5}>
          <spriteMaterial map={glow} color="#ff9a4a" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
      {Array.from({ length: N_MIST }, (_, i) => (
        <sprite key={`m${i}`} ref={(el) => { mist.current[i] = el }} renderOrder={5}>
          <spriteMaterial map={glow} color="#e9f3ff" transparent opacity={0} depthWrite={false} />
        </sprite>
      ))}
    </group>
  )
}
