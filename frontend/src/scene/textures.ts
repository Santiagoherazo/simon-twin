import * as THREE from 'three'

// Texturas 100 % procedurales (canvas 2D): no se descarga ningún recurso externo.

function makeCanvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

function toTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// Generador pseudoaleatorio determinista para que la textura sea igual en cada carga
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Grano de tierra en escala de grises: se multiplica por el color de la capa. */
export function soilTexture() {
  const { c, ctx } = makeCanvas(256)
  const r = rng(7)
  ctx.fillStyle = '#d4d4d4'
  ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 5200; i++) {
    const v = r() < 0.5 ? 60 + r() * 60 : 215 + r() * 40
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.5})`
    const s = 0.8 + r() * 2.2
    ctx.fillRect(r() * 256, r() * 256, s, s)
  }
  for (let i = 0; i < 46; i++) {
    const x = r() * 256
    const y = r() * 256
    const rx = 2 + r() * 4
    ctx.fillStyle = `rgba(250,250,250,${0.5 + r() * 0.4})`
    ctx.beginPath()
    ctx.ellipse(x, y, rx, rx * (0.6 + r() * 0.3), r() * 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(40,40,40,.55)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }
  // vetas de raíces finas
  ctx.strokeStyle = 'rgba(255,255,255,.35)'
  ctx.lineWidth = 0.7
  for (let i = 0; i < 14; i++) {
    ctx.beginPath()
    let x = r() * 256
    let y = r() * 256
    ctx.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 18
      y += 6 + r() * 10
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return toTexture(c, 1.2, 1)
}

/** Grava de drenaje. */
export function gravelTexture() {
  const { c, ctx } = makeCanvas(128)
  const r = rng(21)
  ctx.fillStyle = '#9a9a9a'
  ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 140; i++) {
    const g = 110 + r() * 120
    ctx.fillStyle = `rgb(${g},${g * 0.98},${g * 0.94})`
    ctx.beginPath()
    ctx.ellipse(r() * 128, r() * 128, 3 + r() * 5, 2.5 + r() * 4, r() * 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(30,30,30,.5)'
    ctx.stroke()
  }
  return toTexture(c, 1.5, 0.5)
}

export function woodTexture() {
  const { c, ctx } = makeCanvas(256)
  const r = rng(99)
  ctx.fillStyle = '#c79a66'
  ctx.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 1) {
    const tone = 0.5 + 0.5 * Math.sin(y * 0.21 + Math.sin(y * 0.05) * 3)
    ctx.fillStyle = `rgba(90,52,22,${0.05 + tone * 0.18})`
    ctx.fillRect(0, y, 256, 1)
  }
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(80,45,20,${0.1 + r() * 0.25})`
    ctx.lineWidth = 0.6
    const y = r() * 256
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.bezierCurveTo(80, y + (r() - 0.5) * 6, 170, y + (r() - 0.5) * 6, 256, y + (r() - 0.5) * 4)
    ctx.stroke()
  }
  // juntas entre tablas
  ctx.fillStyle = 'rgba(40,22,10,.55)'
  ctx.fillRect(0, 0, 256, 2)
  ctx.fillRect(0, 128, 256, 2)
  return toTexture(c, 2, 1)
}

export function floorTexture() {
  const { c, ctx } = makeCanvas(256)
  const r = rng(5)
  ctx.fillStyle = '#a7aca4'
  ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 3000; i++) {
    const v = 120 + r() * 100
    ctx.fillStyle = `rgba(${v},${v},${v - 4},.22)`
    ctx.fillRect(r() * 256, r() * 256, 1.5, 1.5)
  }
  ctx.strokeStyle = 'rgba(60,66,60,.55)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, 254, 254)
  return toTexture(c, 15, 15)
}

/** Franjas con alfa que se desplazan para sugerir agua que fluye por la manguera. */
export function flowTexture() {
  const { c, ctx } = makeCanvas(128)
  ctx.clearRect(0, 0, 128, 128)
  const g = ctx.createLinearGradient(0, 0, 128, 0)
  g.addColorStop(0, 'rgba(255,255,255,0.15)')
  g.addColorStop(0.5, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0.15)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(18, 1)
  return t
}

/** Signo de exclamación para los marcadores de alerta. */
export function alertTexture() {
  const { c, ctx } = makeCanvas(128)
  ctx.fillStyle = '#d3262b'
  ctx.beginPath()
  ctx.arc(64, 64, 58, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 7
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 84px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', 64, 70)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Halo radial suave (aditivo) para el marcador luminoso de la sonda. */
export function glowTexture() {
  const { c, ctx } = makeCanvas(128)
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Panorama equirectangular de día: cielo, nubes difusas y una línea de árboles lejana (se ve a través del cristal). */
export function backdropTexture() {
  const W = 2048
  const H = 1024
  const { c, ctx } = makeCanvas(W)
  c.height = H
  const r = rng(314)
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.5)
  sky.addColorStop(0, '#7fb0de')
  sky.addColorStop(0.55, '#b9d6ee')
  sky.addColorStop(1, '#f1efe6')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H * 0.5)
  const ground = ctx.createLinearGradient(0, H * 0.5, 0, H)
  ground.addColorStop(0, '#c3cfa9')
  ground.addColorStop(0.5, '#8ea874')
  ground.addColorStop(1, '#5f7d52')
  ctx.fillStyle = ground
  ctx.fillRect(0, H * 0.5, W, H * 0.5)
  const blur = (px: number) => {
    ;(ctx as CanvasRenderingContext2D & { filter: string }).filter = px ? `blur(${px}px)` : 'none'
  }
  // nubes
  blur(16)
  for (let i = 0; i < 46; i++) {
    const x = r() * W
    const y = H * (0.08 + r() * 0.3)
    ctx.fillStyle = `rgba(255,255,255,${0.28 + r() * 0.35})`
    ctx.beginPath()
    ctx.ellipse(x, y, 60 + r() * 150, 12 + r() * 30, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // línea de árboles: capa lejana azulada y capa cercana más verde
  const layers: [string[], number, number, number][] = [
    [['#9fb8a4', '#a9c0ae', '#94b09c'], 7, 26, 44],
    [['#5f8a52', '#4f7a47', '#6a9658', '#577f4b'], 4, 34, 62],
  ]
  for (const [cols, b, rmin, rmax] of layers) {
    blur(b)
    for (let x = -40; x < W + 40; x += 16 + r() * 22) {
      const rad = rmin + r() * (rmax - rmin)
      ctx.fillStyle = cols[Math.floor(r() * cols.length)]
      ctx.beginPath()
      ctx.ellipse(x, H * 0.5 - rad * 0.35 + r() * 10, rad * (0.8 + r() * 0.5), rad, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // neblina en el horizonte
  blur(0)
  const haze = ctx.createLinearGradient(0, H * 0.42, 0, H * 0.58)
  haze.addColorStop(0, 'rgba(244,240,230,0)')
  haze.addColorStop(0.5, 'rgba(244,240,230,0.55)')
  haze.addColorStop(1, 'rgba(244,240,230,0)')
  ctx.fillStyle = haze
  ctx.fillRect(0, H * 0.42, W, H * 0.16)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.mapping = THREE.EquirectangularReflectionMapping
  return t
}
