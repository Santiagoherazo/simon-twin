// Configuración leída de variables Vite, con valores por defecto de desarrollo.
const env = import.meta.env

export const API_URL: string = (env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')
export const MQTT_URL: string = env.VITE_MQTT_URL || 'ws://127.0.0.1:9001'
export const MQTT_USER: string = env.VITE_MQTT_USER || 'viewer'
export const MQTT_PASS: string = env.VITE_MQTT_PASS || 'pwv'
export const DEFAULT_DEVICE: string = env.VITE_DEFAULT_DEVICE || 'sim-01'
