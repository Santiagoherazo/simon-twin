import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisual } from '../visual'
import { PLANTER_D, PLANTER_W, PLANTER_WALL, SOIL_TOP } from './layout'

/** Esquinas de la matriz: clave del sensor → posición en el sustrato (x, z). NO = atrás-izquierda, SE = adelante-derecha. */
const CORNERS: [string, number, number][] = [
  ['ldr_nw', -1, -1],
  ['ldr_ne', 1, -1],
  ['ldr_sw', -1, 1],
  ['ldr_se', 1, 1],
]
const IX = PLANTER_W / 2 - PLANTER_WALL - 0.4
const IZ = PLANTER_D / 2 - PLANTER_WALL - 0.35

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Interpola las 4 esquinas (bilineal) en una imagen pequeña: azul = sombra, amarillo = mucha luz. */
function heatCanvas(v: number[]) {
  const W = 48, H = 24
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const img = g.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    const fy = y / (H - 1)
    for (let x = 0; x < W; x++) {
      const fx = x / (W - 1)
      // v = [NO, NE, SO, SE]
      const t = clamp01(((v[0] * (1 - fx) + v[1] * fx) * (1 - fy) + (v[2] * (1 - fx) + v[3] * fx) * fy) / 100)
      const i = (y * W + x) * 4
      img.data[i] = 40 + 215 * t
      img.data[i + 1] = 70 + 160 * t
      img.data[i + 2] = 200 - 150 * t
      img.data[i + 3] = 70 + 60 * (1 - Math.abs(t - 0.5) * 2)
    }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  return tex
}

/**
 * Matriz de luz: 4 fotorresistencias en las esquinas del sustrato. Cada una brilla según su lectura y entre
 * ellas se dibuja el mapa de luz interpolado (azul sombra → amarillo sol). Solo aparece si el dispositivo tiene ldr_*.
 */
export function LdrMatrix() {
  const sig = useVisual((v) => JSON.stringify(CORNERS.map(([k]) => {
    const s = v.sensors.find((x) => x.key === k)
    return typeof s?.value === 'number' ? Math.round(s.value * 2) / 2 : null
  })))
  const vals = useMemo(() => JSON.parse(sig) as (number | null)[], [sig])
  const have = vals.filter((x): x is number => x !== null)
  const mean = have.length ? have.reduce((a, b) => a + b, 0) / have.length : 0
  const filled = vals.map((x) => x ?? mean)
  const tex = useMemo(() => (have.length ? heatCanvas(filled) : null), [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tex?.dispose(), [tex])
  if (!have.length || !tex) return null
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, SOIL_TOP + 0.035, 0.05]} renderOrder={1}>
        <planeGeometry args={[IX * 2, IZ * 2]} />
        <meshBasicMaterial map={tex} transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
      {CORNERS.map(([key, sx, sz], i) => {
        const raw = vals[i]
        const lit = clamp01((raw ?? mean) / 100)
        return (
          <group key={key} position={[sx * IX, SOIL_TOP, sz * IZ + 0.05]}>
            <mesh position={[0, 0.2, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
              <meshStandardMaterial color="#222" />
            </mesh>
            <mesh position={[0, 0.44, 0]} rotation-x={-0.5}>
              <cylinderGeometry args={[0.19, 0.19, 0.05, 20]} />
              <meshStandardMaterial color={raw === null ? '#555' : '#b9873a'} emissive="#ffd27a" emissiveIntensity={raw === null ? 0 : 0.15 + 1.8 * lit} roughness={0.5} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
