// Modo local: si cae la nube, la app habla directo con el ESP32 (http://<ip>/api/state).
//  - APK (Capacitor, esquema http) o página http: lectura directa con fetch.
//  - Web https: el navegador bloquea http://192.168.x.x (contenido mixto), así que se redirige a la página
//    que sirve el propio ESP32 (con #auto, para que vuelva sola a la nube cuando regrese).
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from './config'
import { getDevices, localRoute } from './api'
import type { LiveData } from './live'
import type { Readings, TwinState } from './types'

const PRIVATE_V4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/
const MDNS = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?\.local$/i

/** Solo red local: la app nunca debe conectar (ni redirigir) a una dirección de internet. */
export function validLocalHost(h: string | null | undefined): h is string {
  if (!h) return false
  const x = h.trim()
  if (PRIVATE_V4.test(x)) return x.split('.').every((n) => Number(n) <= 255)
  return MDNS.test(x)
}

const key = (id: string) => `simon.local.${id}`
export function loadHost(id: string): string | null {
  try {
    const v = localStorage.getItem(key(id))
    return validLocalHost(v) ? v : null
  } catch {
    return null
  }
}
export function saveHost(id: string, host: string) {
  try {
    localStorage.setItem(key(id), host)
  } catch {
    /* sin almacenamiento */
  }
}

const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
/** ¿Se puede pedir http://ip desde aquí sin que lo bloquee el navegador? */
export const CAN_FETCH_LOCAL = isNative || location.protocol === 'http:'

export type NetMode = 'cloud' | 'local'
export interface FailoverInfo {
  mode: NetMode
  host: string | null
  /** Segundos que faltan para redirigir a la página del ESP32 (solo web https). null = sin cuenta atrás. */
  redirectIn: number | null
  localError: string | null
  setHost: (h: string) => boolean
  retryCloud: () => void
  cancelRedirect: () => void
}

interface LocalState {
  ts?: number
  reading?: (Readings & { ts?: number }) | null
  pump_on?: boolean
}

async function probe(url: string, ms: number): Promise<boolean> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
    return r.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(t)
  }
}

const DOWN_AFTER = 3 // sondeos fallidos seguidos para declarar la nube caída (~15 s)
const UP_AFTER = 2 // sondeos buenos seguidos para volver

/**
 * Vigila la nube (/health) y decide si mostrar datos de la nube o locales.
 * Devuelve el mismo LiveData que la nube, con lecturas del ESP32 superpuestas cuando está en modo local.
 */
export function useFailover(deviceId: string | null, cloud: LiveData): { live: LiveData; net: FailoverInfo } {
  const [mode, setMode] = useState<NetMode>('cloud')
  const [host, setHostState] = useState<string | null>(null)
  const [localReading, setLocalReading] = useState<LocalState | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [redirectIn, setRedirectIn] = useState<number | null>(null)
  const [paused, setPaused] = useState(0) // se incrementa para forzar volver a la nube
  const cancelled = useRef(false)
  const lastCloud = useRef<TwinState | null>(null)
  if (cloud.state) lastCloud.current = cloud.state
  const mqttUp = useRef(false)
  mqttUp.current = cloud.mqtt === 'connected'

  // 1) Dirección del ESP32: guardada, anunciada por MQTT o por REST
  useEffect(() => {
    cancelled.current = false
    if (!deviceId) return
    setHostState(loadHost(deviceId))
    const q = new URLSearchParams(location.search).get('esp')
    if (validLocalHost(q)) {
      saveHost(deviceId, q)
      setHostState(q)
    }
    const ctrl = new AbortController()
    getDevices(ctrl.signal)
      .then((ds) => {
        const d = ds.find((x) => x.device_id === deviceId)
        const h = [d?.local_ip, d?.local_host].find(validLocalHost)
        if (h) {
          saveHost(deviceId, h)
          setHostState(h)
        }
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [deviceId])
  useEffect(() => {
    if (deviceId && validLocalHost(cloud.localHost)) {
      saveHost(deviceId, cloud.localHost)
      setHostState(cloud.localHost)
    }
  }, [deviceId, cloud.localHost])

  // 2) Salud de la nube con histéresis
  useEffect(() => {
    let fails = 0
    let oks = 0
    let alive = true
    const tick = async () => {
      // Con el broker conectado la nube está viva aunque /health falle por otro motivo (CORS, proxy…)
      const ok = mqttUp.current || (await probe(`${API_URL}/health`, 4000))
      if (!alive) return
      if (ok) {
        fails = 0
        oks++
        if (oks >= UP_AFTER) setMode('cloud')
      } else {
        oks = 0
        fails++
        if (fails >= DOWN_AFTER) setMode('local')
      }
    }
    void tick()
    const id = window.setInterval(tick, 5000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [paused])

  // 3) Modo local: lectura directa (APK / http) o cuenta atrás para redirigir (web https)
  useEffect(() => {
    if (mode !== 'local' || !host) {
      setRedirectIn(null)
      setLocalError(null)
      return
    }
    if (!CAN_FETCH_LOCAL) {
      if (cancelled.current) return
      let n = 8
      setRedirectIn(n)
      const id = window.setInterval(() => {
        if (cancelled.current) {
          window.clearInterval(id)
          setRedirectIn(null)
          return
        }
        n--
        setRedirectIn(n)
        if (n <= 0) {
          window.clearInterval(id)
          location.href = `http://${host}/#auto`
        }
      }, 1000)
      return () => window.clearInterval(id)
    }
    const ctrl = new AbortController()
    let alive = true
    const poll = async () => {
      const t = window.setTimeout(() => ctrl.abort(), 3000)
      try {
        const r = await fetch(`http://${host}/api/state`, { cache: 'no-store', signal: ctrl.signal })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const j = (await r.json()) as LocalState
        if (alive) {
          setLocalReading(j)
          setLocalError(null)
        }
      } catch {
        if (alive) setLocalError(`No responde ${host}. ¿El celular está en el mismo WiFi que el ESP32?`)
      } finally {
        window.clearTimeout(t)
      }
    }
    void poll()
    const id = window.setInterval(poll, 3000)
    return () => {
      alive = false
      ctrl.abort()
      window.clearInterval(id)
    }
  }, [mode, host])

  localRoute.host = mode === 'local' && CAN_FETCH_LOCAL && !localError ? host : null

  const setHost = useCallback(
    (h: string) => {
      const v = h.trim().toLowerCase()
      if (!deviceId || !validLocalHost(v)) return false
      saveHost(deviceId, v)
      setHostState(v)
      cancelled.current = false
      return true
    },
    [deviceId],
  )

  let live = cloud
  if (mode === 'local' && localReading?.reading && CAN_FETCH_LOCAL) {
    const r = localReading.reading
    const base = lastCloud.current
    const ts = r.ts && r.ts > 1.7e9 ? r.ts : Date.now() / 1000
    const readings: Readings = { ...(base?.readings ?? {}), ...r, pump_on: localReading.pump_on ?? r.pump_on }
    const state: TwinState = {
      ...(base ?? { v: 1, device_id: deviceId ?? '', ready: true }),
      device_id: deviceId ?? base?.device_id ?? '',
      ts,
      online: true,
      age_s: 0,
      readings,
      local: true,
    } as TwinState
    live = {
      ...cloud,
      state,
      stateRx: performance.now(),
      status: 'online',
      restError: null,
      telemetry: { ...r, _rx: performance.now() },
    }
  }

  return {
    live,
    net: {
      mode,
      host,
      redirectIn,
      localError,
      setHost,
      retryCloud: () => {
        setMode('cloud')
        setPaused((p) => p + 1)
      },
      cancelRedirect: () => {
        cancelled.current = true
        setRedirectIn(null)
      },
    },
  }
}
