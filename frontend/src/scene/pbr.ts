import * as THREE from 'three'

// Texturas PBR 100 % procedurales, "horneadas" en CPU una sola vez (ruido periódico = sin costuras).
// Cada generador devuelve color, normales y rugosidad. Sin descargas externas.

export interface PbrSet {
  map: THREE.DataTexture
  normalMap: THREE.DataTexture
  roughnessMap: THREE.DataTexture
}

// ---------- ruido ----------
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
const smooth = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Ruido de valor periódico: u,v en [0,1) y periodos enteros (px, py) → se repite sin costura. */
function vnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px
  const y = v * py
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const x0 = ((ix % px) + px) % px
  const x1 = (x0 + 1) % px
  const y0 = ((iy % py) + py) % py
  const y1 = (y0 + 1) % py
  return mix(
    mix(hash(x0, y0, seed), hash(x1, y0, seed), fx),
    mix(hash(x0, y1, seed), hash(x1, y1, seed), fx),
    fy,
  )
}

function fbm(u: number, v: number, period: number, oct: number, seed: number): number {
  let a = 0.5
  let sum = 0
  let norm = 0
  let p = period
  for (let o = 0; o < oct; o++) {
    sum += a * vnoise(u, v, p, p, seed + o * 17)
    norm += a
    a *= 0.5
    p *= 2
  }
  return sum / norm
}

interface Cell {
  f1: number
  f2: number
  id: number
}
const CELL: Cell = { f1: 0, f2: 0, id: 0 }

/** Worley periódico: f1/f2 en unidades de celda, id estable del grano más cercano. */
function worley(u: number, v: number, period: number, seed: number, jitter = 0.85): Cell {
  const x = u * period
  const y = v * period
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let f1 = 9
  let f2 = 9
  let id = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx
      const cy = iy + dy
      const wx = ((cx % period) + period) % period
      const wy = ((cy % period) + period) % period
      const px = cx + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter
      const py = cy + 0.5 + (hash(wx, wy, seed + 101) - 0.5) * jitter
      const d = Math.hypot(px - x, py - y)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = hash(wx, wy, seed + 202)
      } else if (d < f2) f2 = d
    }
  }
  CELL.f1 = f1
  CELL.f2 = f2
  CELL.id = id
  return CELL
}

// ---------- empaquetado ----------
function dataTexture(data: Uint8Array, w: number, h: number, srgb: boolean, rx: number, ry: number) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 8
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.repeat.set(rx, ry)
  t.needsUpdate = true
  return t
}

/** Altura → normales en espacio tangente (convención OpenGL, +Y = v creciente). */
function bakeNormals(hgt: Float32Array, w: number, h: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const yu = ((y + 1) % h) * w
    const yd = ((y - 1 + h) % h) * w
    const yr = y * w
    for (let x = 0; x < w; x++) {
      const xr = (x + 1) % w
      const xl = (x - 1 + w) % w
      const dx = (hgt[yr + xr] - hgt[yr + xl]) * strength
      const dy = (hgt[yu + x] - hgt[yd + x]) * strength
      const inv = 1 / Math.hypot(dx, dy, 1)
      const i = (yr + x) * 4
      out[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      out[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255)
      out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      out[i + 3] = 255
    }
  }
  return out
}

function packRough(r: Float32Array): Uint8Array {
  const out = new Uint8Array(r.length * 4)
  for (let i = 0; i < r.length; i++) {
    const v = Math.round(clamp(r[i]) * 255)
    out[i * 4] = v
    out[i * 4 + 1] = v
    out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}

function finish(
  size: [number, number],
  alb: Uint8Array,
  hgt: Float32Array,
  rough: Float32Array,
  normalStrength: number,
  repeat: [number, number],
): PbrSet {
  const [w, h] = size
  return {
    map: dataTexture(alb, w, h, true, repeat[0], repeat[1]),
    normalMap: dataTexture(bakeNormals(hgt, w, h, normalStrength), w, h, false, repeat[0], repeat[1]),
    roughnessMap: dataTexture(packRough(rough), w, h, false, repeat[0], repeat[1]),
  }
}

export function disposePbr(p: PbrSet) {
  p.map.dispose()
  p.normalMap.dispose()
  p.roughnessMap.dispose()
}

// ---------- suelo: granos con relieve (sustrato desmenuzable + perlita) ----------
export function soilPBR(size = 512): PbrSet {
  const hgt = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const alb = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const a = worley(u, v, 13, 11)
      const f1a = a.f1
      const gapA = clamp((a.f2 - a.f1) * 3.4)
      const idA = a.id
      const capA = Math.sqrt(Math.max(0, 1 - Math.pow(f1a / 0.66, 2)))
      const b = worley(u, v, 38, 23)
      const gapB = clamp((b.f2 - b.f1) * 3)
      const capB = Math.sqrt(Math.max(0, 1 - Math.pow(b.f1 / 0.62, 2)))
      const crumb = fbm(u, v, 70, 2, 5)
      const perlite = idA > 0.9
      const hh = (0.55 * capA * (0.65 + 0.35 * idA) + 0.28 * capB * (0.6 + 0.4 * b.id) + 0.14 * crumb) * (0.35 + 0.65 * gapA) - (1 - gapB) * 0.1
      const cavity = clamp(0.45 + hh * 0.8, 0.25, 1)
      let lum = (0.46 + 0.42 * idA + 0.2 * (b.id - 0.5)) * cavity * (0.55 + 0.45 * gapA)
      if (perlite) lum = 0.9 + 0.1 * b.id
      const i = y * size + x
      hgt[i] = perlite ? hh * 1.1 + 0.1 : hh
      const l = clamp(lum) * 255
      alb[i * 4] = l
      alb[i * 4 + 1] = l * (0.97 + 0.03 * idA)
      alb[i * 4 + 2] = l * (0.93 + 0.05 * idA)
      alb[i * 4 + 3] = 255
      rough[i] = perlite ? 0.7 : 0.88 + 0.12 * (1 - gapA)
    }
  }
  return finish([size, size], alb, hgt, rough, 5.5, [1.5, 1.2])
}

// ---------- grava de drenaje ----------
export function gravelPBR(size = 256): PbrSet {
  const hgt = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const alb = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const w = worley(u, v, 9, 41, 0.7)
      const cap = Math.pow(Math.max(0, 1 - w.f1 / 0.68), 0.55)
      const gap = clamp((w.f2 - w.f1) * 3.2)
      const i = y * size + x
      hgt[i] = cap * (0.6 + 0.4 * w.id) * gap
      const g = (130 + 100 * w.id) * (0.45 + 0.55 * gap) * (0.75 + 0.25 * cap)
      alb[i * 4] = g
      alb[i * 4 + 1] = g * 0.97
      alb[i * 4 + 2] = g * (0.88 + 0.06 * w.id)
      alb[i * 4 + 3] = 255
      rough[i] = 0.62 + 0.3 * (1 - cap)
    }
  }
  return finish([size, size], alb, hgt, rough, 7, [1.6, 0.6])
}

// ---------- madera de roble: tablas largas en x ----------
export function woodPBR(size = 512): PbrSet {
  const hgt = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const alb = new Uint8Array(size * size * 4)
  const PLANKS = 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const plank = Math.min(PLANKS - 1, Math.floor(v * PLANKS))
      const pv = v * PLANKS - plank
      const off = hash(plank, 7, 3)
      const uu = (u + off) % 1
      const warp = 3.2 * vnoise(uu, pv, 3, 5, 31) + 1.6 * vnoise(uu, pv, 7, 11, 47)
      const phase = pv * 8 + warp
      const ring = Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI * 2), 1.4)
      const pores = smooth(clamp((vnoise(uu, pv, 36, 200, 53) - 0.7) / 0.25))
      const fine = vnoise(uu, pv, 14, 120, 71)
      const edge = Math.min(pv, 1 - pv)
      const gap = smooth(clamp(edge / 0.018))
      const tone = 0.9 + 0.2 * hash(plank, 1, 9)
      const t = clamp(ring * 0.55 + (1 - fine) * 0.25 + pores * 0.25)
      const r = mix(206, 140, t) * tone * (0.35 + 0.65 * gap)
      const g = mix(158, 98, t) * tone * (0.35 + 0.65 * gap)
      const b = mix(104, 62, t) * tone * (0.35 + 0.65 * gap)
      const i = y * size + x
      alb[i * 4] = r
      alb[i * 4 + 1] = g
      alb[i * 4 + 2] = b
      alb[i * 4 + 3] = 255
      hgt[i] = gap * (0.5 + 0.22 * ring - 0.3 * pores + 0.08 * fine)
      rough[i] = clamp(0.5 + 0.22 * pores + 0.16 * (1 - ring) + 0.08 * fine) * (0.8 + 0.2 * gap) + (1 - gap) * 0.3
    }
  }
  return finish([size, size], alb, hgt, rough, 4, [1, 1])
}

// ---------- terracota ----------
export function terracottaPBR(size = 256): PbrSet {
  const hgt = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const alb = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const m = fbm(u, v, 4, 4, 13)
      const grain = fbm(u, v, 48, 2, 29)
      const bloom = smooth(clamp((fbm(u, v, 6, 3, 61) - 0.58) / 0.2)) // eflorescencia blanquecina
      const speck = hash(x, y, 5) > 0.994 ? 1 : 0
      const k = 0.82 + 0.3 * m + 0.14 * grain
      let r = 188 * k
      let g = 104 * k
      let b = 78 * k
      r = mix(r, 214, bloom * 0.5)
      g = mix(g, 176, bloom * 0.5)
      b = mix(b, 150, bloom * 0.5)
      if (speck) {
        r *= 0.55
        g *= 0.5
        b *= 0.5
      }
      const i = y * size + x
      alb[i * 4] = r
      alb[i * 4 + 1] = g
      alb[i * 4 + 2] = b
      alb[i * 4 + 3] = 255
      hgt[i] = grain * 0.6 + m * 0.25 - speck * 0.3
      rough[i] = 0.78 + 0.2 * grain + bloom * 0.05
    }
  }
  return finish([size, size], alb, hgt, rough, 2.4, [1.5, 1.5])
}

// ---------- hormigón pulido (losa del invernadero) ----------
export function concretePBR(size = 512): PbrSet {
  const hgt = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const alb = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const m = fbm(u, v, 3, 5, 3)
      const fine = fbm(u, v, 32, 2, 8)
      const pit = worley(u, v, 26, 77, 0.9)
      const pitMask = smooth(clamp((0.16 - pit.f1) / 0.1)) * (pit.id > 0.82 ? 1 : 0)
      const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v))
      const grout = smooth(clamp(edge / 0.012))
      const polish = smooth(clamp((fbm(u, v, 2, 3, 19) - 0.35) / 0.3))
      const k = (0.82 + 0.28 * m + 0.08 * fine) * (0.5 + 0.5 * grout) * (1 - pitMask * 0.4)
      const i = y * size + x
      alb[i * 4] = 150 * k
      alb[i * 4 + 1] = 153 * k
      alb[i * 4 + 2] = 146 * k
      alb[i * 4 + 3] = 255
      hgt[i] = grout * (0.5 + 0.3 * fine) - pitMask * 0.5
      rough[i] = mix(0.85, 0.42, polish) * grout + (1 - grout) * 0.95 + pitMask * 0.2
    }
  }
  return finish([size, size], alb, hgt, rough, 3, [12, 12])
}

// ---------- hojas: nervadura + venas (v = 0 base … 1 punta) ----------
export function leafPBR(kind: 'maize' | 'tomato', w = 256, h = 512): PbrSet {
  const hgt = new Float32Array(w * h)
  const rough = new Float32Array(w * h)
  const alb = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const du = u - 0.5
      const adu = Math.abs(du)
      let mid: number
      let veins: number
      let hh: number
      if (kind === 'maize') {
        const mw = 0.034 * (1 - 0.65 * v) + 0.01
        mid = Math.exp(-Math.pow(du / mw, 2))
        const cosv = 0.5 + 0.5 * Math.cos(adu * Math.PI * 2 * 24)
        veins = Math.pow(cosv, 2.4) * (1 - mid) * (0.6 + 0.4 * vnoise(u, v, 8, 8, 5))
        hh = mid * 1.0 + veins * 0.32 + 0.05 * fbm(u, v, 12, 2, 7)
      } else {
        const mw = 0.03 * (1 - 0.6 * v) + 0.012
        mid = Math.exp(-Math.pow(du / mw, 2))
        const ph = (v - 0.55 * adu) * 8
        const fr = ph - Math.floor(ph)
        const lat = Math.exp(-Math.pow((fr - 0.5) / 0.07, 2)) * smooth(clamp(adu / 0.06)) * (1 - smooth(clamp((adu - 0.38) / 0.1)))
        const cell = worley(u, v, 22, 91, 0.9)
        const ret = (1 - clamp((cell.f2 - cell.f1) * 4)) * 0.5
        const blister = fbm(u, v, 9, 3, 17)
        veins = lat * 0.8 + ret * 0.4
        hh = mid * 1.0 + lat * 0.7 + ret * 0.28 + blister * 0.55
      }
      const mott = fbm(u, v, 5, 3, 29)
      const i = y * w + x
      const baseR = 196 + 22 * mott
      const baseG = 212 + 18 * mott
      const baseB = 184 + 16 * mott
      const k = 1 - 0.14 * Math.min(1, veins)
      alb[i * 4] = mix(baseR * k, 238, mid)
      alb[i * 4 + 1] = mix(baseG * k, 242, mid)
      alb[i * 4 + 2] = mix(baseB * k, 214, mid)
      alb[i * 4 + 3] = 255
      hgt[i] = hh
      rough[i] = 0.5 + 0.12 * mott + 0.15 * mid
    }
  }
  return finish([w, h], alb, hgt, rough, kind === 'maize' ? 3.2 : 4.2, [1, 1])
}
