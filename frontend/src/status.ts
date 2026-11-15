import { fmtHours } from './format'
import type { TwinState } from './types'

/** Frase en lenguaje llano con lo que más importa del cultivo. */
export function statusPhrase(s: TwinState | null): { text: string; tone: 'ok' | 'warn' | 'bad' | 'idle' } {
  if (!s) return { text: 'Conectando con tu jardín…', tone: 'idle' }
  if (!s.online) return { text: 'Tu dispositivo está sin conexión', tone: 'bad' }
  if (s.local && s.readings) {
    const r = s.readings
    const bits = [r.vwc_pct != null && `humedad ${Math.round(r.vwc_pct)} %`, r.soil_t != null && `suelo ${r.soil_t.toFixed(1)} °C`, r.air_t != null && `aire ${r.air_t.toFixed(1)} °C`].filter(Boolean)
    return { text: `Datos locales: ${bits.join(', ')}`, tone: 'idle' }
  }
  if (!s.readings || !s.soil) return { text: 'Esperando los primeros datos', tone: 'idle' }
  const crop = (s.crop?.name ?? 'cultivo').toLowerCase()
  const crit = s.alerts?.find((a) => a.level === 'critical')
  if (crit) return { text: crit.message, tone: 'bad' }
  if (s.soil.needs_irrigation) return { text: `Tu ${crop} tiene sed, riégalo ya`, tone: 'warn' }
  const h = s.prediction?.hours_to_irrigation
  const warn = s.alerts?.find((a) => a.level === 'warn')
  if (warn) return { text: warn.message, tone: 'warn' }
  return { text: h != null ? `Tu ${crop} está bien, riego en ${fmtHours(h)}` : `Tu ${crop} está bien`, tone: 'ok' }
}
