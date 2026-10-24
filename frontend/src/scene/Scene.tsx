import { Suspense, useEffect, useRef } from 'react'
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
    gl.toneMapping = quality === 'low' || force ? THREE.NeutralToneMapping : THREE.NoToneMapping
    gl.toneMappingExposure = 1
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true))
      else if (m) m.needsUpdate = true
    })
  }, [gl, scene, quality, force])
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
  quality: Quality
  onQualityDrop: () => void
}

/** Escena 3D: invernadero con mesa de roble, la mata, el suelo en corte, el tanque y la bomba. */
export function Scene({ narrow, quality, onQualityDrop, shiftPx = 0 }: SceneProps) {
  const xr = useXr()
  const controls = useRef<OrbitControlsImpl>(null)
  const maxDpr = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1.25
  return (
    <Canvas
      shadows="soft"
      dpr={[1, maxDpr]}
      camera={{ position: narrow ? [11.5, 7.8, 20.5] : [9.8, 7.6, 16.8], fov: narrow ? 46 : 36, near: 0.1, far: 220 }}
      gl={{ alpha: true, antialias: quality === 'low' || xr.active, powerPreference: 'high-performance', preserveDrawingBuffer: true, stencil: false }}
      aria-label="Escena 3D del cultivo: mesa de invernadero con la planta, el suelo en corte, el tanque de agua y la bomba"
      role="img"
    >
      <QualityContext.Provider value={quality}>
        <ToneSwitch quality={quality} force={xr.active} />
        <ViewShift px={shiftPx} />
        <FocusRig controls={controls} />
        <AdaptiveRes max={maxDpr} onFloor={onQualityDrop} />
        <Smoother />
        <Env />
        <Suspense fallback={null}>
          <ArRoot>
            <Lights />
            {!xr.active && <Room />}
            {!xr.active && <Bench />}
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
