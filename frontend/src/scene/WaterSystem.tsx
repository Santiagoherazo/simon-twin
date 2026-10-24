import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { NOZZLE, PLANTER_D, SOIL_TOP } from './layout'
import { reducedMotion, sm } from './smooth'
import { flowTexture } from './textures'

// Manguera de goteo con flujo animado, gotas sobre el sustrato y LED de la bomba. El agua vive dentro de la matera.
const DROPS = 26

/** LED de estado de la bomba en el frente de la matera. */
function Pump() {
  const led = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => {
    led.current?.color.set('#2a5a3d').lerp(new THREE.Color('#59ff9a'), sm.pump)
  })
  return (
    <mesh position={[2.72, 1.55, PLANTER_D / 2 + 0.03]}>
      <sphereGeometry args={[0.05, 12, 8]} />
      <meshBasicMaterial ref={led} color="#2a5a3d" toneMapped={false} />
    </mesh>
  )
}

function Hose() {
  const flow = useMemo(() => flowTexture(), [])
  const { delivery, overlay } = useMemo(() => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const d = new THREE.CatmullRomCurve3([
      v(1.9, SOIL_TOP + 0.05, -1.0),
      v(1.75, 3.0, -0.95),
      v(1.1, 3.8, -0.5),
      v(-0.1, 3.6, 0.0),
      v(NOZZLE[0] + 0.15, NOZZLE[1] + 0.25, NOZZLE[2]),
      v(NOZZLE[0], NOZZLE[1], NOZZLE[2]),
    ])
    return {
      delivery: new THREE.TubeGeometry(d, 60, 0.045, 8, false),
      overlay: new THREE.TubeGeometry(d, 60, 0.06, 8, false),
    }
  }, [])
  useEffect(
    () => () => {
      delivery.dispose()
      overlay.dispose()
      flow.dispose()
    },
    [delivery, overlay, flow],
  )
  const overlayMat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame((_, dt) => {
    const m = overlayMat.current
    if (!m) return
    m.opacity = 0.92 * sm.pump
    m.visible = sm.pump > 0.02
    if (!reducedMotion()) flow.offset.x -= dt * 2.4
  })
  return (
    <group>
      <mesh geometry={delivery} castShadow>
        <meshStandardMaterial color="#20282e" roughness={0.6} />
      </mesh>
      <mesh geometry={overlay}>
        <meshBasicMaterial ref={overlayMat} map={flow} color="#8fd0ff" transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* boquilla */}
      <mesh position={[NOZZLE[0], NOZZLE[1] - 0.1, NOZZLE[2]]}>
        <coneGeometry args={[0.09, 0.2, 10]} />
        <meshStandardMaterial color="#8da2b0" metalness={0.6} roughness={0.35} />
      </mesh>
    </group>
  )
}

/** Gotas que caen de la boquilla al suelo mientras la bomba trabaja. */
function Drops() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const seeds = useMemo(
    () =>
      Array.from({ length: DROPS }, (_, i) => ({
        phase: i / DROPS,
        dx: (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.1,
        dz: (Math.sin(i * 78.233) * 12345.6789 % 1) * 0.1,
      })),
    [],
  )
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    m.visible = sm.pump > 0.1
    if (!m.visible) return
    const top = NOZZLE[1] - 0.2
    const fall = top - (SOIL_TOP + 0.04)
    const t = reducedMotion() ? 0.3 : clock.elapsedTime
    for (let i = 0; i < DROPS; i++) {
      const s = seeds[i]
      const u = (t * 1.5 + s.phase) % 1
      dummy.position.set(NOZZLE[0] + s.dx * u, top - fall * u * u, NOZZLE[2] + s.dz * u)
      dummy.scale.set(1, 1.5 + u, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, DROPS]} frustumCulled={false}>
      <sphereGeometry args={[0.04, 8, 6]} />
      <meshPhysicalMaterial color="#cfeaff" emissive="#3d9ad6" emissiveIntensity={0.25} transparent opacity={0.85} roughness={0.05} clearcoat={1} envMapIntensity={1.6} />
    </instancedMesh>
  )
}

export function WaterSystem() {
  return (
    <group>
      <Pump />
      <Hose />
      <Drops />
    </group>
  )
}
