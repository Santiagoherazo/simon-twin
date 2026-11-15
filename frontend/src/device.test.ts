import { describe, expect, it } from 'vitest'
import { classify, detectDevice, type DeviceEnv } from './device'

const base: DeviceEnv = { ua: '', uaMobile: null, platform: '', touchPoints: 0, coarse: false, hoverNone: false, screenMin: 1080, native: false, gpu: 'NVIDIA GeForce RTX 3060', hasWebGL: true }
const env = (o: Partial<DeviceEnv>): DeviceEnv => ({ ...base, ...o })

const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
}

describe('tipo de equipo', () => {
  it('PC con tarjeta gráfica: alta', () => {
    const d = detectDevice(env({ ua: UA.win, platform: 'Win32' }))
    expect(d.kind).toBe('desktop')
    expect(d.suggested).toBe('high')
  })
  it('Mac: PC, alta', () => {
    expect(detectDevice(env({ ua: UA.mac, platform: 'MacIntel', gpu: 'Apple M2' })).suggested).toBe('high')
  })
  it('portátil con pantalla táctil sigue siendo PC', () => {
    expect(classify(env({ ua: UA.win, platform: 'Win32', touchPoints: 10 }))).toBe('desktop')
  })
  it('iPhone y Android: celular, sin 3D', () => {
    for (const ua of [UA.iphone, UA.androidPhone]) {
      const d = detectDevice(env({ ua, coarse: true, hoverNone: true, touchPoints: 5, screenMin: 390 }))
      expect(d.kind).toBe('phone')
      expect(d.suggested).toBe('off')
    }
  })
  it('emulación de celular en las herramientas del navegador', () => {
    expect(classify(env({ ua: UA.win, uaMobile: true }))).toBe('phone')
  })
  it('iPad, iPadOS disfrazado de Mac y tableta Android: tableta, media', () => {
    expect(classify(env({ ua: UA.ipad, coarse: true, screenMin: 820 }))).toBe('tablet')
    expect(classify(env({ ua: UA.mac, platform: 'MacIntel', touchPoints: 5, coarse: true, screenMin: 820 }))).toBe('tablet')
    const t = detectDevice(env({ ua: UA.androidTablet, coarse: true, screenMin: 800 }))
    expect(t.kind).toBe('tablet')
    expect(t.suggested).toBe('medium')
  })
  it('«ver como computador» en un celular: manda el puntero táctil', () => {
    expect(classify(env({ ua: UA.win, platform: 'Win32', coarse: true, hoverNone: true, screenMin: 390 }))).toBe('phone')
  })
  it('APK instalada: por tamaño de pantalla', () => {
    expect(classify(env({ native: true, screenMin: 412 }))).toBe('phone')
    expect(classify(env({ native: true, screenMin: 800 }))).toBe('tablet')
  })
  it('PC sin aceleración gráfica: baja; sin WebGL: sin 3D', () => {
    expect(detectDevice(env({ ua: UA.win, gpu: 'Google SwiftShader' })).suggested).toBe('low')
    expect(detectDevice(env({ ua: UA.win, gpu: 'llvmpipe (LLVM 15.0.7)' })).suggested).toBe('low')
    expect(detectDevice(env({ ua: UA.win, gpu: null, hasWebGL: false })).suggested).toBe('off')
  })
})
