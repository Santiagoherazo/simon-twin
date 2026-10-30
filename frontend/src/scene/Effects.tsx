import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisual } from '../visual'
import { FLOOR_Y, lamp, SOIL_TOP, PROBE_POS, PUMP_POS, TANK_POS } from './layout'
import { reducedMotion, sm } from './smooth'
import { useQuality } from './quality'
import { alertTexture, glowTexture } from './textures'

const SUN_POS: [number, number, number] = [11, 19, 9]

/** Sol con sombras suaves de día; dos lámparas con foco (y sombra) de noche. */
export function Lights() {
  const quality = useQuality()
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const spot = useRef<THREE.SpotLight>(null)
  const shadowSize = quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 512
  const spotShadow = quality === 'high' ? 1536 : quality === 'medium' ? 1024 : 512

  useFrame(() => {
    const d = sm.day
    if (sun.current) {
      sun.current.intensity = 0.04 + 3.1 * d
      sun.current.color.set('#ffe3bd').lerp(new THREE.Color('#fff7ea'), d)
    }
    if (hemi.current) hemi.current.intensity = 0.22 + 0.2 * d
    const sp = spot.current
    if (sp) {
      sp.position.set(0, lamp.y - 0.12, 0.1)
      sp.intensity = 20 * lamp.on
    }
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={['#e6f3ff', '#6e6a5a', 0.3]} />
      <directionalLight
        ref={sun}
        position={SUN_POS}
        intensity={2}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
      />
      <spotLight
        ref={spot}
        position={[0, 6.3, 0.1]}
        angle={0.7}
        penumbra={0.85}
        decay={0}
        distance={0}
        color="#ffd6ec"
        intensity={4}
        castShadow={quality !== 'low'}
        shadow-mapSize={[spotShadow, spotShadow]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={1}
        shadow-camera-far={20}
        target-position={[0, SOIL_TOP, 0.1]}
      />
    </>
  )
}

const DUST_N = 240

/** Motas de polvo y polen a la deriva: hacen visible el volumen de aire y la luz. */
export function Dust() {
  const mat = useRef<THREE.PointsMaterial>(null)
  const { geo, base, phase, tex } = useMemo(() => {
    const base = new Float32Array(DUST_N * 3)
    const phase = new Float32Array(DUST_N * 3)
    const R = (i: number, k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    for (let i = 0; i < DUST_N; i++) {
      base.set([(R(i, 1) - 0.5) * 16, 0.5 + R(i, 2) * 10, -4 + R(i, 3) * 11], i * 3)
      phase.set([R(i, 4) * 6.28, R(i, 5) * 6.28, R(i, 6) * 6.28], i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3))
    return { geo, base, phase, tex: glowTexture() }
  }, [])
  useEffect(
    () => () => {
      geo.dispose()
      tex.dispose()
    },
    [geo, tex],
  )
  useFrame(({ clock }) => {
    const t = reducedMotion() ? 0 : clock.elapsedTime
    const p = geo.attributes.position.array as Float32Array
    for (let i = 0; i < DUST_N; i++) {
      p[i * 3] = base[i * 3] + Math.sin(t * 0.11 + phase[i * 3]) * 0.7
      p[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.07 + phase[i * 3 + 1]) * 0.5 + ((t * 0.04) % 1) * 0.3
      p[i * 3 + 2] = base[i * 3 + 2] + Math.sin(t * 0.09 + phase[i * 3 + 2]) * 0.6
    }
    geo.attributes.position.needsUpdate = true
    if (mat.current) mat.current.opacity = 0.05 + 0.4 * (1 - sm.day)
  })
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial ref={mat} map={tex} size={0.085} transparent depthWrite={false} blending={THREE.AdditiveBlending} color="#fff1d6" sizeAttenuation toneMapped={false} />
    </points>
  )
}

const RAIN_N = 110

/** Lluvia: se ve solo cuando la simulación tiene un evento de lluvia (sm.rain). */
export function Rain() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const drops = useMemo(
    () =>
      Array.from({ length: RAIN_N }, (_, i) => {
        const r = (k: number) => {
          const x = Math.sin(i * k + k * 3.1) * 43758.5453
          return x - Math.floor(x)
        }
        return { x: (r(12.9898) - 0.5) * 26, z: (r(78.233) - 0.5) * 20 - 1, y: r(37.719) * 19 + FLOOR_Y, v: 17 + r(4.1) * 9 }
      }),
    [],
  )
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((_, dtRaw) => {
    const m = mesh.current
    if (!m) return
    m.visible = sm.rain > 0.03
    if (mat.current) mat.current.opacity = 0.55 * sm.rain
    if (!m.visible) return
    const dt = Math.min(dtRaw, 0.05)
    for (let i = 0; i < RAIN_N; i++) {
      const d = drops[i]
      if (!reducedMotion()) {
        d.y -= d.v * dt
        if (d.y < FLOOR_Y) d.y += 19
      }
      dummy.position.set(d.x, d.y, d.z)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, RAIN_N]} frustumCulled={false} visible={false}>
      <boxGeometry args={[0.025, 0.8, 0.025]} />
      <meshBasicMaterial ref={mat} color="#bfe3ff" transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  )
}

function Marker({ position, on }: { position: [number, number, number]; on: boolean }) {
  const tex = useMemo(() => alertTexture(), [])
  useEffect(() => () => tex.dispose(), [tex])
  const ref = useRef<THREE.Sprite>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const bob = reducedMotion() ? 0 : Math.sin(clock.elapsedTime * 3.2) * 0.08
    ref.current.position.y = position[1] + bob
  })
  if (!on) return null
  return (
    <sprite ref={ref} position={position} scale={[0.55, 0.55, 1]} renderOrder={20}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  )
}

/** Signo de exclamación sobre el elemento que tiene una alerta crítica. */
export function AlertMarkers() {
  const probe = useVisual((v) => v.alerts.probe)
  const tank = useVisual((v) => v.alerts.tank)
  const pump = useVisual((v) => v.alerts.pump)
  return (
    <group>
      <Marker position={[PROBE_POS[0], 3.5, PROBE_POS[2]]} on={probe} />
      <Marker position={[TANK_POS[0], 3.4, TANK_POS[2]]} on={tank} />
      <Marker position={[PUMP_POS[0], 1.7, PUMP_POS[2]]} on={pump} />
    </group>
  )
}
