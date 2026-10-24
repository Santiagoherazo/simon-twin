import * as THREE from 'three'
import type { PbrSet } from './pbr'

// En la sombra propia de la hoja no llega luz directa; este término simula la luz que atraviesa la hoja
// fina (translucidez) y suaviza el terminador (difusa envolvente), igual que una hoja real a contraluz.
const LEAF_DIRECT = /* glsl */ `
void RE_Direct_Leaf( const in IncidentLight dl, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( dl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float nl = dot( geometryNormal, dl.direction );
  float wrapNL = saturate( ( nl + 0.3 ) / 1.3 );
  reflectedLight.directDiffuse += dl.color * BRDF_Lambert( material.diffuseColor ) * ( wrapNL - saturate( nl ) ) * 0.8;
  float back = saturate( -nl );
  float fwd = pow( saturate( dot( -geometryViewDir, dl.direction ) ), 3.0 );
  vec3 tcol = material.diffuseColor * vec3( 0.9, 1.05, 0.6 );
  reflectedLight.directDiffuse += dl.color * tcol * ( 0.32 * back + 0.9 * fwd * back );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
`

export function leafMaterial(pbr: PbrSet, opts: { roughness?: number; side?: THREE.Side } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    side: opts.side ?? THREE.DoubleSide,
    map: pbr.map,
    normalMap: pbr.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: pbr.roughnessMap,
    roughness: opts.roughness ?? 0.95,
    sheen: 0.55,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#bfe6a0'),
    envMapIntensity: 0.9,
  })
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + LEAF_DIRECT)
  }
  m.customProgramCacheKey = () => 'simon-leaf-v2'
  return m
}

/** Material PBR estándar a partir de un set horneado. */
export function pbrMaterial(
  pbr: PbrSet,
  o: { color?: THREE.ColorRepresentation; roughness?: number; normalScale?: number; envMapIntensity?: number } = {},
) {
  return new THREE.MeshStandardMaterial({
    map: pbr.map,
    normalMap: pbr.normalMap,
    normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    roughnessMap: pbr.roughnessMap,
    roughness: o.roughness ?? 1,
    color: o.color ?? '#ffffff',
    envMapIntensity: o.envMapIntensity ?? 1,
  })
}

/** Vidrio de reflejos limpios (sin transmisión: así deja ver el contenido sin pases extra). */
export function glassMaterial(opacity = 0.14) {
  return new THREE.MeshPhysicalMaterial({
    color: '#e9f6fb',
    transparent: true,
    opacity,
    roughness: 0.03,
    metalness: 0,
    ior: 1.5,
    reflectivity: 0.9,
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}
