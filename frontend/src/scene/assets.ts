import * as THREE from 'three'
import { initialQuality } from './quality'
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

// Las texturas se hornean con bucles en JS (hilo principal): en un celular 512x512 por textura son segundos de bloqueo.
const Q0 = initialQuality()
const F = Q0 === 'high' ? 1 : Q0 === 'medium' ? 0.5 : 0.25     // lado de la textura
const FL = Q0 === 'high' ? 1 : Q0 === 'medium' ? 0.75 : 0.5    // hoja
const px = (n: number) => Math.max(64, Math.round(n * F))

export const assets = {
  soil: () => get('soil', () => soilPBR(px(512))),
  gravel: () => get('gravel', () => gravelPBR(px(256))),
  wood: () => get('wood', () => woodPBR(px(512))),
  terracotta: () => get('terra', () => terracottaPBR(px(256))),
  concrete: () => get('concrete', () => concretePBR(px(512))),
  leaf: (kind: 'maize' | 'tomato') => get('leaf-' + kind, () => leafPBR(kind, Math.round(256 * FL), Math.round(512 * FL))),
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
