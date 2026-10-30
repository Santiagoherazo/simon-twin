// Configuración leída de variables Vite, con valores por defecto de desarrollo.
const env = import.meta.env

export const API_URL: string = (env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')
export const MQTT_URL: string = env.VITE_MQTT_URL || 'ws://127.0.0.1:9001'
export const MQTT_USER: string = env.VITE_MQTT_USER || 'viewer'
export const MQTT_PASS: string = env.VITE_MQTT_PASS || 'pwv'
export const DEFAULT_DEVICE: string = env.VITE_DEFAULT_DEVICE || 'sim-01'

const isLocalUrl = (u: string) => /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(u)
const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
const hostIsLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname)
/** True si esta compilación apunta a 127.0.0.1 pero corre en un celular/servidor: nunca podrá ver los datos. */
export const MISCONFIGURED: string | null =
  (isNative || !hostIsLocal) && (isLocalUrl(API_URL) || isLocalUrl(MQTT_URL))
    ? `Esta versión apunta a ${isLocalUrl(API_URL) ? API_URL : MQTT_URL} (tu propio dispositivo). Compila con VITE_API_URL y VITE_MQTT_URL de tu servidor.`
    : null
