import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { sm } from './smooth'
import { backdropTexture } from './textures'
import { getXr } from '../xr'

// Entorno real (HDRI incluido en el paquete: no hay descargas): da reflejos y luz ambiente creíbles y,
// difuminado, es lo que se ve a través del cristal. Mientras carga se usa un cuarto procedural.
interface Maps {
  envDay: THREE.Texture
  envNight: THREE.Texture
  bgDay: THREE.Texture
  bgNight: THREE.Texture
}

// Cada HDRI es un módulo aparte: solo se descarga cuando hace falta.
const DAY = () => import('@pmndrs/assets/hdri/sky.exr.js')
const NIGHT = () => import('@pmndrs/assets/hdri/night.exr.js')

function loadExr(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => new EXRLoader().load(url, resolve, undefined, reject))
}

export function Env() {
  const { scene, gl } = useThree()
  const maps = useRef<Maps | null>(null)
  const shown = useRef<'room' | 'day' | 'night'>('room')

  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const roomTex = pm.fromScene(room, 0.04).texture
    scene.environment = roomTex
    scene.environmentIntensity = 0.5
    let dead = false
    const owned: THREE.Texture[] = [roomTex]
    Promise.all([DAY(), NIGHT()]).then(([a, b]) => Promise.all([loadExr(a.default), loadExr(b.default)]))
      .then(([d, n]) => {
        if (dead) {
          d.dispose()
          n.dispose()
          return
        }
        for (const t of [d, n]) t.mapping = THREE.EquirectangularReflectionMapping
        const envDay = pm.fromEquirectangular(d).texture
        const envNight = pm.fromEquirectangular(n).texture
        owned.push(d, n, envDay, envNight)
        const bgDay = backdropTexture()
        owned.push(bgDay)
        maps.current = { envDay, envNight, bgDay, bgNight: n }
        shown.current = 'room'
      })
      .catch(() => {
        /* sin HDRI queda el cuarto procedural */
      })
    return () => {
      dead = true
      maps.current = null
      scene.environment = null
      scene.background = null
      owned.forEach((t) => t.dispose())
      room.dispose()
      pm.dispose()
    }
  }, [gl, scene])

  useFrame(() => {
    const m = maps.current
    if (!m) return
    if (getXr().active) {
      scene.background = null
      shown.current = 'room'
      return
    }
    const wantDay = sm.day > 0.35
    const want = wantDay ? 'day' : 'night'
    if (shown.current !== want) {
      scene.environment = wantDay ? m.envDay : m.envNight
      scene.background = wantDay ? m.bgDay : m.bgNight
      scene.backgroundBlurriness = wantDay ? 0.02 : 0.35
      shown.current = want
    }
    // intensidad continua: el cambio de mapa ocurre cuando ambos valores son parecidos
    scene.environmentIntensity = wantDay ? 0.5 + 0.8 * sm.day : 0.55
    scene.backgroundIntensity = wantDay ? 0.75 + 0.3 * sm.day : 0.45
    scene.environmentRotation.y = 0.9
    scene.backgroundRotation.y = wantDay ? 0.4 : 0.9
  })
  return null
}
