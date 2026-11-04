import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { Bench } from './Bench'
import { Room } from './Room'
import { AlertMarkers, Dust, Lights, Rain } from './Effects'
import { Env } from './Env'
import { Plant } from './Plant'
import { Post } from './post'
import { Planter } from './Planter'
import { adaptiveEnabled, QualityContext, type Quality } from './quality'
import { Smoother } from './smooth'
import { ArRoot } from './ArLayer'
import { FOCUS_TARGET } from './layout'
import { setFocus, useFocus, useXr } from '../xr'
import { WaterSystem } from './WaterSystem'

/** Con postprocesado el tono lo aplica la cadena; en calidad baja lo aplica el renderer. */
function ToneSwitch({ quality, force }: { quality: Quality; force: boolean }) {
  const { gl, scene } = useThree()
  useEffect(() => {
    const target = quality === 'low' || force ? THREE.NeutralToneMapping : THREE.NoToneMapping
    gl.toneMappingExposure = 1
    if (gl.toneMapping === target) return   // sin cambio: recompilar todos los materiales sería trabajo perdido
    gl.toneMapping = target
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true))
      else if (m) m.needsUpdate = true
    })
  }, [gl, scene, quality, force])
  return null
}

/** Solo con ?debug: expone el renderer para medir triángulos, texturas y programas desde las pruebas. */
function DebugHook() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    if (sp.has('debug') || sp.has('perf')) {
      ;(window as unknown as { __gl: unknown; __scene: unknown }).__gl = gl
      ;(window as unknown as { __scene: unknown }).__scene = scene
    }
  }, [gl, scene])
  return null
}

/** Medidor de rendimiento (fps, resolución, triángulos, shaders, primer cuadro). Se activa con ?fps o con 5 toques
 *  seguidos sobre el nombre del dispositivo (celular/APK). Además vigila el arranque: si el primer cuadro tarda
 *  demasiado, avisa para pasar a "Sin 3D". */
function FpsHud({ quality, onTooSlow }: { quality: Quality; onTooSlow: () => void }) {
  const gl = useThree((s) => s.gl)
  const st = useRef({ n: 0, t: performance.now(), first: 0, el: null as HTMLDivElement | null, on: false })
  useEffect(() => {
    let saved = false
    try {
      saved = localStorage.getItem('simon.hud') === '1'
    } catch {
      /* sin almacenamiento */
    }
    st.current.on = saved || new URLSearchParams(location.search).has('fps')
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;z-index:60;left:6px;top:calc(env(safe-area-inset-top) + 56px);padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.65);color:#fff;font:600 11px/1.3 monospace;pointer-events:none;white-space:pre;display:none'
    document.body.appendChild(el)
    st.current.el = el
    const toggle = () => {
      st.current.on = !st.current.on
      try {
        localStorage.setItem('simon.hud', st.current.on ? '1' : '0')
      } catch {
        /* sin almacenamiento */
      }
      if (!st.current.on) el.style.display = 'none'
    }
    window.addEventListener('simon-hud', toggle)
    return () => {
      window.removeEventListener('simon-hud', toggle)
      el.remove()
    }
  }, [])
  useFrame(() => {
    const a = st.current
    if (!a.first) {
      a.first = performance.now()
      if (a.first > 15000) onTooSlow()   // el primer cuadro tardó más de 15 s: este celular no aguanta la escena
    }
    a.n++
    const now = performance.now()
    if (now - a.t >= 1000) {
      const fps = Math.round((a.n * 1000) / (now - a.t))
      if (a.on && a.el) {
        a.el.style.display = 'block'
        a.el.textContent = `${fps} fps · ${quality} · dpr ${gl.getPixelRatio().toFixed(2)}\n${Math.round(gl.info.render.triangles / 1000)}k tri · ${gl.info.programs?.length ?? 0} shaders\n1er cuadro ${(a.first / 1000).toFixed(1)} s`
      }
      a.n = 0
      a.t = now
    }
  })
  return null
}

/** Sombra falsa (mancha oscura difusa) bajo la matera: sustituye al mapa de sombras en calidad baja. */
function BlobShadow() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32)
    g.addColorStop(0, 'rgba(20,14,8,0.75)')
    g.addColorStop(0.55, 'rgba(20,14,8,0.4)')
    g.addColorStop(1, 'rgba(20,14,8,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    return new THREE.CanvasTexture(c)
  }, [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0.1, 0.02, 0.1]} renderOrder={1}>
      <planeGeometry args={[8.2, 4.4]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** En calidad baja dibuja a 30 fps (frameloop por demanda): menos calor y batería en el celular. */
function FpsCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const id = window.setInterval(() => invalidate(), 1000 / fps)
    return () => window.clearInterval(id)
  }, [invalidate, fps])
  return null
}

/** Resolución adaptativa: baja la densidad de píxeles si los fotogramas tardan y, en el límite, pide menos calidad. */
function AdaptiveRes({ max, onFloor }: { max: number; onFloor: () => void }) {
  const setDpr = useThree((s) => s.setDpr)
  const st = useRef({ t: 0, n: 0, dpr: max, cool: 4 })
  useEffect(() => {
    st.current.dpr = max
    setDpr(max)
  }, [max, setDpr])
  useFrame((_, dt) => {
    if (!adaptiveEnabled()) return
    const a = st.current
    a.t += Math.min(dt, 0.25)
    a.n++
    if (a.n < 40) return
    const avg = a.t / a.n
    a.t = 0
    a.n = 0
    if (a.cool > 0) {
      a.cool--
      return
    }
    let d = a.dpr
    if (avg > 1 / 36 && d > 0.75) d = Math.max(0.75, d - 0.25)
    else if (avg < 1 / 70 && d < max) d = Math.min(max, d + 0.25)
    if (d !== a.dpr) {
      a.dpr = d
      setDpr(d)
      a.cool = 4
    } else if (avg > 1 / 24 && d <= 0.75) {
      onFloor()
      a.cool = 6
    }
  })
  return null
}

export interface SceneProps {
  /** píxeles que ocupa el panel de la derecha (escritorio) */
  shiftPx?: number
  narrow: boolean
  quality: Exclude<Quality, 'off'>
  onQualityDrop: () => void
  /** El celular no aguanta la escena: pasar a "Sin 3D". */
  onTooSlow: () => void
}

/** Escena 3D: invernadero con mesa de roble, la mata, el suelo en corte, el tanque y la bomba. */
export function Scene({ narrow, quality, onQualityDrop, onTooSlow, shiftPx = 0 }: SceneProps) {
  const xr = useXr()
  const controls = useRef<OrbitControlsImpl>(null)
  const maxDpr = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1.25
  return (
    <Canvas
      shadows={quality === 'low' ? false : 'soft'}
      frameloop={quality === 'low' && !xr.active ? 'demand' : 'always'}
      dpr={[1, maxDpr]}
      camera={{ position: narrow ? [11.5, 7.8, 20.5] : [9.8, 7.6, 16.8], fov: narrow ? 46 : 36, near: 0.1, far: 220 }}
      gl={{ alpha: true, antialias: quality === 'low' || xr.active, powerPreference: 'high-performance', preserveDrawingBuffer: !adaptiveEnabled(), stencil: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = quality === 'low' ? THREE.NeutralToneMapping : THREE.NoToneMapping
        // Three consulta el estado de cada shader justo al enlazarlo, lo que bloquea el hilo principal hasta que la GPU termina.
        // Sin esa consulta el navegador compila los shaders en paralelo (KHR_parallel_shader_compile) y la interfaz no se congela.
        if (!new URLSearchParams(location.search).has('debug')) gl.debug.checkShaderErrors = false
      }}
      aria-label="Escena 3D del cultivo: mesa de invernadero con la planta, el suelo en corte, el tanque de agua y la bomba"
      role="img"
    >
      <QualityContext.Provider value={quality}>
        <ToneSwitch quality={quality} force={xr.active} />
        <ViewShift px={shiftPx} />
        <FocusRig controls={controls} />
        <AdaptiveRes max={maxDpr} onFloor={onQualityDrop} />
        <Smoother />
        <DebugHook />
        <FpsHud quality={quality} onTooSlow={onTooSlow} />
        {quality === 'low' && !xr.active && <FpsCap fps={30} />}
        <Env />
        <Suspense fallback={null}>
          <ArRoot>
            <Lights />
            {!xr.active && <Room />}
            {!xr.active && <Bench />}
            {quality === 'low' && !xr.active && <BlobShadow />}
            {xr.active && (
              <mesh rotation-x={-Math.PI / 2} position-y={0.01} receiveShadow>
                <planeGeometry args={[60, 60]} />
                <shadowMaterial opacity={0.38} />
              </mesh>
            )}
            <Pickable id="soil">
              <Planter />
            </Pickable>
            <Pickable id="plant">
              <Plant />
            </Pickable>
            <Pickable id="tank">
              <WaterSystem />
            </Pickable>
            {!xr.active && <Dust />}
            <Rain />
            <AlertMarkers />
          </ArRoot>
        </Suspense>
        {quality !== 'low' && !xr.active && <Post quality={quality} />}
        <OrbitControls
          ref={controls}
          enabled={!xr.active}
          target={narrow ? [0, 2.3, 0] : [0, 4.3, 0]}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={7}
          maxDistance={30}
          minPolarAngle={0.25}
          maxPolarAngle={Math.PI * 0.53}
          minAzimuthAngle={-1.25}
          maxAzimuthAngle={1.45}
        />
      </QualityContext.Provider>
    </Canvas>
  )
}

/** Desplaza el encuadre para que la escena quede centrada en el área libre (no bajo el panel de la derecha). */
function ViewShift({ px }: { px: number }) {
  const { camera, size } = useThree()
  const xr = useXr()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (px > 0 && !xr.active) cam.setViewOffset(size.width, size.height, px / 2, 0, size.width, size.height)
    else cam.clearViewOffset()
    return () => cam.clearViewOffset()
  }, [camera, size.width, size.height, px, xr.active])
  return null
}

/** Al hacer clic en una parte (suelo, tanque, planta) la cámara se acerca suavemente a ella. */
function FocusRig({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const f = useFocus()
  const goal = useRef<THREE.Vector3 | null>(null)
  const camGoal = useRef<number | null>(null)
  useEffect(() => {
    if (!f) return
    goal.current = new THREE.Vector3(...FOCUS_TARGET[f.id])
    camGoal.current = 10
  }, [f])
  useFrame((_, dt) => {
    const c = controls.current
    const g = goal.current
    if (!c || !g) return
    const k = Math.min(1, dt * 4)
    c.target.lerp(g, k)
    const cur = c.object.position.distanceTo(c.target)
    const want = camGoal.current ?? cur
    if (Math.abs(cur - want) > 0.05) {
      const dir = c.object.position.clone().sub(c.target).normalize()
      c.object.position.copy(c.target.clone().addScaledVector(dir, cur + (want - cur) * k))
    }
    if (c.target.distanceTo(g) < 0.03 && Math.abs(cur - want) < 0.1) goal.current = null
    c.update()
  })
  return null
}

function Pickable({ id, children }: { id: 'soil' | 'tank' | 'plant'; children: React.ReactNode }) {
  return (
    <group
      onClick={(e) => {
        e.stopPropagation()
        setFocus(id)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      {children}
    </group>
  )
}
