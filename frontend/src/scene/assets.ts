import * as THREE from 'three'
import { concretePBR, gravelPBR, leafPBR, soilPBR, terracottaPBR, woodPBR, type PbrSet } from './pbr'

// Cada set se hornea una sola vez (la primera vez que se pide) y vive mientras dure la app.
const cache = new Map<string, PbrSet>()
const get = (k: string, f: () => PbrSet) => {
  let v = cache.get(k)
  if (!v) {
    v = f()
    cache.set(k, v)
  }
  return v
}

export const assets = {
  soil: () => get('soil', () => soilPBR(512)),
  gravel: () => get('gravel', () => gravelPBR(256)),
  wood: () => get('wood', () => woodPBR(512)),
  terracotta: () => get('terra', () => terracottaPBR(256)),
  concrete: () => get('concrete', () => concretePBR(512)),
  leaf: (kind: 'maize' | 'tomato') => get('leaf-' + kind, () => leafPBR(kind)),
}

/** Copia de un set con otra repetición (comparte la imagen, no la memoria de la GPU duplicada de la CPU). */
export function withRepeat(p: PbrSet, rx: number, ry: number): PbrSet {
  const c = (t: THREE.DataTexture) => {
    const n = t.clone()
    n.repeat.set(rx, ry)
    n.needsUpdate = true
    return n
  }
  return { map: c(p.map), normalMap: c(p.normalMap), roughnessMap: c(p.roughnessMap) }
}
