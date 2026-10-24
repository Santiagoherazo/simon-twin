import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { plantVisualHeight, useVisual } from '../visual'
import { PLANT_POS } from './layout'
import { assets, withRepeat } from './assets'
import { leafMaterial } from './materials'
import { reducedMotion, sm } from './smooth'

// ---------- utilidades ----------
const YELLOW = new THREE.Color('#cdbb3c')
const DRY = new THREE.Color('#9a8446')
const STRAW = new THREE.Color('#b9a45a')

/** Seudoaleatorio determinista por índice (la mata se ve igual en cada carga). */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Tono de la hoja: verde sano → amarillento según salud → seco según marchitez. */
function tint(out: THREE.Color, healthy: string, health: number, wilt: number) {
  out.set(healthy)
  out.lerp(YELLOW, Math.min(1, (1 - health) * 0.95))
  out.lerp(DRY, wilt * 0.5)
  return out
}

function useDisposables<T extends { dispose(): void }>(items: T[]) {
  useEffect(
    () => () => {
      items.forEach((i) => i.dispose())
    },
    [items],
  )
}

/** Tallo con estrías (maíz) o con pelusilla fina (tomate): reutiliza el relieve de la hoja. */
function stemMaterial(kind: 'maize' | 'tomato', color: string) {
  const p = withRepeat(assets.leaf(kind), kind === 'maize' ? 5 : 3, 2.5)
  return new THREE.MeshPhysicalMaterial({
    color,
    map: p.map,
    normalMap: p.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: p.roughnessMap,
    roughness: 0.9,
    sheen: 0.4,
    sheenColor: new THREE.Color('#cfeaa8'),
  })
}

// ---------- hoja de maíz: cinta curvada con pliegue central ----------
const MR = 9 // filas a lo largo de la hoja

function makeMaizeLeaf() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MR * 9), 3))
  const col = new Float32Array(MR * 9)
  for (let r = 0; r < MR; r++) {
    const s = r / (MR - 1)
    const edge = 0.74 + 0.2 * s
    const mid = 1.0 + 0.1 * (1 - s) // nervadura central más clara
    const v = [edge, mid, edge]
    for (let k = 0; k < 3; k++) col.set([v[k], v[k], v[k]], (r * 3 + k) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const uv = new Float32Array(MR * 6)
  for (let r = 0; r < MR; r++) uv.set([0, r / (MR - 1), 0.5, r / (MR - 1), 1, r / (MR - 1)], r * 6)
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  const idx: number[] = []
  for (let r = 0; r < MR - 1; r++)
    for (let k = 0; k < 2; k++) {
      const a = r * 3 + k
      const c = (r + 1) * 3 + k
      idx.push(a, a + 1, c, a + 1, c + 1, c)
    }
  g.setIndex(idx)
  return g
}

function fillMaizeLeaf(g: THREE.BufferGeometry, bx: number, by: number, bz: number, az: number, len: number, width: number, elev0: number, bend: number) {
  const p = g.attributes.position.array as Float32Array
  const dx = Math.cos(az)
  const dz = Math.sin(az)
  const sx = -dz
  const sz = dx
  const step = len / (MR - 1)
  let x = bx
  let y = by
  let z = bz
  for (let r = 0; r < MR; r++) {
    const s = r / (MR - 1)
    const w = width * (0.9 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.6)), 0.9) + 0.14 * (1 - s))
    const sag = w * 0.38
    p.set([x + sx * w, y - sag, z + sz * w, x, y, z, x - sx * w, y - sag, z - sz * w], r * 9)
    const th = elev0 - bend * Math.pow(s, 1.4)
    x += step * Math.cos(th) * dx
    z += step * Math.cos(th) * dz
    y += step * Math.sin(th)
  }
  g.attributes.position.needsUpdate = true
  g.computeVertexNormals()
}

// ---------- hoja compuesta de tomate: raquis + foliolos ----------
const TR = 6
const LEAFLET_ROWS = [1, 2, 3, 4]
const T_VERTS = TR * 2 + (LEAFLET_ROWS.length * 2 + 1) * 4

function makeTomatoLeaf() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(T_VERTS * 3), 3))
  const col = new Float32Array(T_VERTS * 3)
  col.fill(0.9, 0, TR * 6)
  for (let j = 0; j < LEAFLET_ROWS.length * 2 + 1; j++) {
    const b = TR * 2 + j * 4
    const v = [0.66, 0.95, 1.05, 0.95]
    for (let k = 0; k < 4; k++) col.set([v[k], v[k], v[k]], (b + k) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const uv = new Float32Array(T_VERTS * 2)
  for (let r = 0; r < TR; r++) uv.set([0.46, r / (TR - 1), 0.54, r / (TR - 1)], r * 4)
  for (let j = 0; j < LEAFLET_ROWS.length * 2 + 1; j++) uv.set([0.5, 0, 1, 0.42, 0.5, 1, 0, 0.42], (TR * 2 + j * 4) * 2)
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  const idx: number[] = []
  for (let r = 0; r < TR - 1; r++) idx.push(2 * r, 2 * r + 1, 2 * r + 2, 2 * r + 1, 2 * r + 3, 2 * r + 2)
  for (let j = 0; j < LEAFLET_ROWS.length * 2 + 1; j++) {
    const b = TR * 2 + j * 4
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  g.setIndex(idx)
  return g
}

const RX = new Float32Array(TR)
const RY = new Float32Array(TR)
const RZ = new Float32Array(TR)
const TX = new Float32Array(TR)
const TY = new Float32Array(TR)
const TZ = new Float32Array(TR)

function leaflet(p: Float32Array, base: number, qx: number, qy: number, qz: number, ax: number, ay: number, az: number, lf: number) {
  const n = Math.hypot(ax, ay, az) || 1
  ax /= n
  ay /= n
  az /= n
  let bx = -az
  let bz = ax
  const bn = Math.hypot(bx, bz)
  if (bn < 1e-3) {
    bx = 1
    bz = 0
  } else {
    bx /= bn
    bz /= bn
  }
  const w = lf * 0.3
  p.set(
    [
      qx, qy, qz,
      qx + ax * lf * 0.45 + bx * w, qy + ay * lf * 0.45 + 0.02 * lf, qz + az * lf * 0.45 + bz * w,
      qx + ax * lf, qy + ay * lf, qz + az * lf,
      qx + ax * lf * 0.45 - bx * w, qy + ay * lf * 0.45 + 0.02 * lf, qz + az * lf * 0.45 - bz * w,
    ],
    base * 3,
  )
}

function fillTomatoLeaf(g: THREE.BufferGeometry, bx: number, by: number, bz: number, az: number, len: number, lf: number, elev0: number, bend: number, wilt: number) {
  const p = g.attributes.position.array as Float32Array
  const dx = Math.cos(az)
  const dz = Math.sin(az)
  const sx = -dz
  const sz = dx
  let x = bx
  let y = by
  let z = bz
  for (let r = 0; r < TR; r++) {
    const s = r / (TR - 1)
    const th = elev0 - bend * Math.pow(s, 1.3)
    TX[r] = Math.cos(th) * dx
    TY[r] = Math.sin(th)
    TZ[r] = Math.cos(th) * dz
    RX[r] = x
    RY[r] = y
    RZ[r] = z
    const st = len / (TR - 1)
    x += st * TX[r]
    y += st * TY[r]
    z += st * TZ[r]
    const w = 0.03 * (1 - 0.6 * s)
    p.set([RX[r] + sx * w, RY[r], RZ[r] + sz * w, RX[r] - sx * w, RY[r], RZ[r] - sz * w], r * 6)
  }
  let j = 0
  for (const r of LEAFLET_ROWS) {
    const s = r / (TR - 1)
    const size = lf * (0.7 + 0.3 * Math.sin(Math.PI * s)) * (1 - 0.3 * wilt)
    for (const sign of [1, -1]) {
      leaflet(p, TR * 2 + j * 4, RX[r], RY[r], RZ[r], sign * sx * 0.85 + TX[r] * 0.55, TY[r] * 0.55 - 0.15 - wilt * 0.7, sign * sz * 0.85 + TZ[r] * 0.55, size)
      j++
    }
  }
  const e = TR - 1
  leaflet(p, TR * 2 + j * 4, RX[e], RY[e], RZ[e], TX[e], TY[e] - wilt * 0.5, TZ[e], lf * 1.15 * (1 - 0.3 * wilt))
  g.attributes.position.needsUpdate = true
  g.computeVertexNormals()
}

// ---------- maíz ----------
function Maize({ n, tassel, ears }: { n: number; tassel: boolean; ears: boolean }) {
  const geos = useMemo(() => Array.from({ length: n }, makeMaizeLeaf), [n])
  const leafMat = useMemo(() => leafMaterial(assets.leaf('maize')), [])
  const stemMat = useMemo(() => stemMaterial('maize', '#7fae52'), [])
  const stemGeo = useMemo(() => new THREE.CylinderGeometry(0.07, 0.11, 1, 10).translate(0, 0.5, 0), [])
  const tasselMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9c56b', roughness: 0.8 }), [])
  const branchGeo = useMemo(() => new THREE.CylinderGeometry(0.01, 0.022, 0.9, 5), [])
  const spikeGeo = useMemo(() => new THREE.CylinderGeometry(0.02, 0.045, 1.15, 6), [])
  const earGeo = useMemo(() => new THREE.CapsuleGeometry(0.17, 0.66, 4, 10), [])
  const earMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9ccb68', roughness: 0.65 }), [])
  const silkGeo = useMemo(() => new THREE.ConeGeometry(0.07, 0.3, 6), [])
  const silkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b98a52', roughness: 0.9 }), [])
  useDisposables(geos)
  useDisposables(useMemo(() => [leafMat, stemMat, stemGeo, tasselMat, branchGeo, spikeGeo, earGeo, earMat, silkGeo, silkMat], [leafMat, stemMat, stemGeo, tasselMat, branchGeo, spikeGeo, earGeo, earMat, silkGeo, silkMat]))

  const root = useRef<THREE.Group>(null)
  const stem = useRef<THREE.Mesh>(null)
  const tassels = useRef<THREE.Group>(null)
  const earRefs = useRef<(THREE.Group | null)[]>([])
  const last = useRef<{ h: number; w: number; g?: unknown }>({ h: -1, w: -1 })

  useFrame(({ clock }) => {
    const H = plantVisualHeight(sm.heightCm)
    const wilt = sm.wilt
    if (last.current.g !== geos || Math.abs(H - last.current.h) > 0.002 || Math.abs(wilt - last.current.w) > 0.002) {
      last.current = { h: H, w: wilt, g: geos }
      const stemR = 0.06 + 0.012 * H
      geos.forEach((g, i) => {
        const t = n > 1 ? i / (n - 1) : 0.5
        const y = H * (0.1 + 0.78 * t)
        const az = i * Math.PI + (rnd(i) - 0.5) * 0.7
        const len = (0.5 + 0.5 * H) * (0.55 + 0.45 * Math.sin(Math.PI * (0.2 + 0.65 * t))) * (1 - 0.12 * wilt)
        const width = 0.07 + 0.04 * len
        const elev0 = 0.8 + 0.45 * t - wilt * 0.5
        const bend = 1.9 - 0.6 * t + wilt * 1.1
        fillMaizeLeaf(g, Math.cos(az) * stemR, y, Math.sin(az) * stemR, az, len, width, elev0, bend)
      })
    }
    tint(leafMat.color, '#4e9a3a', sm.health, wilt)
    stemMat.color.set('#7fae52').lerp(STRAW, wilt * 0.55)
    if (stem.current) {
      const r = 0.7 + 0.13 * H
      stem.current.scale.set(r, H, r)
    }
    if (tassels.current) {
      tassels.current.position.y = H
      const s = 0.65 + 0.06 * H
      tassels.current.scale.setScalar(s)
    }
    earRefs.current.forEach((e, k) => {
      if (!e) return
      const a = k * Math.PI + 0.9
      const r = 0.12 + 0.012 * H
      e.position.set(Math.cos(a) * r, H * (0.52 - 0.12 * k), Math.sin(a) * r)
      e.rotation.y = -a
      e.scale.setScalar(0.75 + 0.06 * H)
    })
    if (root.current) {
      const sway = reducedMotion() ? 0 : Math.sin(clock.elapsedTime * 0.9) * 0.012 * (1 + 0.5 * sm.lai * 0.2)
      root.current.rotation.z = sway + sm.wilt * 0.05
    }
  })

  return (
    <group ref={root}>
      <mesh ref={stem} geometry={stemGeo} material={stemMat} castShadow />
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={leafMat} castShadow receiveShadow frustumCulled={false} />
      ))}
      {ears &&
        [0, 1].map((k) => (
          <group key={k} ref={(el) => (earRefs.current[k] = el)}>
            <group rotation-z={-0.5}>
              <mesh geometry={earGeo} material={earMat} position-y={0.45} castShadow />
              <mesh geometry={silkGeo} material={silkMat} position-y={1.0} />
            </group>
          </group>
        ))}
      {tassel && (
        <group ref={tassels}>
          <mesh geometry={spikeGeo} material={tasselMat} position-y={0.55} castShadow />
          {Array.from({ length: 8 }, (_, k) => (
            <group key={k} rotation-y={(k * Math.PI) / 4} position-y={0.3 + 0.12 * (k % 2)}>
              <group rotation-z={-1.0 - 0.18 * (k % 2)}>
                <mesh geometry={branchGeo} material={tasselMat} position-y={0.45} castShadow />
              </group>
            </group>
          ))}
        </group>
      )}
    </group>
  )
}

// ---------- tomate ----------
function Tomato({ n, fruit }: { n: number; fruit: boolean }) {
  const geos = useMemo(() => Array.from({ length: n }, makeTomatoLeaf), [n])
  const leafMat = useMemo(() => leafMaterial(assets.leaf('tomato'), { roughness: 1 }), [])
  const stemMat = useMemo(() => stemMaterial('tomato', '#6f9f48'), [])
  const stemGeo = useMemo(() => new THREE.CylinderGeometry(0.05, 0.085, 1, 8).translate(0, 0.5, 0), [])
  const fruitGeo = useMemo(() => new THREE.SphereGeometry(0.3, 16, 12), [])
  const fruitMats = useMemo(() => ['#d8372a', '#e87a2c', '#86b43f'].map((c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 })), [])
  useDisposables(geos)
  useDisposables(useMemo(() => [leafMat, stemMat, stemGeo, fruitGeo, ...fruitMats], [leafMat, stemMat, stemGeo, fruitGeo, fruitMats]))

  const root = useRef<THREE.Group>(null)
  const stem = useRef<THREE.Mesh>(null)
  const trusses = useRef<(THREE.Group | null)[]>([])
  const last = useRef<{ h: number; w: number; g?: unknown }>({ h: -1, w: -1 })

  useFrame(({ clock }) => {
    const H = plantVisualHeight(sm.heightCm)
    const wilt = sm.wilt
    if (last.current.g !== geos || Math.abs(H - last.current.h) > 0.002 || Math.abs(wilt - last.current.w) > 0.002) {
      last.current = { h: H, w: wilt, g: geos }
      const stemR = 0.05 + 0.01 * H
      geos.forEach((g, i) => {
        const t = n > 1 ? i / (n - 1) : 0.5
        const y = H * (0.08 + 0.84 * t)
        const az = i * 2.39996
        const len = (0.8 + 0.34 * H) * (0.6 + 0.4 * Math.sin(Math.PI * (0.15 + 0.7 * t))) * (1 - 0.1 * wilt)
        fillTomatoLeaf(g, Math.cos(az) * stemR, y, Math.sin(az) * stemR, az, len, len * 0.3, 0.55 - wilt * 0.5 + 0.2 * t, 1.0 + wilt * 1.2, wilt)
      })
    }
    tint(leafMat.color, '#3f8a34', sm.health, wilt)
    stemMat.color.set('#6f9f48').lerp(STRAW, wilt * 0.5)
    if (stem.current) {
      const r = 0.7 + 0.12 * H
      stem.current.scale.set(r, H, r)
    }
    trusses.current.forEach((g, k) => {
      if (!g) return
      const a = k * 2.1 + 0.6
      const r = 0.2 + 0.02 * H
      g.position.set(Math.cos(a) * r, H * (0.34 + 0.15 * k), Math.sin(a) * r)
      g.rotation.y = -a
      g.scale.setScalar(0.75 + 0.05 * H)
    })
    if (root.current) root.current.rotation.z = (reducedMotion() ? 0 : Math.sin(clock.elapsedTime * 0.9) * 0.012) + wilt * 0.05
  })

  const fruitOffsets: [number, number, number][] = [[0.45, -0.25, 0], [0.7, -0.5, 0.25], [0.65, -0.55, -0.25]]
  return (
    <group ref={root}>
      <mesh ref={stem} geometry={stemGeo} material={stemMat} castShadow />
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={leafMat} castShadow receiveShadow frustumCulled={false} />
      ))}
      {fruit &&
        [0, 1, 2].map((k) => (
          <group key={k} ref={(el) => (trusses.current[k] = el)}>
            {fruitOffsets.map((o, j) => (
              <mesh key={j} geometry={fruitGeo} material={fruitMats[k]} position={o} scale={1 - 0.12 * j} castShadow />
            ))}
          </group>
        ))}
    </group>
  )
}

/** Mata procedural: la estructura discreta se reconstruye; altura, marchitez y tono se animan cada fotograma. */
export function Plant() {
  const cropId = useVisual((v) => v.cropId)
  const leafCount = useVisual((v) => v.plant.leafCount)
  const tassel = useVisual((v) => v.plant.hasTassel)
  const fruit = useVisual((v) => v.plant.hasFruit)
  const tomato = cropId === 'tomate'
  return (
    <group position={PLANT_POS}>
      {tomato ? (
        <Tomato key="tomate" n={Math.min(14, Math.max(3, leafCount))} fruit={fruit} />
      ) : (
        <Maize key="maiz" n={Math.min(16, Math.max(3, leafCount))} tassel={tassel} ears={fruit} />
      )}
    </group>
  )
}
