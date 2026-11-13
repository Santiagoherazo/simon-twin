import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getVisual, useVisual, type VisualActuator, type VisualSensor } from '../visual'
import { reducedMotion } from './smooth'
import { pickActuator } from '../xr'

const STATUS_COL: Record<string, string> = { ok: '#4be08a', low: '#ffb020', high: '#ff6a4d' }

const fmt = (v: number | boolean | null, unit: string) => {
  if (v === null) return '—'
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  const a = Math.abs(v)
  const t = a >= 1000 ? Math.round(v).toLocaleString('es') : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
  return unit ? `${t} ${unit}` : t
}

function boardCanvas(rows: VisualSensor[]) {
  const rowH = 46
  const W = 520
  const H = 64 + Math.max(1, rows.length) * rowH
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#10161a'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#1d272d'
  g.fillRect(0, 0, W, 50)
  g.fillStyle = '#cfe6d6'
  g.font = '600 24px Inter, system-ui, sans-serif'
  g.fillText('Sensores', 20, 34)
  rows.forEach((r, i) => {
    const y = 64 + i * rowH
    g.fillStyle = r.status ? STATUS_COL[r.status] : '#7fa090'
    g.beginPath()
    g.arc(26, y + 20, 7, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#aebfb6'
    g.font = '400 21px Inter, system-ui, sans-serif'
    g.fillText(r.label.length > 20 ? r.label.slice(0, 19) + '…' : r.label, 46, y + 27)
    g.fillStyle = '#ffffff'
    g.font = '600 23px Inter, system-ui, sans-serif'
    g.textAlign = 'right'
    g.fillText(fmt(r.value, r.unit), W - 18, y + 27)
    g.textAlign = 'left'
  })
  if (!rows.length) {
    g.fillStyle = '#7fa090'
    g.font = '400 21px Inter, system-ui, sans-serif'
    g.fillText('Sin lecturas todavía', 20, 98)
  }
  return c
}

/** Tablero con TODAS las lecturas del dispositivo (sensores, indicadores y variables personalizadas). */
export function SensorBoard() {
  const sig = useVisual((v) => JSON.stringify(v.sensors))
  const rows: VisualSensor[] = useMemo(() => JSON.parse(sig), [sig])
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(boardCanvas(rows))
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [rows])
  useEffect(() => () => tex.dispose(), [tex])
  const h = (64 + Math.max(1, rows.length) * 46) / 520 * 2.4
  return (
    <group position={[-4.5, 0, 0.2]} rotation-y={0.55}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <boxGeometry args={[0.16, 1.8, 0.16]} />
        <meshStandardMaterial color="#2b3338" metalness={0.7} roughness={0.4} />
      </mesh>
      <group position={[0, 1.8 + h / 2 - 0.2, 0.1]}>
        <mesh>
          <boxGeometry args={[2.52, h + 0.12, 0.08]} />
          <meshStandardMaterial color="#1a2024" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, 0.045]}>
          <planeGeometry args={[2.4, h]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function nameTexture(text: string) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(16,22,26,.88)'
  g.beginPath()
  g.roundRect(2, 2, 252, 60, 14)
  g.fill()
  g.fillStyle = '#fff'
  g.font = '600 26px Inter, system-ui, sans-serif'
  g.textAlign = 'center'
  g.fillText(text.length > 16 ? text.slice(0, 15) + '…' : text, 128, 41)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Un actuador del dispositivo con su modelo según el tipo; lee el estado cada fotograma sin re-renderizar. */
function Actuator({ index, act, x, z }: { index: number; act: VisualActuator; x: number; z: number }) {
  const label = useMemo(() => nameTexture(act.label), [act.label])
  useEffect(() => () => label.dispose(), [label])
  const led = useRef<THREE.MeshStandardMaterial>(null)
  const spin = useRef<THREE.Group>(null)
  const handle = useRef<THREE.Mesh>(null)
  const horn = useRef<THREE.Group>(null)
  const glow = useRef<THREE.MeshStandardMaterial>(null)
  const k = useRef(0)
  useFrame((_, dtRaw) => {
    const a = getVisual().acts[index]
    const on = !!a?.on
    const dt = Math.min(dtRaw, 0.1)
    k.current += ((on ? 1 : 0) - k.current) * Math.min(1, dt * 5)
    if (led.current) {
      led.current.emissiveIntensity = 0.15 + 2.6 * k.current
      led.current.color.set(on ? '#3ddc84' : '#33403a')
      led.current.emissive.set(on ? '#3ddc84' : '#000000')
    }
    if (spin.current && !reducedMotion()) spin.current.rotation.z += dt * 22 * k.current
    if (handle.current) handle.current.rotation.z = (Math.PI / 2) * (1 - k.current)
    if (horn.current) horn.current.rotation.z = -(Math.PI / 2) * k.current          // el brazo gira 90° al activarse
    if (glow.current) glow.current.emissiveIntensity = 3 * k.current
  })
  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => {
        e.stopPropagation()
        pickActuator(act.key)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      {act.kind === 'fan' && (
        <group position={[0, 0.8, 0]}>
          <mesh>
            <torusGeometry args={[0.52, 0.07, 10, 28]} />
            <meshStandardMaterial color="#39434a" metalness={0.6} roughness={0.4} />
          </mesh>
          <group ref={spin}>
            {[0, 1, 2].map((i) => (
              <mesh key={i} rotation-z={(i * Math.PI * 2) / 3} position={[0, 0, 0]}>
                <boxGeometry args={[0.1, 0.9, 0.02]} />
                <meshStandardMaterial color="#c9d2d8" />
              </mesh>
            ))}
          </group>
          <mesh position={[0, -0.8, 0]}><boxGeometry args={[0.2, 0.5, 0.2]} /><meshStandardMaterial color="#39434a" /></mesh>
        </group>
      )}
      {act.kind === 'heater' && (
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[0.9, 0.9, 0.5]} />
          <meshStandardMaterial ref={glow} color="#3b3f43" emissive="#ff6a1a" emissiveIntensity={0} />
        </mesh>
      )}
      {act.kind === 'light' && (
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[1, 0.12, 0.35]} />
          <meshStandardMaterial ref={glow} color="#e8e8ee" emissive="#ffd6ec" emissiveIntensity={0} />
        </mesh>
      )}
      {act.kind === 'humidifier' && (
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.32, 0.4, 0.8, 20]} />
          <meshStandardMaterial ref={glow} color="#cfd8dd" emissive="#7fd0ff" emissiveIntensity={0} />
        </mesh>
      )}
      {act.kind === 'valve' && (
        <group position={[0, 0.5, 0]}>
          <mesh rotation-z={Math.PI / 2}><cylinderGeometry args={[0.14, 0.14, 1, 14]} /><meshStandardMaterial color="#b08d57" metalness={0.8} roughness={0.35} /></mesh>
          <mesh position={[0, 0.2, 0]}><boxGeometry args={[0.3, 0.3, 0.3]} /><meshStandardMaterial color="#b08d57" metalness={0.8} roughness={0.35} /></mesh>
          <mesh ref={handle} position={[0, 0.5, 0]}><boxGeometry args={[0.7, 0.07, 0.07]} /><meshStandardMaterial color="#c0392b" /></mesh>
        </group>
      )}
      {act.kind === 'servo' && (
        <group position={[0, 0.35, 0]}>
          <mesh castShadow><boxGeometry args={[0.7, 0.4, 0.34]} /><meshStandardMaterial color="#2a5db0" roughness={0.45} /></mesh>
          <mesh position={[0.46, 0, 0]}><boxGeometry args={[0.22, 0.06, 0.34]} /><meshStandardMaterial color="#2a5db0" roughness={0.45} /></mesh>
          <mesh position={[-0.46, 0, 0]}><boxGeometry args={[0.22, 0.06, 0.34]} /><meshStandardMaterial color="#2a5db0" roughness={0.45} /></mesh>
          <mesh position={[0.14, 0.24, 0]}><cylinderGeometry args={[0.1, 0.1, 0.1, 18]} /><meshStandardMaterial color="#dfe4e8" metalness={0.4} roughness={0.4} /></mesh>
          <group ref={horn} position={[0.14, 0.32, 0]}>
            <mesh position={[0.42, 0, 0]}><boxGeometry args={[0.84, 0.035, 0.56]} /><meshStandardMaterial color="#f2f4f6" roughness={0.55} transparent opacity={0.92} /></mesh>
          </group>
        </group>
      )}
      {act.kind === 'generic' && (
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.8, 0.6, 0.5]} />
          <meshStandardMaterial color="#2b3338" roughness={0.5} />
        </mesh>
      )}
      {/* indicador LED común */}
      <mesh position={[0, 0.06, 0.38]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial ref={led} color="#33403a" emissive="#000000" />
      </mesh>
      <sprite position={[0, 1.45, 0]} scale={[1.2, 0.3, 1]} renderOrder={10}>
        <spriteMaterial map={label} transparent depthTest={false} />
      </sprite>
    </group>
  )
}

/** Banco de actuadores a la derecha de la mesa: un modelo por cada actuador configurado (salvo la bomba). */
export function ActuatorBank() {
  const sig = useVisual((v) => JSON.stringify(v.acts.map((a) => [a.key, a.label, a.kind])))
  const acts = useMemo<VisualActuator[]>(
    () => (JSON.parse(sig) as [string, string, VisualActuator['kind']][]).map(([key, label, kind]) => ({ key, label, kind, on: false })),
    [sig],
  )
  if (!acts.length) return null
  return (
    <group position={[4.4, 0, -1.7]} rotation-y={-0.35}>
      {acts.map((a, i) => (
        <Actuator key={a.key} index={i} act={a} x={(i % 2) * 1.4} z={Math.floor(i / 2) * 1.3} />
      ))}
    </group>
  )
}
