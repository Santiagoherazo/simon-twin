import { useEffect, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getXr, setXr, useXr, gyro } from '../xr'

type XRSessionLike = XRSession & { requestHitTestSource?: (o: { space: XRSpace }) => Promise<XRHitTestSource> }

/**
 * Raíz de la escena: en AR se reduce, se apoya en la superficie detectada (hit-test) y se oculta lo que no es
 * "el gemelo"; fuera de AR aplica una leve inclinación por giroscopio.
 */
export function ArRoot({ children }: { children: ReactNode }) {
  const { gl } = useThree()
  const root = useRef<THREE.Group>(null)
  const reticle = useRef<THREE.Group>(null)
  const xr = useXr()
  const hit = useRef<{ src: XRHitTestSource | null; ok: boolean; m: THREE.Matrix4 }>({ src: null, ok: false, m: new THREE.Matrix4() })
  const sess = useRef<XRSessionLike | null>(null)
  const seen = useRef({ start: 0, stop: 0, replace: 0 })

  // peticiones desde la interfaz
  useEffect(() => {
    const r = xr.req
    if (r.start !== seen.current.start) {
      seen.current.start = r.start
      void start()
    }
    if (r.stop !== seen.current.stop) {
      seen.current.stop = r.stop
      sess.current?.end()
    }
    if (r.replace !== seen.current.replace) {
      seen.current.replace = r.replace
      setXr({ placed: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xr.req])

  async function start() {
    const nav = navigator as Navigator & { xr?: XRSystem }
    if (!nav.xr) return
    try {
      const overlay = document.querySelector('.app') as HTMLElement | null
      const s = (await nav.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'light-estimation'],
        ...(overlay ? { domOverlay: { root: overlay } } : {}),
      } as XRSessionInit)) as XRSessionLike
      sess.current = s
      gl.xr.enabled = true
      gl.xr.setReferenceSpaceType('local')
      await gl.xr.setSession(s)
      const viewer = await s.requestReferenceSpace('viewer')
      hit.current.src = (await s.requestHitTestSource?.({ space: viewer })) ?? null
      setXr({ active: true, placed: false })
      s.addEventListener('select', () => {
        if (!hit.current.ok || !root.current) return
        const p = new THREE.Vector3()
        const q = new THREE.Quaternion()
        hit.current.m.decompose(p, q, new THREE.Vector3())
        root.current.position.copy(p)
        // gira el gemelo para que mire hacia quien lo coloca
        const cam = gl.xr.getCamera().position
        root.current.rotation.set(0, Math.atan2(cam.x - p.x, cam.z - p.z), 0)
        setXr({ placed: true })
      })
      s.addEventListener('end', () => {
        hit.current.src?.cancel()
        hit.current.src = null
        hit.current.ok = false
        sess.current = null
        gl.xr.enabled = false
        setXr({ active: false, placed: false })
      })
    } catch (e) {
      console.warn('AR no pudo iniciar', e)
      setXr({ support: 'no', why: 'No se pudo iniciar la cámara AR. Revisa el permiso de cámara.' })
    }
  }

  useFrame((_s, dt, frame) => {
    const g = root.current
    if (!g) return
    const x = getXr()
    if (x.active) {
      g.scale.setScalar(x.scale)
      const f = frame as XRFrame | undefined
      const ref = gl.xr.getReferenceSpace()
      hit.current.ok = false
      if (f && ref && hit.current.src) {
        const res = f.getHitTestResults(hit.current.src)
        if (res.length) {
          const pose = res[0].getPose(ref)
          if (pose) {
            hit.current.m.fromArray(pose.transform.matrix)
            hit.current.ok = true
          }
        }
      }
      const r = reticle.current
      if (r) {
        r.visible = hit.current.ok && !x.placed
        if (r.visible) {
          r.matrix.copy(hit.current.m)
          r.matrixAutoUpdate = false
        }
      }
      g.visible = x.placed
    } else {
      g.visible = true
      g.scale.setScalar(1)
      g.position.set(0, 0, 0)
      const tx = gyro.on ? gyro.y * 0.2 : 0
      const tz = gyro.on ? gyro.x * 0.12 : 0
      g.rotation.y += (tx - g.rotation.y) * Math.min(1, dt * 4)
      g.rotation.x += (tz - g.rotation.x) * Math.min(1, dt * 4)
    }
  })

  return (
    <>
      <group ref={reticle} visible={false} matrixAutoUpdate={false}>
        <mesh rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.1, 0.13, 40]} />
          <meshBasicMaterial color="#9dffb4" side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.015, 20]} />
          <meshBasicMaterial color="#9dffb4" side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>
      <group ref={root}>{children}</group>
    </>
  )
}
