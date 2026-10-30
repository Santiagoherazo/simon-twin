import { useEffect, useRef, useState } from 'react'
import mqtt, { type MqttClient } from 'mqtt'
import { MQTT_PASS, MQTT_URL, MQTT_USER } from './config'
import { getState } from './api'
import type { Telemetry, TwinState } from './types'

export type MqttStatus = 'connecting' | 'connected' | 'reconnecting'

export interface LiveData {
  mqtt: MqttStatus
  state: TwinState | null
  /** Última telemetría cruda recibida (si es reciente se usa para pump_on, etc.). */
  telemetry: (Telemetry & { _rx: number }) | null
  /** Texto del topic status ('online' | 'offline') o null si aún no llegó. */
  status: 'online' | 'offline' | null
  /** performance.now() local en que llegó el último state (para calcular la edad del dato). */
  stateRx: number
  /** Error de la carga REST inicial, si la hubo. */
  restError: string | null
  loading: boolean
}

function isState(x: unknown): x is TwinState {
  return !!x && typeof x === 'object' && typeof (x as TwinState).device_id === 'string' && typeof (x as TwinState).ts === 'number'
}

/**
 * Mantiene la conexión MQTT (WebSockets, usuario de solo lectura) y suscribe al dispositivo elegido.
 * Además hace una carga REST inicial y, mientras el broker no esté conectado, sondea cada 5 s
 * para que el HUD no se quede vacío si solo cae el broker.
 */
export function useLive(deviceId: string | null): LiveData {
  const [mqttStatus, setMqttStatus] = useState<MqttStatus>('connecting')
  const [state, setState] = useState<TwinState | null>(null)
  const [telemetry, setTelemetry] = useState<LiveData['telemetry']>(null)
  const [status, setStatus] = useState<LiveData['status']>(null)
  const [stateRx, setStateRx] = useState(0)
  const [restError, setRestError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const clientRef = useRef<MqttClient | null>(null)
  const deviceRef = useRef<string | null>(deviceId)
  deviceRef.current = deviceId

  const applyState = useRef((s: TwinState) => {
    if (s.device_id !== deviceRef.current) return
    setState((prev) => (prev && prev.device_id === s.device_id && prev.ts > s.ts ? prev : s))
    setStateRx(performance.now())
  }).current

  // Conexión única al broker
  useEffect(() => {
    let client: MqttClient
    try {
      client = mqtt.connect(MQTT_URL, {
        username: MQTT_USER,
        password: MQTT_PASS,
        clientId: 'simon-web-' + Math.random().toString(16).slice(2, 10),
        reconnectPeriod: 3000,
        connectTimeout: 8000,
        clean: true,
      })
    } catch {
      setMqttStatus('reconnecting')
      return
    }
    clientRef.current = client
    client.on('connect', () => setMqttStatus('connected'))
    client.on('reconnect', () => setMqttStatus('reconnecting'))
    client.on('offline', () => setMqttStatus('reconnecting'))
    client.on('close', () => setMqttStatus((s) => (s === 'connecting' ? s : 'reconnecting')))
    client.on('error', () => {
      /* mqtt.js reintenta solo; el estado ya pasa a 'reconnecting' */
    })
    client.on('message', (topic, payload) => {
      const m = /^simon\/([^/]+)\/(state|telemetry|status)$/.exec(topic)
      if (!m || m[1] !== deviceRef.current) return
      const text = payload.toString()
      if (m[2] === 'status') {
        let t = text.trim().toLowerCase()
        if (t.startsWith('{')) {
          try {
            const j = JSON.parse(t) as { status?: unknown; online?: unknown }
            t = String(j.status ?? (j.online === true ? 'online' : j.online === false ? 'offline' : '')).toLowerCase()
          } catch {
            t = ''
          }
        }
        if (t === 'online' || t === 'offline') setStatus(t)
        return
      }
      try {
        const data = JSON.parse(text)
        if (m[2] === 'state') {
          if (isState(data)) applyState(data)
        } else if (data && typeof data === 'object') {
          setTelemetry({ ...(data as Telemetry), _rx: performance.now() })
        }
      } catch {
        /* mensaje corrupto: se ignora */
      }
    })
    return () => {
      client.removeAllListeners()
      client.end(true)
      clientRef.current = null
    }
  }, [applyState])

  // Suscripción al dispositivo actual (se repite al reconectar porque clean: true)
  useEffect(() => {
    setState(null)
    setTelemetry(null)
    setStatus(null)
    setStateRx(0)
    setRestError(null)
    const client = clientRef.current
    if (!deviceId || !client) return
    const topics = [`simon/${deviceId}/state`, `simon/${deviceId}/telemetry`, `simon/${deviceId}/status`]
    const sub = () => client.subscribe(topics, { qos: 0 }, () => {})
    if (client.connected) sub()
    client.on('connect', sub)
    return () => {
      client.off('connect', sub)
      if (client.connected) client.unsubscribe(topics, () => {})
    }
  }, [deviceId])

  // Carga REST inicial y respaldo mientras no haya MQTT
  useEffect(() => {
    if (!deviceId) return
    const ctrl = new AbortController()
    let first = true
    const load = async () => {
      if (first) setLoading(true)
      try {
        const s = await getState(deviceId, ctrl.signal)
        applyState(s)
        setRestError(null)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setRestError((e as Error).message)
      } finally {
        if (first) setLoading(false)
        first = false
      }
    }
    void load()
    if (mqttStatus === 'connected') return () => ctrl.abort()
    const id = window.setInterval(load, 5000)
    return () => {
      ctrl.abort()
      window.clearInterval(id)
    }
  }, [deviceId, mqttStatus, applyState])

  return { mqtt: mqttStatus, state, telemetry, status, stateRx, restError, loading }
}
