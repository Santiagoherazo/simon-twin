import { forwardRef } from 'react'
import * as THREE from 'three'
import { initialQuality } from './quality'

/** En calidad baja (celulares de gama media/baja y APK) los materiales PBR (Standard/Physical) se cambian por
 *  Lambert (mate) o Phong (brillante): sin mapas de normales/rugosidad ni clearcoat. Compilan mucho más rápido
 *  y cuestan bastante menos por píxel en GPUs Mali/Adreno pequeñas. Se decide al cargar la app. */
export const SIMPLE = ['low', 'off'].includes(initialQuality())

const PBR_ONLY = [
  'roughness', 'metalness', 'roughnessMap', 'metalnessMap', 'normalMap', 'normalScale', 'normalMapType', 'envMapIntensity',
  'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'transmission', 'ior', 'thickness', 'iridescence',
]

type Bag = Record<string, unknown>

function lite(p: Bag): THREE.Material {
  const glossy = ((p.roughness as number | undefined) ?? 1) < 0.45
  const q: Bag = { ...p }
  for (const k of PBR_ONLY) delete q[k]
  return glossy
    ? new THREE.MeshPhongMaterial({ ...q, shininess: 70, specular: new THREE.Color('#555555') } as THREE.MeshPhongMaterialParameters)
    : new THREE.MeshLambertMaterial(q as THREE.MeshLambertMaterialParameters)
}

/** Equivale a new THREE.MeshStandardMaterial(p); en calidad baja devuelve Lambert/Phong. */
export function std(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return (SIMPLE ? lite(p as Bag) : new THREE.MeshStandardMaterial(p)) as THREE.MeshStandardMaterial
}

/** Equivale a new THREE.MeshPhysicalMaterial(p); en calidad baja devuelve Lambert/Phong. */
export function phys(p: THREE.MeshPhysicalMaterialParameters): THREE.MeshStandardMaterial {
  return (SIMPLE ? lite(p as Bag) : new THREE.MeshPhysicalMaterial(p)) as THREE.MeshStandardMaterial
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeTag(physical: boolean) {
  return forwardRef<any, any>(function Mat(props, ref) {
    if (!SIMPLE) return physical ? <meshPhysicalMaterial ref={ref} {...props} /> : <meshStandardMaterial ref={ref} {...props} />
    const rest: Bag = { ...props }
    const glossy = ((props.roughness as number | undefined) ?? 1) < 0.45
    for (const k of PBR_ONLY) delete rest[k]
    return glossy ? <meshPhongMaterial ref={ref} shininess={70} specular="#555555" {...rest} /> : <meshLambertMaterial ref={ref} {...rest} />
  })
}

/** Etiquetas JSX equivalentes a <meshStandardMaterial> y <meshPhysicalMaterial>. */
export const StdMat = makeTag(false)
export const PhysMat = makeTag(true)
