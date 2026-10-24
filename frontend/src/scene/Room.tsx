import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { sm } from './smooth'
import * as THREE from 'three'
import { FLOOR_Y } from './layout'

/** Habitación sencilla: pared clara detrás de la mesa y zócalo, para que la matera destaque como en una foto de producto. */
export function Room() {
  const wall = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.95, emissive: '#f4efe4', emissiveIntensity: 0.4 }), [])
  const base = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f6f7f4', roughness: 0.7 }), [])
  useFrame(() => {
    wall.emissiveIntensity = 0.06 + 0.5 * sm.day
  })
  return (
    <group>
      <mesh position={[0, (FLOOR_Y + 30) / 2, -8]} material={wall}>
        <planeGeometry args={[90, 30 - FLOOR_Y]} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.25, -7.97]} material={base}>
        <boxGeometry args={[90, 0.5, 0.06]} />
      </mesh>
    </group>
  )
}
