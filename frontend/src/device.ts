import type { Quality } from './scene/quality'

/** Qué tipo de equipo es: decide los gráficos por defecto (PC = alta, tableta = media, celular = sin 3D). */
export type DeviceKind = 'desktop' | 'tablet' | 'phone'
export const KIND_LABEL: Record<DeviceKind, string> = { desktop: 'PC', tablet: 'Tableta', phone: 'Celular' }

/** Lo que se lee del navegador. Se separa para poder probar la clasificación con equipos inventados. */
export interface DeviceEnv {
  ua: string
  /** navigator.userAgentData.mobile (Chrome/Edge); null si el navegador no lo da. */
  uaMobile: boolean | null
  platform: string
  touchPoints: number
  /** El puntero principal es táctil (dedo), no ratón. */
  coarse: boolean
  /** El dispositivo no puede «pasar el cursor por encima». */
  hoverNone: boolean
  /** Lado menor de la pantalla física, en píxeles CSS. */
  screenMin: number
  /** App instalada (APK de Capacitor). */
  native: boolean
  /** Renderizador de WebGL; null si no hay WebGL. */
  gpu: string | null
  hasWebGL: boolean
}

export interface DeviceProfile {
  kind: DeviceKind
  label: string
  touch: boolean
  native: boolean
  gpu: string | null
  /** Sin aceleración por hardware (o sin WebGL): el 3D iría a saltos. */
  softwareGpu: boolean
  suggested: Quality
  reason: string
}

const PHONE_UA = /iPhone|iPod|Windows Phone|Android.*Mobile|Mobile.*Firefox|BlackBerry|IEMobile|Opera Mini/i
const TABLET_UA = /iPad|Android(?!.*Mobile)|Tablet|Silk|Kindle|PlayBook/i
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i

export function classify(env: DeviceEnv): DeviceKind {
  if (env.native) return env.screenMin < 600 ? 'phone' : 'tablet'
  if (env.uaMobile === true || PHONE_UA.test(env.ua)) return 'phone'
  // iPadOS se hace pasar por un Mac, pero un Mac no tiene pantalla táctil
  const ipadOS = /Mac/i.test(env.platform) && env.touchPoints > 1
  if (TABLET_UA.test(env.ua) || ipadOS) return 'tablet'
  // «Ver como computador» en un celular o un navegador raro: manda el puntero, no el nombre
  if (env.coarse || env.hoverNone) return env.screenMin < 600 ? 'phone' : 'tablet'
  return 'desktop'
}

export function suggest(kind: DeviceKind, softwareGpu: boolean, hasWebGL: boolean): { quality: Quality; reason: string } {
  if (!hasWebGL) return { quality: 'off', reason: 'Este navegador no tiene WebGL: solo datos, sin 3D.' }
  if (kind === 'phone') return { quality: 'off', reason: 'En el celular se muestran solo los datos, sin 3D, para ahorrar batería y evitar saltos.' }
  if (softwareGpu) return { quality: 'low', reason: 'No hay aceleración gráfica por hardware: calidad baja para que no se trabe.' }
  if (kind === 'tablet') return { quality: 'medium', reason: 'Tableta: calidad media.' }
  return { quality: 'high', reason: 'PC: calidad alta.' }
}

let gpuCache: { gpu: string | null; ok: boolean } | undefined
function probeGpu(): { gpu: string | null; ok: boolean } {
  if (gpuCache) return gpuCache
  let out = { gpu: null as string | null, ok: false }
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
      out = { gpu: name, ok: true }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    /* sin WebGL */
  }
  gpuCache = out
  return out
}

export function readEnv(): DeviceEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const mm = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches
  const g = probeGpu()
  return {
    ua: nav.userAgent ?? '',
    uaMobile: typeof nav.userAgentData?.mobile === 'boolean' ? nav.userAgentData.mobile : null,
    platform: nav.platform ?? '',
    touchPoints: nav.maxTouchPoints ?? 0,
    coarse: mm('(pointer: coarse)'),
    hoverNone: mm('(hover: none)'),
    screenMin: Math.min(screen.width || 9999, screen.height || 9999),
    native: !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
    gpu: g.gpu,
    hasWebGL: g.ok,
  }
}

export function detectDevice(env: DeviceEnv = readEnv()): DeviceProfile {
  const kind = classify(env)
  const softwareGpu = !env.hasWebGL || SOFTWARE_GPU.test(env.gpu ?? '')
  const s = suggest(kind, softwareGpu, env.hasWebGL)
  return { kind, label: KIND_LABEL[kind], touch: env.touchPoints > 0 || env.coarse, native: env.native, gpu: env.gpu, softwareGpu, suggested: s.quality, reason: s.reason }
}
