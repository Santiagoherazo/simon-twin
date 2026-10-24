import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { assets, withRepeat } from './assets'
import { FLOOR_Y, TABLE_D, TABLE_W } from './layout'
import { pbrMaterial } from './materials'

const LEG = 0.34
const LEG_TOP = -0.3
const LEG_H = LEG_TOP - FLOOR_Y

/** Losa de hormigón del invernadero: abarca el interior y se extiende hacia la cámara (el frente está abierto). */
export const FLOOR_X = 19
export const FLOOR_Z0 = -15
export const FLOOR_Z1 = 34

const metal = { color: '#aeb6bd', roughness: 0.38, metalness: 0.85, envMapIntensity: 1.2 } as const

/** La mesa de trabajo (tablero de roble sobre patas de aluminio) y el piso. */
export function Bench() {
  const wood = useMemo(() => pbrMaterial(withRepeat(assets.wood(), 1.5, 3), { normalScale: 1.1, envMapIntensity: 0.9 }), [])
  const floorSet = useMemo(() => withRepeat(assets.concrete(), (FLOOR_X * 2) / 4.2, (FLOOR_Z1 - FLOOR_Z0) / 4.2), [])
  const floor = useMemo(() => pbrMaterial(floorSet, { normalScale: 1, envMapIntensity: 1.1 }), [floorSet])
  const top = useMemo(() => new RoundedBoxGeometry(TABLE_W, 0.3, TABLE_D, 4, 0.07), [])
  useEffect(
    () => () => {
      wood.dispose()
      floor.dispose()
      top.dispose()
    },
    [wood, floor, top],
  )
  const xs = TABLE_W / 2 - 0.45
  const zs = TABLE_D / 2 - 0.45
  return (
    <group>
      <mesh geometry={top} material={wood} position={[0, -0.15, 0]} castShadow receiveShadow />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * xs, LEG_TOP - LEG_H / 2, sz * zs]} castShadow>
            <boxGeometry args={[LEG, LEG_H, LEG]} />
            <meshStandardMaterial {...metal} />
          </mesh>
        )),
      )}
      {/* travesaños */}
      {[-1, 1].map((sz) => (
        <mesh key={`f${sz}`} position={[0, FLOOR_Y + 1.4, sz * zs]} castShadow>
          <boxGeometry args={[xs * 2, 0.18, 0.18]} />
          <meshStandardMaterial {...metal} />
        </mesh>
      ))}
      {[-1, 1].map((sx) => (
        <mesh key={`s${sx}`} position={[sx * xs, FLOOR_Y + 1.4, 0]} castShadow>
          <boxGeometry args={[0.18, 0.18, zs * 2]} />
          <meshStandardMaterial {...metal} />
        </mesh>
      ))}
      <mesh position={[0, FLOOR_Y, (FLOOR_Z0 + FLOOR_Z1) / 2]} rotation-x={-Math.PI / 2} receiveShadow material={floor}>
        <planeGeometry args={[FLOOR_X * 2, FLOOR_Z1 - FLOOR_Z0]} />
      </mesh>
    </group>
  )
}

const POTS_X = [-3.2, -1.1, 1.1, 3.2]
const BLADES = 11

/** Hoja curva con UV (v: base → punta). */
function bladeGeometry() {
  const g = new THREE.PlaneGeometry(0.34, 1.5, 2, 7)
  g.translate(0, 0.75, 0)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 1.5
    p.setX(i, p.getX(i) * (Math.sin(Math.PI * Math.pow(t, 0.55)) * 0.9 + 0.12))
    p.setZ(i, p.getZ(i) + t * t * 0.9 - Math.abs(p.getX(i)) * 0.35)
  }
  g.computeVertexNormals()
  return g
}

/** Mesa de fondo con macetas pequeñas: da profundidad al invernadero (sin datos, solo ambiente). */
export function BackBench({ position, rot = 0, seed = 0 }: { position: [number, number, number]; rot?: number; seed?: number }) {
  const { potGeo, bladeGeo, potMat, leafMat, topMat, blades } = useMemo(() => {
    const leaf = withRepeat(assets.leaf('maize'), 1, 1)
    const blades = new THREE.InstancedMesh(bladeGeometry(), undefined, POTS_X.length * BLADES)
    const d = new THREE.Object3D()
    const c = new THREE.Color()
    const R = (i: number, k: number) => {
      const x = Math.sin((i + seed * 31) * 12.9898 + k * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    POTS_X.forEach((px, pi) => {
      const big = 0.75 + R(pi, 90) * 0.55
      for (let b = 0; b < BLADES; b++) {
        const i = pi * BLADES + b
        const az = (b / BLADES) * Math.PI * 2 + R(i, 1) * 0.5
        d.position.set(px + Math.cos(az) * 0.05, 0.62, Math.sin(az) * 0.05)
        d.rotation.set(0, -az + Math.PI / 2, 0, 'YXZ')
        d.rotateX(-(0.25 + R(i, 2) * 0.6))
        const sc = big * (0.55 + R(i, 3) * 0.55)
        d.scale.set(sc * 0.9, sc, sc)
        d.updateMatrix()
        blades.setMatrixAt(i, d.matrix)
        c.set('#4f9a3d').offsetHSL((R(i, 4) - 0.5) * 0.05, 0, (R(i, 5) - 0.5) * 0.12)
        blades.setColorAt(i, c)
      }
    })
    blades.instanceMatrix.needsUpdate = true
    if (blades.instanceColor) blades.instanceColor.needsUpdate = true
    blades.castShadow = true
    blades.frustumCulled = false
    return {
      potGeo: new THREE.CylinderGeometry(0.55, 0.42, 0.7, 14),
      bladeGeo: blades.geometry,
      potMat: pbrMaterial(withRepeat(assets.terracotta(), 2, 1), { normalScale: 1.2 }),
      leafMat: new THREE.MeshPhysicalMaterial({
        map: leaf.map,
        normalMap: leaf.normalMap,
        roughnessMap: leaf.roughnessMap,
        side: THREE.DoubleSide,
        roughness: 0.9,
        sheen: 0.5,
        sheenColor: new THREE.Color('#bfe6a0'),
      }),
      topMat: pbrMaterial(withRepeat(assets.wood(), 1, 1), { color: '#d9c6a8' }),
      blades,
    }
  }, [seed])
  useEffect(() => {
    blades.material = leafMat
    return () => {
      potGeo.dispose()
      bladeGeo.dispose()
      potMat.dispose()
      leafMat.dispose()
      topMat.dispose()
      blades.dispose()
    }
  }, [potGeo, bladeGeo, potMat, leafMat, topMat, blades])
  return (
    <group position={position} rotation-y={rot}>
      <mesh position={[0, -0.15, 0]} receiveShadow castShadow material={topMat}>
        <boxGeometry args={[9, 0.3, 3.2]} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 4.1, (LEG_TOP + FLOOR_Y) / 2, sz * 1.2]}>
            <boxGeometry args={[0.28, LEG_H, 0.28]} />
            <meshStandardMaterial {...metal} />
          </mesh>
        )),
      )}
      {POTS_X.map((x) => (
        <mesh key={x} position={[x, 0.35, 0]} geometry={potGeo} material={potMat} castShadow receiveShadow />
      ))}
      <primitive object={blades} />
    </group>
  )
}
