import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { getVisual, soilRgb, useVisual, type VisualSensor } from '../visual'
import { MOOD_TEXT, type Mood } from '../mood'
import { lamp, MS } from './layout'
import { std } from './mat'
import { reducedMotion, sm } from './smooth'
import { useQuality } from './quality'
import { pickActuator, setFocus, type FocusId } from '../xr'

/**
 * La maqueta real, tal como se imprime: sale del CAD (cad/simon_matera.py → cad/visor/partes.json → public/maqueta.json).
 * Cada pieza es un objeto aparte que se puede tocar; los datos del equipo la animan:
 *  · depósito: el agua sube y baja con el HC-SR04 (tank_pct)      · sustrato: color según humedad
 *  · estacas LDR: brillan con la luz de cada esquina               · lámpara: LEDs y tapa (servo con biela-manivela)
 *  · riego/bomba: se iluminan al regar                             · OLED: muestra las lecturas
 * Unidades del modelo: mm, Z arriba, frente en −Y. Se gira a Y arriba y se escala con MS.
 */

interface PartData {
  name: string
  asm: string
  rgb: [number, number, number]
  printable: boolean
  ref: boolean
  hidden: boolean
  lo: [number, number, number]
  sz: [number, number, number]
  v: string
  i: string
  i32: boolean
  pivot?: [number, number, number]
  maxang?: number
  mrole?: 'horn' | 'rod' | 'pinC' | 'pinA'
}
interface Mech {
  H: [number, number]
  S: [number, number]
  c: number
  ay: number
  az: number
  phi0: number
  L: number
  sg: number
  C0: [number, number]
}
interface Model {
  parts: PartData[]
  mech: Mech
}

interface Info {
  t: string
  d: string
  keys?: string[]
  focus?: FocusId
  act?: 'light' | 'servo' | 'pump' | 'strip'
}

const LDR_DESC = 'Fotorresistencia LDR en una esquina de la bandeja: mide cuánta luz llega a ese punto.'
const INFO: Record<string, Info> = {
  tira_led: { t: 'Tira LED RGB WS2812 (8 LED 5050)', d: 'Pin de datos 25. Elige el color y el brillo desde «Controlar»; se ve aquí igual que en la tira real.', act: 'strip' },
  contenedor_principal: { t: 'Contenedor principal', d: 'Cuerpo impreso en 3D que aloja la bandeja de tierra, el depósito y la pantalla.' },
  labio: { t: 'Labio del contenedor', d: 'Borde superior que apoya la bandeja y evita que se corra.' },
  pantalla_oled: { t: 'Pantalla OLED 0.91″', d: 'SSD1306 128×32 (I2C: SDA 21, SCL 22). Rota las lecturas principales del equipo.', keys: ['air_t', 'air_rh', 'vwc_pct', 'soil_t', 'tank_pct'] },
  tapon_drenaje: { t: 'Tapón de drenaje', d: 'Sale el agua sobrante de la bandeja.' },
  bandeja_tierra: { t: 'Bandeja de tierra', d: 'Aloja el sustrato y la planta.', keys: ['vwc_pct', 'soil_t'], focus: 'soil' },
  sustrato: { t: 'Sustrato', d: 'Se oscurece al humedecerse según la humedad disponible estimada.', keys: ['vwc_pct', 'soil_t'], focus: 'soil' },
  acetato_suelo: { t: 'Ventana del suelo', d: 'Acetato transparente para ver el corte del sustrato.', focus: 'soil' },
  sonda_humedad: { t: 'Sonda de humedad capacitiva + DS18B20', d: 'Humedad del suelo (ADC, pin 34) y temperatura del suelo (DS18B20, pin 5).', keys: ['vwc_pct', 'vwc_raw', 'soil_t'], focus: 'soil' },
  riego_tierra: { t: 'Red de riego', d: 'Reparte el agua que bombea la mini bomba. Se ilumina mientras riega.', keys: ['pump_on'], focus: 'soil', act: 'pump' },
  niple_riego: { t: 'Entrada de riego', d: 'Conexión de la manguera de la bomba a la red de riego.', act: 'pump' },
  estaca_ldr_NO: { t: 'LDR noroeste', d: LDR_DESC + ' Pin 32.', keys: ['ldr_nw'] },
  estaca_ldr_NE: { t: 'LDR noreste', d: LDR_DESC + ' Pin 33.', keys: ['ldr_ne'] },
  estaca_ldr_SO: { t: 'LDR suroeste', d: LDR_DESC + ' Pin 35.', keys: ['ldr_sw'] },
  estaca_ldr_SE: { t: 'LDR sureste', d: LDR_DESC + ' Pin 36.', keys: ['ldr_se'] },
  deposito_agua: { t: 'Depósito de agua', d: 'Se muestra translúcido para ver el nivel real que mide el ultrasonido.', keys: ['tank_pct', 'tank_cm'], focus: 'tank' },
  tapa_deposito: { t: 'Tapa del depósito', d: 'Cierra el depósito y sostiene el sensor ultrasónico.', keys: ['tank_pct'], focus: 'tank' },
  tapon_llenado: { t: 'Tapón de llenado', d: 'Por aquí se rellena el depósito.', focus: 'tank' },
  agua_deposito: { t: 'Agua del depósito', d: 'Su altura sigue el nivel medido por el HC-SR04.', keys: ['tank_pct', 'tank_cm'], focus: 'tank' },
  acetato_nivel: { t: 'Ventana de nivel', d: 'Acetato para ver el nivel a simple vista.', keys: ['tank_pct'], focus: 'tank' },
  soporte_ultrasonido: { t: 'Soporte del ultrasonido', d: 'Sostiene el HC-SR04 mirando al agua desde la tapa.', keys: ['tank_cm', 'tank_pct'], focus: 'tank' },
  ultrasonido_referencia: { t: 'Sensor ultrasónico HC-SR04', d: 'TRIG pin 18, ECHO pin 23 (con divisor de tensión). Mide la distancia al agua: 15 cm = vacío, 3 cm = lleno.', keys: ['tank_cm', 'tank_pct'], focus: 'tank' },
  tapon_trasero: { t: 'Tapón trasero', d: 'Cierra la salida trasera del depósito.', focus: 'tank' },
  oring_deposito: { t: 'O-ring', d: 'Sello de la conexión del depósito.', focus: 'tank' },
  cajita_bomba: { t: 'Caja de la bomba', d: 'Aloja la mini bomba sumergible, con entrada y salida de agua.', keys: ['pump_on', 'pump_ma'], act: 'pump' },
  cajita_bomba_tapa: { t: 'Tapa de la bomba', d: 'Tapa lisa con muesca para el cable.', keys: ['pump_on'], act: 'pump' },
  bomba_referencia: { t: 'Mini bomba', d: 'Relé en el pin 26. Pulsa para abrir su control (riego manual).', keys: ['pump_on', 'pump_ma'], act: 'pump' },
  caja_electronica: { t: 'Caja electrónica (ESP32 + DHT11)', d: 'ESP32 DevKit, relés y el sensor DHT11 (pin 4) de temperatura y humedad del aire.', keys: ['air_t', 'air_rh'] },
  caja_tapa: { t: 'Tapa de la electrónica', d: 'Cubre la placa y los relés.' },
  canaleta_cables: { t: 'Canaleta de cables', d: 'Lleva los cables desde la caja hasta la lámpara.' },
  peine_cables: { t: 'Peine de cables', d: 'Ordena los cables en lo alto del poste.' },
  tornillo_mano_alto: { t: 'Tornillo de mano', d: 'Sujeta el poste sin herramientas.' },
  tornillo_mano_bajo: { t: 'Tornillo de mano', d: 'Sujeta el poste sin herramientas.' },
  lampara_cuerpo: { t: 'Cuerpo de la lámpara', d: 'Alberga las tiras LED de la luz externa (relé pin 27).', keys: ['luz_media'], act: 'light' },
  lampara_tapa: { t: 'Tapa de la lámpara', d: 'Gira sobre su bisagra: la abre el servo para dejar pasar luz indirecta.', act: 'servo' },
  lampara_leds: { t: 'LED de cultivo', d: 'Se encienden con la luz externa. Pulsa para abrir su control.', act: 'light' },
  servo_sg90: { t: 'Servo SG90', d: 'Pin 19. Abre y cierra la tapa con un brazo y una biela.', act: 'servo' },
  brazo_servo: { t: 'Brazo del servo', d: 'Gira con el servo y empuja la biela.', act: 'servo' },
  biela_tapa: { t: 'Biela', d: 'Une el brazo del servo con la tapa.', act: 'servo' },
  pasador_servo: { t: 'Pasador', d: 'Articulación brazo–biela.', act: 'servo' },
  pasador_tapa: { t: 'Pasador', d: 'Articulación biela–tapa.', act: 'servo' },
  pasador_bisagra: { t: 'Eje de la bisagra', d: 'Eje sobre el que gira la tapa.', act: 'servo' },
  lampara_poste: { t: 'Poste de la lámpara', d: 'Sostiene la lámpara sobre la planta.' },
  lampara_union: { t: 'Unión poste–lámpara', d: 'Une el poste con el cuerpo de la lámpara.' },
}

const LDR_KEY: Record<string, 'ldrNW' | 'ldrNE' | 'ldrSW' | 'ldrSE'> = {
  estaca_ldr_NO: 'ldrNW',
  estaca_ldr_NE: 'ldrNE',
  estaca_ldr_SO: 'ldrSW',
  estaca_ldr_SE: 'ldrSE',
}

const GLASS = new Set(['acetato_suelo', 'acetato_nivel'])
const TANK_H = 86 // mm de agua con el depósito lleno (por debajo de la tapa)

const b64 = (s: string) => {
  const b = atob(s)
  const u = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
  return u.buffer
}

function decode(d: PartData, relZ: boolean) {
  const q = new Uint16Array(b64(d.v))
  const ix = d.i32 ? new Uint32Array(b64(d.i)) : new Uint16Array(b64(d.i))
  const pos = new Float32Array(q.length)
  for (let i = 0; i < q.length; i++) {
    const k = i % 3
    pos[i] = (relZ && k === 2 ? 0 : d.lo[k]) + (q[i] / 65535) * d.sz[k]
  }
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(new THREE.BufferAttribute(ix, 1))
  g = g.toNonIndexed()
  g.computeVertexNormals()
  g.computeBoundingBox()
  return g
}

/** Acabado: toda la maqueta en negro (piezas impresas, soportes, tornillos). Solo conservan su color los componentes
 *  electrónicos y lo que se anima (sensores, servo, pasadores metálicos, agua, tierra, LED). */
const KEEP_COLOR = new Set([
  'sonda_humedad', 'ultrasonido_referencia', 'servo_sg90', 'bomba_referencia', 'oring_deposito', 'pasador_servo', 'pasador_tapa', 'pasador_bisagra',
  'brazo_servo', 'pantalla_oled', 'lampara_leds', 'sustrato', 'agua_deposito',
])
const BLACKS: Record<string, string> = {
  contenedor_principal: '#101215', labio: '#1b1e22', bandeja_tierra: '#0c0d0f', cajita_bomba: '#101215', cajita_bomba_tapa: '#1b1e22',
  deposito_agua: '#08090a', tapa_deposito: '#1b1e22', soporte_ultrasonido: '#15171a', caja_electronica: '#0e0f11', caja_tapa: '#1b1e22',
  lampara_cuerpo: '#1a1c20', lampara_tapa: '#0b0c0e', lampara_poste: '#0e0f11', lampara_union: '#15171a', canaleta_cables: '#17191c',
  riego_tierra: '#0d2233',
}

function material(d: PartData): THREE.MeshStandardMaterial {
  const c = new THREE.Color(d.rgb[0], d.rgb[1], d.rgb[2])
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, Math.max(hsl.l, 0.2))
  if (!KEEP_COLOR.has(d.name) && !GLASS.has(d.name)) c.set(BLACKS[d.name] ?? '#14161a')
  const black = !KEEP_COLOR.has(d.name) && !GLASS.has(d.name)
  const p: THREE.MeshStandardMaterialParameters = { color: c, roughness: black ? 0.42 : 0.55, metalness: black ? 0.18 : 0.05 }
  if (GLASS.has(d.name)) Object.assign(p, { transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, roughness: 0.15 })
  else if (d.name === 'deposito_agua') Object.assign(p, { transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
  else if (d.name === 'agua_deposito') Object.assign(p, { color: new THREE.Color('#3f9ee6'), emissive: new THREE.Color('#103a66'), transparent: true, opacity: 0.82, depthWrite: false, roughness: 0.08 })
  else if (d.name === 'lampara_leds') Object.assign(p, { emissive: new THREE.Color('#fff3e6'), emissiveIntensity: 1 })
  else if (d.name === 'sustrato') Object.assign(p, { roughness: 0.95 })
  return std(p)
}

/** Lecturas de pantalla: 4 líneas como las rota el firmware. */
function oledLines(sensors: VisualSensor[], tankPct: number | null, pump: boolean): string[] {
  const f = (k: string) => {
    const s = sensors.find((x) => x.key === k)
    return typeof s?.value === 'number' ? s.value : null
  }
  const n = (v: number | null, dec = 1) => (v === null ? '--' : v.toFixed(dec))
  return [
    `Aire ${n(f('air_t'))}C  ${n(f('air_rh'), 0)}%`,
    `Suelo ${n(f('vwc_pct'), 0)}%  ${n(f('soil_t'))}C`,
    `Tanque ${tankPct === null ? '--' : tankPct.toFixed(0)}%`,
    `Bomba ${pump ? 'ON' : 'off'}`,
  ]
}

function fmt(s: VisualSensor): string {
  if (typeof s.value === 'boolean') return s.value ? 'sí' : 'no'
  if (s.value === null) return '—'
  const a = Math.abs(s.value)
  const t = a >= 100 ? s.value.toFixed(0) : a >= 10 ? s.value.toFixed(1) : s.value.toFixed(2)
  return s.unit ? `${t} ${s.unit}` : t
}

/** Ojos de la planta: mismos trazos que drawEyes() del firmware (128×32 → canvas 256×64). */
function drawEyes(g: CanvasRenderingContext2D, mood: Mood, ms: number) {
  const W = 60, H = 44, Y = 10, XL = 44, XR = 152
  const blink = (mood === 'happy' || mood === 'worried') && ms % 4200 < 160
  g.fillStyle = '#02070c'
  g.fillRect(0, 0, 256, 64)
  for (let e = 0; e < 2; e++) {
    const x = e ? XR : XL
    g.fillStyle = '#bfe9ff'
    if (mood === 'sleep' || blink) {
      g.fillRect(x, Y + H / 2 - 2, W, 6)
      continue
    }
    g.beginPath()
    g.roundRect(x, Y, W, H, 18)
    g.fill()
    g.fillStyle = '#02070c'
    if (mood === 'happy') {
      g.beginPath()
      g.arc(x + W / 2, Y + H + 14, W / 2 + 4, 0, Math.PI * 2)
      g.fill()
    } else {
      const d = mood === 'worried' ? 18 : 30
      g.beginPath()
      if (e === 0) {
        g.moveTo(x - 2, Y - 2); g.lineTo(x + W + 2, Y - 2); g.lineTo(x - 2, Y + d)
      } else {
        g.moveTo(x - 2, Y - 2); g.lineTo(x + W + 2, Y - 2); g.lineTo(x + W + 2, Y + d)
      }
      g.closePath()
      g.fill()
    }
    if (mood === 'sad') {
      g.fillStyle = '#7fd0ff'
      g.beginPath()
      g.arc(e ? x + W - 6 : x + 6, Math.min(58, Y + H + 3 + Math.floor((ms / 120) % 6) * 2), 4, 0, Math.PI * 2)
      g.fill()
    }
  }
  if (mood === 'sleep') {
    g.fillStyle = '#bfe9ff'
    g.font = '600 18px monospace'
    g.fillText('z', 222, 20)
  }
}

function Oled() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    return new THREE.CanvasTexture(c)
  }, [])
  const last = useRef('')
  const t0 = useRef(0)
  useEffect(() => () => tex.dispose(), [tex])
  useFrame(() => {
    const now = performance.now()
    // como el firmware: la cara 8 s y luego 4 s de lecturas
    const eyes = Math.floor(now / 1000) % 12 < 8
    if (now - t0.current < (eyes ? 120 : 500)) return
    t0.current = now
    const v = getVisual()
    const c = tex.image as HTMLCanvasElement
    const g = c.getContext('2d')!
    if (eyes) {
      const ms = reducedMotion() ? 1000 : Math.floor(now)
      const key = `e|${v.mood}|${ms % 4200 < 160}|${Math.floor(ms / 120) % 6}`
      if (key === last.current) return
      last.current = key
      drawEyes(g, v.mood, ms)
    } else {
      const lines = oledLines(v.sensors, v.tankPct, v.pumpOn)
      const key = lines.join('|')
      if (key === last.current) return
      last.current = key
      g.fillStyle = '#02070c'
      g.fillRect(0, 0, 256, 64)
      g.fillStyle = '#8fe3ff'
      g.font = '600 15px monospace'
      lines.forEach((l, i) => g.fillText(l, 6, 14 + i * 15))
    }
    tex.needsUpdate = true
  })
  // pantalla: 128×32 → 23 × 6 mm, sobre la cara frontal (y = −65 mm) de la caja
  return (
    <mesh position={[0, -65.2, 53.75]} rotation-x={Math.PI / 2} renderOrder={3}>
      <planeGeometry args={[23, 5.75]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

function PumpLed() {
  const m = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => m.current?.color.set('#2a5a3d').lerp(new THREE.Color('#59ff9a'), sm.pump))
  return (
    <mesh position={[168.75, -31.2, 33]}>
      <sphereGeometry args={[2.2, 14, 10]} />
      <meshBasicMaterial ref={m} color="#2a5a3d" toneMapped={false} />
    </mesh>
  )
}

/** Tira WS2812 de 8 LED en el frente de la lámpara: toma el color y el brillo que se eligen en la interfaz. */
function StripLed({ sel, hover, onPick, onHover }: { sel: boolean; hover: boolean; onPick: () => void; onHover: (h: boolean) => void }) {
  const quality = useQuality()
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const light = useRef<THREE.PointLight>(null)
  const lvl = useRef(0)
  const col = useMemo(() => new THREE.Color(), [])
  const target = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    const st = getVisual().acts.find((a) => a.kind === 'strip')
    const on = !!st?.on
    lvl.current += ((on ? 1 : 0) - lvl.current) * Math.min(1, dt * 6)
    target.set(st?.color ?? '#ffe0b0')
    const br = (st?.brightness ?? 60) / 100
    col.set('#3a3a38').lerp(target, lvl.current).multiplyScalar(0.35 + 0.65 * (lvl.current ? br : 0.25))
    mats.current.forEach((m) => m?.color.copy(col))
    if (light.current) {
      light.current.color.copy(target)
      light.current.intensity = lvl.current * br * 6
    }
  })
  const leds = Array.from({ length: 8 }, (_, i) => (i - 3.5) * 6.2)
  return (
    <group
      position={[0, -50.8, 311.5]}
      rotation-x={-Math.PI / 2}
      onClick={(e) => {
        e.stopPropagation()
        onPick()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        onHover(true)
      }}
      onPointerOut={() => onHover(false)}
    >
      <mesh position={[0, 0, 0.6]}>
        <boxGeometry args={[52, 10, 1.6]} />
        <meshStandardMaterial color="#0b0c0e" roughness={0.5} emissive="#2fe0b0" emissiveIntensity={sel ? 0.5 : hover ? 0.2 : 0} />
      </mesh>
      {leds.map((x, i) => (
        <mesh key={i} position={[x, 0, -0.4]}>
          <boxGeometry args={[5, 5, 1.1]} />
          <meshBasicMaterial ref={(m) => { mats.current[i] = m }} color="#3a3a38" toneMapped={false} />
        </mesh>
      ))}
      {quality !== 'low' && <pointLight ref={light} position={[0, 0, -12]} distance={6} decay={2} intensity={0} />}
    </group>
  )
}

function Card({ part, pos, onClose }: { part: Pick<PartData, 'name' | 'sz' | 'ref' | 'printable'>; pos: THREE.Vector3; onClose: () => void }) {
  const info = INFO[part.name] ?? { t: part.name.replace(/_/g, ' '), d: '' }
  const sig = useVisual((v) => JSON.stringify([v.sensors, v.tankPct, v.pumpOn, v.acts, v.mood]))
  const [sensors, tankPct, pumpOn, acts, mood] = useMemo(() => JSON.parse(sig) as [VisualSensor[], number | null, boolean, { key: string; kind: string; on: boolean; color?: string | null; brightness?: number | null }[], Mood], [sig])
  const rows: { l: string; v: string }[] = []
  if (part.name === 'pantalla_oled') rows.push({ l: 'Ojos', v: MOOD_TEXT[mood] })
  if (part.name === 'tira_led') {
    const st = acts.find((a) => a.kind === 'strip')
    if (st) rows.push({ l: 'Estado', v: st.on ? `encendida ${st.color ?? ''} ${st.brightness ?? ''}%` : 'apagada' })
  }
  for (const k of info.keys ?? []) {
    if (k === 'pump_on') rows.push({ l: 'Bomba', v: pumpOn ? 'regando' : 'apagada' })
    else if (k === 'tank_pct' && tankPct !== null) rows.push({ l: 'Nivel del depósito', v: `${tankPct.toFixed(0)} %` })
    else {
      const s = sensors.find((x) => x.key === k)
      if (s) rows.push({ l: s.label, v: fmt(s) })
    }
  }
  const actKey = info.act === 'pump' ? 'pump' : acts.find((a) => a.kind === info.act)?.key   // sin ese actuador configurado no hay botón
  const actOn = info.act === 'pump' ? pumpOn : acts.find((a) => a.kind === info.act)?.on
  return (
    <Html position={pos} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
      <div
        role="dialog"
        aria-label={info.t}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          pointerEvents: 'auto', width: 230, transform: 'translate(0,-100%) translateY(-14px)', padding: '10px 12px', borderRadius: 12,
          background: 'rgba(16,22,26,.94)', color: '#e8f2ec', font: '13px/1.35 Inter, system-ui, sans-serif', boxShadow: '0 6px 22px rgba(0,0,0,.45)',
          border: '1px solid rgba(255,255,255,.14)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
          <b style={{ fontSize: 14 }}>{info.t}</b>
          <button onClick={onClose} aria-label="Cerrar" style={{ all: 'unset', cursor: 'pointer', padding: '0 4px', color: '#9fb4a8' }}>✕</button>
        </div>
        {info.d && <div style={{ color: '#b5c7bc', marginTop: 4 }}>{info.d}</div>}
        {rows.length > 0 && (
          <div style={{ marginTop: 8, display: 'grid', gap: 3 }}>
            {rows.map((r) => (
              <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: '#9fb4a8' }}>{r.l}</span>
                <b>{r.v}</b>
              </div>
            ))}
          </div>
        )}
        {actKey && (
          <button
            onClick={() => pickActuator(actKey)}
            style={{ all: 'unset', cursor: 'pointer', marginTop: 10, padding: '6px 10px', borderRadius: 8, background: '#2f7d57', color: '#fff', fontWeight: 600, textAlign: 'center', display: 'block' }}
          >
            Controlar{actOn ? ' (encendido)' : ''}
          </button>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: '#7f948a' }}>
          {part.sz.map((x) => x.toFixed(0)).join(' × ')} mm{part.ref ? ' · componente de referencia' : part.printable ? ' · pieza impresa' : ''}
        </div>
      </div>
    </Html>
  )
}

export function Maqueta() {
  const [model, setModel] = useState<Model | null>(null)
  const quality = useQuality()
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const mats = useRef<Record<string, THREE.MeshStandardMaterial>>({})
  const grps = useRef<Record<string, THREE.Group | null>>({})
  const lid = useRef(-1)

  useEffect(() => {
    let off = false
    fetch(`${import.meta.env.BASE_URL}maqueta.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Model>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => !off && setModel(m))
      .catch(() => {
        /* sin maqueta no hay escena de piezas, pero la planta y los datos siguen funcionando */
      })
    return () => {
      off = true
    }
  }, [])

  const built = useMemo(() => {
    if (!model) return null
    return model.parts
      .filter((d) => !d.hidden)
      .map((d) => {
        const water = d.name === 'agua_deposito'
        const geo = decode(d, water)
        const mat = material(d)
        const c = new THREE.Vector3()
        geo.boundingBox!.getCenter(c)
        if (water) c.z += d.lo[2]
        return { d, geo, mat, c, water }
      })
  }, [model])

  useEffect(() => {
    if (!built) return
    mats.current = Object.fromEntries(built.map((b) => [b.d.name, b.mat]))
    return () => built.forEach((b) => (b.geo.dispose(), b.mat.dispose()))
  }, [built])

  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setSel(null)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hover])

  const col = useMemo(() => new THREE.Color(), [])
  const ledCol = useMemo(() => new THREE.Color(), [])

  useFrame(({ clock }) => {
    if (!model || !built) return
    const m = mats.current
    const t = reducedMotion() ? 0 : clock.elapsedTime
    // lámpara: encendido (luz externa) o, sin actuador, según la hora
    lamp.on = sm.light >= 0 ? 0.08 + 0.92 * sm.light : 0.35 + 0.65 * (1 - sm.day)
    lamp.y = 6.1
    if (m.lampara_leds) m.lampara_leds.emissiveIntensity = 0.15 + 2.6 * lamp.on
    // sustrato por humedad
    if (m.sustrato) {
      const [r, g, b] = soilRgb(sm.wet)
      m.sustrato.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
    }
    // agua del depósito: altura continua
    const w = grps.current.agua_deposito
    if (w) {
      const h = 1.5 + (TANK_H - 1.5) * Math.min(1, Math.max(0, sm.tankLevel))
      const nominal = built.find((b) => b.water)!.d.sz[2]
      w.scale.z = h / nominal
      w.visible = sm.tankLevel > 0.005
      if (m.agua_deposito) {
        col.set('#3f9ee6').lerp(ledCol.set('#e8a23a'), Math.max(0, Math.min(1, (0.25 - sm.tankLevel) / 0.2)))
        m.agua_deposito.color.copy(col)
      }
    }
    // LDR: brillo por luz recibida
    for (const [name, key] of Object.entries(LDR_KEY)) {
      const mm = m[name]
      if (!mm) continue
      mm.emissive.set('#ffd25a')
      mm.emissiveIntensity = 0.04 + 1.5 * Math.min(1, Math.max(0, sm[key]))
    }
    // riego y bomba
    const pulse = 0.65 + 0.35 * Math.sin(t * 7)
    if (m.riego_tierra) {
      m.riego_tierra.emissive.set('#4fc3ff')
      m.riego_tierra.emissiveIntensity = 0.03 + 1.1 * sm.pump * pulse
    }
    if (m.bomba_referencia) {
      m.bomba_referencia.emissive.set('#3d8bff')
      m.bomba_referencia.emissiveIntensity = 0.9 * sm.pump * pulse
    }
    // selección y paso del cursor
    for (const b of built) {
      if (LDR_KEY[b.d.name] || ['riego_tierra', 'bomba_referencia', 'lampara_leds', 'agua_deposito'].includes(b.d.name)) continue
      const on = b.d.name === sel ? 0.3 : b.d.name === hover ? 0.12 : 0
      b.mat.emissive.set('#2fe0b0')
      b.mat.emissiveIntensity = on
    }
    // tapa de la lámpara: servo → mecanismo biela-manivela
    const ang = Math.round(sm.lid * (model.parts.find((p) => p.pivot)?.maxang ?? 105) * 20) / 20
    if (ang !== lid.current) {
      lid.current = ang
      poseLid(model, grps.current, ang)
    }
  })

  if (!built || !model) return null
  const selB = built.find((b) => b.d.name === sel)
  return (
    <group rotation-x={-Math.PI / 2} scale={MS}>
      {built.map((b) => {
        const info = INFO[b.d.name]
        const solid = !b.mat.transparent
        return (
          <group
            key={b.d.name}
            ref={(g) => {
              grps.current[b.d.name] = g
            }}
            position={b.water ? [0, 0, b.d.lo[2]] : undefined}
          >
            <mesh
              geometry={b.geo}
              material={b.mat}
              castShadow={solid && quality !== 'low'}
              receiveShadow={solid}
              renderOrder={b.water ? 2 : b.d.name === 'deposito_agua' ? 1 : 0}
              onClick={(e) => {
                e.stopPropagation()
                setSel((s) => (s === b.d.name ? null : b.d.name))
                if (info?.focus) setFocus(info.focus)
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHover(b.d.name)
              }}
              onPointerOut={() => setHover((h) => (h === b.d.name ? null : h))}
            />
          </group>
        )
      })}
      <Oled />
      <StripLed
        sel={sel === 'tira_led'}
        hover={hover === 'tira_led'}
        onPick={() => setSel((x) => (x === 'tira_led' ? null : 'tira_led'))}
        onHover={(h) => setHover((x) => (h ? 'tira_led' : x === 'tira_led' ? null : x))}
      />
      <PumpLed />
      {selB && <Card part={selB.d} pos={selB.c} onClose={() => setSel(null)} />}
      {sel === 'tira_led' && <Card part={{ name: 'tira_led', sz: [52, 10, 3], ref: true, printable: false }} pos={new THREE.Vector3(0, -51, 311.5)} onClose={() => setSel(null)} />}
    </group>
  )
}

/** Misma cinemática que el visor del CAD: el servo (fijo) mueve brazo y biela y la biela abre la tapa sobre su bisagra. */
function poseLid(model: Model, grps: Record<string, THREE.Group | null>, deg: number) {
  const M = model.mech
  const th = (deg * Math.PI) / 180
  const rad = Math.PI / 180
  for (const d of model.parts) {
    const g = grps[d.name]
    if (!g) continue
    if (d.mrole) {
      const Ar = [M.ay * Math.cos(th) + M.az * Math.sin(th), -M.ay * Math.sin(th) + M.az * Math.cos(th)]
      const dy = Ar[0] - M.S[0]
      const dz = Ar[1] - M.S[1]
      const dd = Math.hypot(dy, dz)
      const bb = Math.acos(Math.max(-1, Math.min(1, (M.c * M.c + dd * dd - M.L * M.L) / (2 * M.c * dd))))
      const ph = Math.atan2(dz, dy) + M.sg * bb
      const Cr = [M.S[0] + M.c * Math.cos(ph), M.S[1] + M.c * Math.sin(ph)]
      const A0 = [M.ay, M.az]
      const C0 = M.C0
      const H = M.H
      let P0 = [0, 0]
      let dl = 0
      let T = [0, 0]
      if (d.mrole === 'horn') {
        P0 = [H[0] + M.S[0], H[1] + M.S[1]]
        dl = ph - M.phi0 * rad
      } else if (d.mrole === 'rod') {
        P0 = [H[0] + C0[0], H[1] + C0[1]]
        dl = Math.atan2(Ar[1] - Cr[1], Ar[0] - Cr[0]) - Math.atan2(A0[1] - C0[1], A0[0] - C0[0])
        T = [Cr[0] - C0[0], Cr[1] - C0[1]]
      } else if (d.mrole === 'pinC') T = [Cr[0] - C0[0], Cr[1] - C0[1]]
      else T = [Ar[0] - A0[0], Ar[1] - A0[1]]
      g.rotation.x = dl
      g.position.set(0, P0[0] - (P0[0] * Math.cos(dl) - P0[1] * Math.sin(dl)) + T[0], P0[1] - (P0[0] * Math.sin(dl) + P0[1] * Math.cos(dl)) + T[1])
    }
    if (d.pivot) {
      const pv = d.pivot
      const a = (pv[1] > 0 ? -1 : 1) * th
      g.rotation.x = a
      g.position.set(0, pv[1] - (pv[1] * Math.cos(a) - pv[2] * Math.sin(a)), pv[2] - (pv[1] * Math.sin(a) + pv[2] * Math.cos(a)))
    }
  }
}
