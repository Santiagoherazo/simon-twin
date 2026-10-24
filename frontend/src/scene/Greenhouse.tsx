import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { FLOOR_Y } from './layout'

// Estructura del invernadero: marcos de aluminio y paneles de vidrio translúcido. El frente queda
// abierto (de ahí mira la cámara); se dibujan fondo, laterales y techo a dos aguas.
const HALF_W = 19 // medio ancho (x)
const BACK_Z = -15
const FRONT_Z = 9
const WALL_TOP = 7.5
const RIDGE = 12.5
const POST = 0.22

export function Greenhouse() {
  const { glass, frame } = useMemo(
    () => ({
      glass: new THREE.MeshPhysicalMaterial({
        color: '#e3f3f7',
        transparent: true,
        opacity: 0.07,
        roughness: 0.04,
        metalness: 0,
        ior: 1.5,
        reflectivity: 0.9,
        envMapIntensity: 1.8,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      frame: new THREE.MeshStandardMaterial({ color: '#c3cbd0', roughness: 0.34, metalness: 0.85, envMapIntensity: 1.3 }),
    }),
    [],
  )
  useEffect(
    () => () => {
      glass.dispose()
      frame.dispose()
    },
    [glass, frame],
  )

  const wallH = WALL_TOP - FLOOR_Y
  const wallY = FLOOR_Y + wallH / 2
  const slope = Math.atan2(RIDGE - WALL_TOP, HALF_W)
  const roofLen = Math.hypot(HALF_W, RIDGE - WALL_TOP)
  const backPosts = Array.from({ length: 7 }, (_, i) => -HALF_W + (i * (HALF_W * 2)) / 6)
  const sidePosts = Array.from({ length: 5 }, (_, i) => BACK_Z + (i * (FRONT_Z - BACK_Z)) / 4)

  return (
    <group>
      {/* vidrio */}
      <mesh position={[0, wallY, BACK_Z]} material={glass}>
        <planeGeometry args={[HALF_W * 2, wallH]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * HALF_W, wallY, (BACK_Z + FRONT_Z) / 2]} rotation-y={Math.PI / 2} material={glass}>
          <planeGeometry args={[FRONT_Z - BACK_Z, wallH]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (HALF_W / 2), (WALL_TOP + RIDGE) / 2, (BACK_Z + FRONT_Z) / 2]}
          rotation={[Math.PI / 2, 0, -s * slope, 'ZYX']}
          material={glass}
        >
          <planeGeometry args={[roofLen, FRONT_Z - BACK_Z]} />
        </mesh>
      ))}
      {/* frontón trasero (triángulo bajo el techo) */}
      <mesh position={[0, WALL_TOP + (RIDGE - WALL_TOP) / 2, BACK_Z]} material={glass}>
        <planeGeometry args={[HALF_W * 2, RIDGE - WALL_TOP]} />
      </mesh>

      {/* postes */}
      {backPosts.map((x) => (
        <mesh key={`b${x}`} position={[x, wallY, BACK_Z]} material={frame}>
          <boxGeometry args={[POST, wallH, POST]} />
        </mesh>
      ))}
      {[-1, 1].flatMap((s) =>
        sidePosts.map((z) => (
          <mesh key={`s${s}${z}`} position={[s * HALF_W, wallY, z]} material={frame}>
            <boxGeometry args={[POST, wallH, POST]} />
          </mesh>
        )),
      )}
      {/* vigas del techo (cerchas) */}
      {sidePosts.flatMap((z) =>
        [-1, 1].map((s) => (
          <mesh
            key={`r${z}${s}`}
            position={[s * (HALF_W / 2), (WALL_TOP + RIDGE) / 2, z]}
            rotation-z={-s * slope}
            material={frame}
           
          >
            <boxGeometry args={[roofLen, POST * 0.7, POST * 0.7]} />
          </mesh>
        )),
      )}
      {/* cumbrera y largueros */}
      <mesh position={[0, RIDGE, (BACK_Z + FRONT_Z) / 2]} material={frame}>
        <boxGeometry args={[POST * 0.8, POST * 0.8, FRONT_Z - BACK_Z]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[s * HALF_W, WALL_TOP, (BACK_Z + FRONT_Z) / 2]} material={frame}>
          <boxGeometry args={[POST * 0.8, POST * 0.8, FRONT_Z - BACK_Z]} />
        </mesh>
      ))}
      <mesh position={[0, WALL_TOP, BACK_Z]} material={frame}>
        <boxGeometry args={[HALF_W * 2, POST * 0.8, POST * 0.8]} />
      </mesh>
    </group>
  )
}
