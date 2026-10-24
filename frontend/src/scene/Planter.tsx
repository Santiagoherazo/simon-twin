import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { soilRgb } from '../visual'
import { FRONT_Z, lamp, PLANT_POS, PLANTER_D, PLANTER_W, PLANTER_WALL, PROBE_POS, SOIL_TOP } from './layout'
import { reducedMotion, sm } from './smooth'
import { plantVisualHeight, useVisual } from '../visual'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { assets } from './assets'
import { glowTexture } from './textures'

// Matera interior negra con ventanas: : se ve el perfil del suelo por capas, la grava de drenaje,
// las raíces y la sonda del sensor. 1 unidad = 10 cm.
const LAYERS = 6
const BASE = 0.14 // grosor del fondo
const GRAVEL_H = 0.28
const WALL = PLANTER_WALL
const RIM_Y = SOIL_TOP + 0.1
const SOIL_X = PLANTER_W - WALL * 2
const SOIL_Z0 = -PLANTER_D / 2 + WALL // cara trasera interior
const SOIL_DEPTH = FRONT_Z - SOIL_Z0 // hasta la cara frontal
const GAUGE_X0 = 1.95
const GAUGE_X1 = 2.4
const GAUGE_Y0 = 0.4
const GAUGE_Y1 = 1.7
const SOIL_WIN = { x0: -2.6, x1: -0.4, y0: 0.5, y1: 1.95 }
const R_OUT = 0.62 // radio de las esquinas (vistas desde arriba)
const SOIL_BOTTOM = BASE + GRAVEL_H
const LAYER_H = (SOIL_TOP - SOIL_BOTTOM) / LAYERS

const PROBE_Y0 = 0.55
const PROBE_Y1 = 2.6
const CONTROLLER_POS = new THREE.Vector3(-4.0, 0.2, 0.9)

/** Raíces dibujadas sobre la cara cortada: crecen con la planta. */
function Roots() {
  const group = useRef<THREE.Group>(null)
  const { geos, mat } = useMemo(() => {
    const mk = (pts: [number, number][], r: number) => {
      const c = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)))
      return new THREE.TubeGeometry(c, 18, r, 5, false)
    }
    // origen en (0,0): la raíz principal baja hacia -y; se escala en y según la edad
    const geos = [
      mk([[0, 0], [0.02, -0.5], [-0.05, -1.0], [0.0, -1.55]], 0.026),
      mk([[0, -0.15], [-0.35, -0.35], [-0.65, -0.72], [-0.72, -1.15]], 0.018),
      mk([[0, -0.15], [0.35, -0.3], [0.62, -0.66], [0.78, -1.05]], 0.018),
      mk([[-0.05, -0.55], [-0.4, -0.78], [-0.52, -1.2]], 0.014),
      mk([[0.02, -0.6], [0.34, -0.85], [0.48, -1.28]], 0.014),
      mk([[-0.2, -0.3], [-0.5, -0.45], [-0.95, -0.6]], 0.012),
      mk([[0.2, -0.3], [0.55, -0.42], [0.95, -0.58]], 0.012),
    ]
    const mat = new THREE.MeshStandardMaterial({ color: '#efe4c4', roughness: 0.9 })
    return { geos, mat }
  }, [])
  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose())
      mat.dispose()
    },
    [geos, mat],
  )
  useFrame(() => {
    const g = group.current
    if (!g) return
    const growth = Math.min(1, 0.22 + 0.78 * (sm.heightCm / 130))
    g.scale.set(0.55 + 0.45 * growth, growth, 1)
  })
  return (
    <group ref={group} position={[PLANT_POS[0], SOIL_TOP - 0.02, FRONT_Z + 0.004]}>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} />
      ))}
    </group>
  )
}

function Probe() {
  const glow = useRef<THREE.Sprite>(null)
  const tex = useMemo(() => glowTexture(), [])
  useEffect(() => () => tex.dispose(), [tex])
  const cable = useMemo(() => {
    const top = new THREE.Vector3(PROBE_POS[0], PROBE_Y1, PROBE_POS[2])
    const c = new THREE.CatmullRomCurve3([
      top,
      new THREE.Vector3(top.x - 0.1, PROBE_Y1 + 0.5, top.z + 0.3),
      new THREE.Vector3(-2.6, 2.7, 1.9),
      new THREE.Vector3(CONTROLLER_POS.x + 0.2, 1.0, CONTROLLER_POS.z + 0.3),
      new THREE.Vector3(CONTROLLER_POS.x + 0.1, 0.55, CONTROLLER_POS.z),
    ])
    return new THREE.TubeGeometry(c, 36, 0.025, 6, false)
  }, [])
  useEffect(() => () => cable.dispose(), [cable])

  useFrame(({ clock }) => {
    const s = glow.current
    if (!s) return
    const mat = s.material as THREE.SpriteMaterial
    // verde con agua suficiente, ámbar cerca del umbral, rojo seco
    if (sm.wet > 0.5) mat.color.set('#5be08f')
    else if (sm.wet > 0.25) mat.color.set('#ffc34d')
    else mat.color.set('#ff5a4d')
    const pulse = reducedMotion() ? 1 : 0.85 + 0.15 * Math.sin(clock.elapsedTime * 3)
    s.scale.setScalar(0.62 * pulse)
  })

  return (
    <group>
      {/* placa del sensor capacitivo */}
      <mesh position={[PROBE_POS[0], (PROBE_Y0 + PROBE_Y1) / 2, PROBE_POS[2]]} castShadow>
        <boxGeometry args={[0.3, PROBE_Y1 - PROBE_Y0, 0.045]} />
        <meshStandardMaterial color="#1f5a3c" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[PROBE_POS[0], PROBE_Y1 - 0.18, PROBE_POS[2] + 0.026]}>
        <boxGeometry args={[0.2, 0.2, 0.012]} />
        <meshStandardMaterial color="#d8d8d0" roughness={0.4} metalness={0.6} />
      </mesh>
      <sprite ref={glow} position={[PROBE_POS[0], 1.3, PROBE_POS[2] + 0.1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} color="#5be08f" />
      </sprite>
      <mesh geometry={cable}>
        <meshStandardMaterial color="#222a31" roughness={0.6} />
      </mesh>
      {/* caja del microcontrolador */}
      <mesh position={CONTROLLER_POS} castShadow>
        <boxGeometry args={[0.95, 0.36, 0.58]} />
        <meshStandardMaterial color="#1c3350" roughness={0.45} />
      </mesh>
      <mesh position={[CONTROLLER_POS.x + 0.3, CONTROLLER_POS.y + 0.19, CONTROLLER_POS.z + 0.1]}>
        <sphereGeometry args={[0.035, 10, 8]} />
        <meshBasicMaterial color="#59ff9a" />
      </mesh>
    </group>
  )
}

const rb = (w: number, h: number, d: number, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))

/** Piedritas de perlita y mantillo sobre la superficie: rompen la línea recta del suelo. */
function TopStones() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const N = 150
  useEffect(() => {
    const m = mesh.current
    if (!m) return
    const d = new THREE.Object3D()
    const c = new THREE.Color()
    const R = (i: number, k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    let n = 0
    for (let i = 0; i < N * 3 && n < N; i++) {
      const x = (R(i, 1) - 0.5) * (SOIL_X - 0.15)
      const z = SOIL_Z0 + 0.08 + R(i, 2) * (SOIL_DEPTH - 0.16)
      if (Math.hypot(x - PLANT_POS[0], z - 0.05) < 0.22) continue // la base del tallo
      if (Math.abs(x - PROBE_POS[0]) < 0.22 && z > FRONT_Z - 0.3) continue // la sonda
      const s = 0.025 + R(i, 3) * 0.055
      d.position.set(x, SOIL_TOP + s * 0.35, z)
      d.rotation.set(R(i, 4) * 6, R(i, 5) * 6, R(i, 6) * 6)
      d.scale.set(s, s * (0.55 + R(i, 7) * 0.35), s * (0.8 + R(i, 8) * 0.4))
      d.updateMatrix()
      m.setMatrixAt(n, d.matrix)
      const pale = R(i, 9) > 0.45
      c.set(pale ? '#d9d4c4' : '#6b5b48').multiplyScalar(0.8 + R(i, 10) * 0.4)
      m.setColorAt(n, c)
      n++
    }
    m.count = n
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={0.85} />
    </instancedMesh>
  )
}

// ---------- cuerpo negro de esquinas redondeadas, con ventanas recortadas ----------
function roundedRect(path: THREE.Path | THREE.Shape, x0: number, y0: number, x1: number, y1: number, r: number) {
  path.moveTo(x0 + r, y0)
  path.lineTo(x1 - r, y0)
  path.quadraticCurveTo(x1, y0, x1, y0 + r)
  path.lineTo(x1, y1 - r)
  path.quadraticCurveTo(x1, y1, x1 - r, y1)
  path.lineTo(x0 + r, y1)
  path.quadraticCurveTo(x0, y1, x0, y1 - r)
  path.lineTo(x0, y0 + r)
  path.quadraticCurveTo(x0, y0, x0 + r, y0)
}

/** Extruye un rectángulo redondeado (visto desde arriba) hacia +y; con `wall` queda hueco como un aro. */
function plan(w: number, d: number, r: number, height: number, bevel: number, wall = 0) {
  const sh = new THREE.Shape()
  roundedRect(sh, -w / 2, -d / 2, w / 2, d / 2, r)
  if (wall > 0) {
    const hole = new THREE.Path()
    roundedRect(hole, -w / 2 + wall, -d / 2 + wall, w / 2 - wall, d / 2 - wall, Math.max(0.05, r - wall))
    sh.holes.push(hole)
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 16 })
  g.rotateX(-Math.PI / 2)
  return g
}

function windowCutter(x0: number, y0: number, x1: number, y1: number, r: number) {
  const sh = new THREE.Shape()
  roundedRect(sh, x0, y0, x1, y1, r)
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1.0, bevelEnabled: false, curveSegments: 12 })
  g.translate(0, 0, FRONT_Z - 0.3)
  return g
}

/** Marco fino alrededor de una ventana (frente de la matera). */
function bezel(x0: number, y0: number, x1: number, y1: number, r: number, t: number) {
  const sh = new THREE.Shape()
  roundedRect(sh, x0 - t, y0 - t, x1 + t, y1 + t, r + t)
  const hole = new THREE.Path()
  roundedRect(hole, x0, y0, x1, y1, r)
  sh.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 12 })
  g.translate(0, 0, PLANTER_D / 2 + 0.01)
  return g
}

function bodyGeometry() {
  const ring = plan(PLANTER_W, PLANTER_D, R_OUT, RIM_Y, 0.04, WALL)
  ring.deleteAttribute('uv')
  const ev = new Evaluator()
  ev.useGroups = false
  ev.attributes = ['position', 'normal']
  let b = new Brush(ring)
  b.updateMatrixWorld()
  for (const c of [
    windowCutter(SOIL_WIN.x0, SOIL_WIN.y0, SOIL_WIN.x1, SOIL_WIN.y1, 0.16),
    windowCutter(GAUGE_X0, GAUGE_Y0 - 0.05, GAUGE_X1, GAUGE_Y1 + 0.05, 0.2),
  ]) {
    c.deleteAttribute('uv')
    const cb = new Brush(c)
    cb.updateMatrixWorld()
    b = ev.evaluate(b, cb, SUBTRACTION)
    b.updateMatrixWorld()
  }
  const g = toCreasedNormals(b.geometry, Math.PI / 5)
  return g
}

function ledTexture() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#050607'
  g.fillRect(0, 0, 1024, 256)
  const cols = ['#ffffff', '#fff4e6', '#7aa2ff', '#ff5d8a', '#fff4e6', '#ffffff']
  const nx = 46
  const ny = 7
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = 40 + (i * (1024 - 80)) / (nx - 1)
      const y = 34 + (j * (256 - 68)) / (ny - 1)
      const col = cols[(i + j * 2) % cols.length]
      g.fillStyle = col
      g.shadowColor = col
      g.shadowBlur = 8
      g.beginPath()
      g.arc(x, y, 5.5, 0, Math.PI * 2)
      g.fill()
    }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const LAMP_W = 6.2
const LAMP_D = 2.0
const POLE = { x: 0.75, z: -0.98 }

/**
 * Lámpara de cultivo ovalada con poste grueso: el panel sube con la planta, se enciende más de noche y su barra
 * delantera cambia de color según el estado (verde bien, ámbar con sed, rojo con alerta).
 */
function GrowLamp() {
  const group = useRef<THREE.Group>(null)
  const pole = useRef<THREE.Mesh>(null)
  const led = useRef<THREE.MeshStandardMaterial>(null)
  const bead = useRef<THREE.MeshBasicMaterial>(null)
  const alert = useVisual((v) => v.alerts.probe || v.alerts.tank || v.alerts.pump)
  const tex = useMemo(() => ledTexture(), [])
  const slab = useMemo(() => {
    const g = plan(LAMP_W - 0.1, LAMP_D - 0.1, (LAMP_D - 0.1) / 2 - 0.01, 0.12, 0.05)
    g.translate(0, -0.06, 0)
    return g
  }, [])
  const poleGeo = useMemo(() => rb(0.34, 1, 0.3, 0.1), [])
  const black = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#08090a', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.9 }), [])
  useEffect(
    () => () => {
      tex.dispose()
      slab.dispose()
      poleGeo.dispose()
      black.dispose()
    },
    [tex, slab, poleGeo, black],
  )
  const col = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    const want = Math.max(6.2, SOIL_TOP + plantVisualHeight(sm.heightCm) + 1.9)
    lamp.y += (want - lamp.y) * Math.min(1, dt * 2.5)
    lamp.on = 0.35 + 0.65 * (1 - sm.day)
    if (group.current) group.current.position.y = lamp.y
    if (pole.current) {
      const h = lamp.y - RIM_Y
      pole.current.scale.y = h
      pole.current.position.y = RIM_Y + h / 2
    }
    if (led.current) led.current.emissiveIntensity = 0.9 + 2.4 * lamp.on
    if (bead.current) {
      if (alert) col.set('#ff4d3d')
      else if (sm.wet < 0.28) col.set('#ffb020')
      else col.set('#4be08a')
      bead.current.color.copy(col)
    }
  })
  return (
    <>
      <mesh ref={pole} geometry={poleGeo} material={black} position={[POLE.x, RIM_Y + 2, POLE.z]} castShadow />
      <group ref={group} position={[0, 6.4, 0]}>
        <mesh geometry={slab} material={black} castShadow />
        <mesh geometry={poleGeo} material={black} position={[POLE.x, 0.0, POLE.z + 0.05]} scale={[1.5, 0.3, 1.3]} castShadow />
        <mesh position={[0, -0.0625, 0]} rotation-x={Math.PI / 2}>
          <planeGeometry args={[5.0, LAMP_D - 0.35]} />
          <meshStandardMaterial ref={led} map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={2} color="#111" roughness={0.4} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.0, (LAMP_D - 0.1) / 2 + 0.012]}>
          <boxGeometry args={[1.1, 0.04, 0.02]} />
          <meshBasicMaterial ref={bead} color="#4be08a" toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

// ---------- follaje denso (decorativo) ----------
/** Hoja ovada con nervio central, punta y concavidad, como la albahaca. */
function ovateLeaf() {
  const NU = 6
  const NT = 10
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= NT; j++) {
    const t = j / NT
    const w = 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.85) * (1 - 0.15 * t)
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * 2 - 1
      const x = u * w
      const z = 0.55 * x * x - 0.34 * t * t + 0.05 * Math.sin(t * 9 + u * 3) * w
      pos.push(x, t, z)
      uv.push(u * 0.5 + 0.5, t)
    }
  }
  for (let j = 0; j < NT; j++)
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i
      idx.push(a, a + 1, a + NU + 1, a + 1, a + NU + 2, a + NU + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const roundLeaf = (() => {
  const g = new THREE.CircleGeometry(0.5, 20)
  g.scale(0.9, 1, 1)
  g.translate(0, 0.5, 0)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const x = p.getX(i)
    p.setZ(i, -0.3 * y * y + 0.4 * x * x)
  }
  g.computeVertexNormals()
  return g
})()

interface Bush {
  x: number
  z: number
  r: number
  h: number
  n: number
  tone: string
  round?: boolean
}
const BUSHES: Bush[] = [
  { x: -0.15, z: -0.3, r: 0.85, h: 1.6, n: 90, tone: '#2f6f25' },
  { x: 0.95, z: 0.3, r: 0.7, h: 1.25, n: 70, tone: '#3a7d2c' },
  { x: 1.65, z: -0.3, r: 0.75, h: 1.75, n: 90, tone: '#285f21' },
  { x: 2.25, z: 0.35, r: 0.55, h: 0.95, n: 60, tone: '#32702a' },
  { x: 0.3, z: 0.62, r: 0.5, h: 0.8, n: 46, tone: '#478a33' },
  { x: -2.55, z: -0.5, r: 0.45, h: 0.85, n: 40, tone: '#3f7f30' },
  { x: -0.7, z: 0.72, r: 0.4, h: 0.5, n: 34, tone: '#4a8a34', round: true },
  { x: 1.75, z: 0.8, r: 0.4, h: 0.5, n: 34, tone: '#3f8030', round: true },
]

function Herbs() {
  const basil = useRef<THREE.InstancedMesh>(null)
  const round = useRef<THREE.InstancedMesh>(null)
  const fruit = useRef<THREE.InstancedMesh>(null)
  const leaf = useMemo(() => assets.leaf('tomato'), [])
  const geo = useMemo(() => ovateLeaf(), [])
  useEffect(() => () => geo.dispose(), [geo])
  const nBasil = BUSHES.filter((b) => !b.round).reduce((a, b) => a + b.n, 0)
  const nRound = BUSHES.filter((b) => b.round).reduce((a, b) => a + b.n, 0)
  useEffect(() => {
    const d = new THREE.Object3D()
    const c = new THREE.Color()
    const R = (i: number, k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    const fill = (m: THREE.InstancedMesh | null, list: Bush[]) => {
      if (!m) return
      let n = 0
      for (const b of list) {
        for (let i = 0; i < b.n; i++, n++) {
          const t = i / b.n
          const az = i * 2.399 + R(n, 1) * 0.8
          const ring = 0.15 + 0.85 * Math.sqrt(R(n, 2))
          const y = SOIL_TOP + 0.12 + b.h * (0.12 + 0.88 * R(n, 3)) * (1 - 0.4 * ring)
          d.position.set(b.x + Math.cos(az) * b.r * 0.6 * ring, y, b.z + Math.sin(az) * b.r * 0.6 * ring)
          const len = (b.round ? 0.42 : 0.62) + 0.34 * R(n, 4)
          d.rotation.set(0, -az + Math.PI / 2, 0)
          d.rotateX(-(0.45 + 0.95 * R(n, 5) + 0.25 * t))
          d.rotateY((R(n, 8) - 0.5) * 0.6)
          d.scale.set(len, len, len)
          d.updateMatrix()
          m.setMatrixAt(n, d.matrix)
          c.set(b.tone).offsetHSL((R(n, 6) - 0.5) * 0.05, 0.05 * R(n, 10), (R(n, 7) - 0.5) * 0.14)
          m.setColorAt(n, c)
        }
      }
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    fill(basil.current, BUSHES.filter((b) => !b.round))
    fill(round.current, BUSHES.filter((b) => b.round))
    const f = fruit.current
    if (f) {
      const spots: [number, number, number][] = [
        [1.25, SOIL_TOP + 0.85, 0.15], [1.5, SOIL_TOP + 0.7, 0.3], [1.35, SOIL_TOP + 1.05, 0.0], [1.6, SOIL_TOP + 0.5, 0.45],
        [1.15, SOIL_TOP + 0.55, 0.45], [1.7, SOIL_TOP + 0.95, 0.15], [1.4, SOIL_TOP + 0.3, 0.7], [1.95, SOIL_TOP + 0.4, 0.62],
        [1.05, SOIL_TOP + 0.3, 0.75], [1.8, SOIL_TOP + 0.2, 0.9], [0.8, SOIL_TOP + 0.45, 0.9], [-0.5, SOIL_TOP + 0.35, 0.95],
      ]
      spots.forEach((p, i) => {
        d.position.set(...p)
        d.rotation.set(0, 0, 0)
        d.scale.setScalar(0.15 + 0.035 * R(i, 9))
        d.updateMatrix()
        f.setMatrixAt(i, d.matrix)
      })
      f.instanceMatrix.needsUpdate = true
    }
  }, [])
  const mat = (
    <meshStandardMaterial map={leaf.map} normalMap={leaf.normalMap} roughnessMap={leaf.roughnessMap} roughness={0.62} side={THREE.DoubleSide} envMapIntensity={1} />
  )
  return (
    <>
      <instancedMesh ref={basil} args={[geo, undefined, nBasil]} castShadow receiveShadow frustumCulled={false}>
        {mat}
      </instancedMesh>
      <instancedMesh ref={round} args={[roundLeaf, undefined, nRound]} castShadow receiveShadow frustumCulled={false}>
        {mat}
      </instancedMesh>
      <instancedMesh ref={fruit} args={[undefined, undefined, 12]} castShadow>
        <sphereGeometry args={[1, 18, 12]} />
        <meshPhysicalMaterial color="#dc2a1a" roughness={0.28} clearcoat={0.9} clearcoatRoughness={0.2} />
      </instancedMesh>
    </>
  )
}

/** Ventana de nivel de agua: columna azul que sigue a sm.tank. */
function Gauge() {
  const water = useRef<THREE.Mesh>(null)
  const mid = (GAUGE_X0 + GAUGE_X1) / 2
  const H = GAUGE_Y1 - GAUGE_Y0
  useFrame(() => {
    const w = water.current
    if (!w) return
    const h = Math.max(0.005, H * sm.tank)
    w.scale.y = h
    w.position.y = GAUGE_Y0 + h / 2
  })
  return (
    <group>
      <mesh position={[mid, (GAUGE_Y0 + GAUGE_Y1) / 2, FRONT_Z - 0.1]}>
        <boxGeometry args={[GAUGE_X1 - GAUGE_X0 + 0.04, H + 0.12, 0.1]} />
        <meshStandardMaterial color="#eef3f5" roughness={0.5} />
      </mesh>
      <mesh ref={water} position={[mid, GAUGE_Y0 + 0.3, FRONT_Z - 0.03]}>
        <boxGeometry args={[GAUGE_X1 - GAUGE_X0 - 0.08, 1, 0.07]} />
        <meshPhysicalMaterial color="#4fa9e8" emissive="#1470b8" emissiveIntensity={0.35} roughness={0.1} clearcoat={1} />
      </mesh>
      {[0, 1, 2, 3, 4].map((k) => (
        <mesh key={k} position={[GAUGE_X1 - 0.12, GAUGE_Y0 + (H * k) / 4, PLANTER_D / 2 + 0.04]}>
          <boxGeometry args={[k % 2 ? 0.1 : 0.18, 0.014, 0.01]} />
          <meshBasicMaterial color="#c9444a" />
        </mesh>
      ))}
      <mesh position={[mid, (GAUGE_Y0 + GAUGE_Y1) / 2, PLANTER_D / 2 + 0.005]}>
        <planeGeometry args={[GAUGE_X1 - GAUGE_X0, H]} />
        <meshPhysicalMaterial color="#ffffff" transparent opacity={0.12} roughness={0.04} clearcoat={1} depthWrite={false} />
      </mesh>
    </group>
  )
}

export function Planter() {
  const soil = useMemo(() => assets.soil(), [])
  const gravel = useMemo(() => assets.gravel(), [])
  const plastic = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#08090a', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.9 }), [])
  const trim = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#2a3034', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 1.4 }), [])
  const geo = useMemo(
    () => ({
      body: bodyGeometry(),
      lip: plan(PLANTER_W + 0.06, PLANTER_D + 0.06, R_OUT + 0.03, 0.1, 0.03, 0.24),
      topSoil: plan(PLANTER_W - WALL * 2, PLANTER_D - WALL * 2, R_OUT - WALL, LAYER_H * 1.002, 0),
      base: plan(PLANTER_W - 0.12, PLANTER_D - 0.12, R_OUT - 0.06, BASE, 0.02),
      bezelSoil: bezel(SOIL_WIN.x0, SOIL_WIN.y0, SOIL_WIN.x1, SOIL_WIN.y1, 0.16, 0.05),
      bezelGauge: bezel(GAUGE_X0, GAUGE_Y0 - 0.05, GAUGE_X1, GAUGE_Y1 + 0.05, 0.2, 0.05),
    }),
    [],
  )
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose())
      plastic.dispose()
      trim.dispose()
    },
    [geo, plastic, trim],
  )
  const layerMats = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  useFrame(() => {
    for (let i = 0; i < LAYERS; i++) {
      const m = layerMats.current[i]
      if (!m) continue
      const d = i / (LAYERS - 1)
      const w = sm.wet + 0.05 - 0.13 * d
      const [r, g, b] = soilRgb(w)
      m.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(1.7)
      m.roughness = 1 - 0.55 * Math.min(1, Math.max(0, w))
    }
  })
  const soilMat = (i: number) => (
    <meshStandardMaterial
      ref={(el) => (layerMats.current[i] = el)}
      map={soil.map}
      normalMap={soil.normalMap}
      roughnessMap={soil.roughnessMap}
      normalScale={new THREE.Vector2(1.6, 1.6)}
      roughness={1}
    />
  )
  const LX0 = -2.55
  const LX1 = GAUGE_X0 - 0.1
  const wMid = (LX0 + LX1) / 2
  const wLen = LX1 - LX0
  const zMid = SOIL_Z0 + SOIL_DEPTH / 2
  return (
    <group>
      <mesh geometry={geo.body} material={plastic} castShadow receiveShadow />
      <mesh geometry={geo.base} material={plastic} receiveShadow />
      <mesh geometry={geo.lip} material={plastic} position={[0, RIM_Y - 0.04, 0]} castShadow />
      <mesh geometry={geo.bezelSoil} material={trim} />
      <mesh geometry={geo.bezelGauge} material={trim} />

      {/* grava + capas de suelo (solo hasta la columna de agua) */}
      <mesh position={[wMid, BASE + GRAVEL_H / 2, zMid]} receiveShadow>
        <boxGeometry args={[wLen, GRAVEL_H, SOIL_DEPTH]} />
        <meshStandardMaterial map={gravel.map} normalMap={gravel.normalMap} roughnessMap={gravel.roughnessMap} normalScale={new THREE.Vector2(1.3, 1.3)} roughness={1} />
      </mesh>
      {Array.from({ length: LAYERS - 1 }, (_, i) => (
        <mesh key={i} position={[wMid, SOIL_BOTTOM + LAYER_H * (i + 0.5), zMid]} receiveShadow>
          <boxGeometry args={[wLen, LAYER_H * 1.002, SOIL_DEPTH]} />
          {soilMat(i)}
        </mesh>
      ))}
      {/* capa superior de esquinas redondas: es la superficie que se ve desde arriba */}
      <mesh geometry={geo.topSoil} position={[0, SOIL_BOTTOM + LAYER_H * (LAYERS - 1), 0]} receiveShadow castShadow>
        {soilMat(LAYERS - 1)}
      </mesh>
      {/* fondo oscuro tras la columna de agua */}
      <mesh position={[(LX1 + 2.62) / 2, 1.1, zMid]}>
        <boxGeometry args={[2.62 - LX1, 1.45, SOIL_DEPTH - 0.04]} />
        <meshStandardMaterial color="#0b0f12" roughness={0.8} />
      </mesh>
      {/* boca de llenado */}
      <group position={[2.35, RIM_Y + 0.02, 0.6]}>
        <mesh material={trim} castShadow>
          <cylinderGeometry args={[0.28, 0.22, 0.14, 28]} />
        </mesh>
        <mesh position={[0, 0.075, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.02, 28]} />
          <meshStandardMaterial color="#05080a" roughness={0.5} />
        </mesh>
      </group>

      <TopStones />
      <Roots />
      <Probe />
      <Gauge />
      <Herbs />
      <GrowLamp />
    </group>
  )
}
