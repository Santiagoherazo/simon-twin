import { useEffect, useState } from 'react'
import { fmt, fmtHours } from '../format'
import type { LiveData } from '../live'
import type { Mode } from './Header'
import { LivePanel } from './LivePanel'
import { SimPanel, type SimPanelProps } from './SimPanel'
import type { SimRequest, TwinState } from '../types'
import { pump } from '../api'
import { gyro, useXr, xrRequest, setXr, detectAr } from '../xr'

/** Frase en lenguaje llano con lo que más importa del cultivo. */
export function statusPhrase(s: TwinState | null): { text: string; tone: 'ok' | 'warn' | 'bad' | 'idle' } {
  if (!s) return { text: 'Conectando con tu jardín…', tone: 'idle' }
  if (!s.online) return { text: 'Tu dispositivo está sin conexión', tone: 'bad' }
  if (!s.readings || !s.soil) return { text: 'Esperando los primeros datos', tone: 'idle' }
  const crop = (s.crop?.name ?? 'cultivo').toLowerCase()
  const crit = s.alerts?.find((a) => a.level === 'critical')
  if (crit) return { text: crit.message, tone: 'bad' }
  if (s.soil.needs_irrigation) return { text: `Tu ${crop} tiene sed · riégalo ya`, tone: 'warn' }
  const h = s.prediction?.hours_to_irrigation
  const warn = s.alerts?.find((a) => a.level === 'warn')
  if (warn) return { text: warn.message, tone: 'warn' }
  return { text: h != null ? `Tu ${crop} está bien · riego en ${fmtHours(h)}` : `Tu ${crop} está bien`, tone: 'ok' }
}

const PRESETS: { id: string; label: string; req: SimRequest }[] = [
  {
    id: 'rain',
    label: '¿Y si llueve?',
    req: { hours: 72, step_minutes: 30, weather: { mode: 'persist', temp_offset_c: -2, rh_offset: 0, lux_scale: 0.6 }, events: [{ at_hour: 6, type: 'rain', mm: 20 }], auto_irrigation: { enabled: false, mm: 10 }, overrides: {} },
  },
  {
    id: 'heat',
    label: '¿Y si hace calor?',
    req: { hours: 72, step_minutes: 30, weather: { mode: 'persist', temp_offset_c: 6, rh_offset: 0, lux_scale: 1.1 }, events: [], auto_irrigation: { enabled: false, mm: 10 }, overrides: {} },
  },
  {
    id: 'dry',
    label: '¿Y si no riego?',
    req: { hours: 96, step_minutes: 60, weather: { mode: 'persist', temp_offset_c: 0, rh_offset: 0, lux_scale: 1 }, events: [], auto_irrigation: { enabled: false, mm: 10 }, overrides: {} },
  },
]

interface Props {
  live: LiveData
  mode: Mode
  onMode: (m: Mode) => void
  deviceId: string | null
  sim: SimPanelProps
}

const KEY = 'simon.apikey'
const readKey = () => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

type Orient = DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

export function MobileShell({ live, mode, onMode, deviceId, sim }: Props) {
  const xr = useXr()
  const s = live.state
  const phrase = statusPhrase(s)
  const [open, setOpen] = useState(false)
  const [clean, setClean] = useState(false)
  const [tilt, setTilt] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(readKey)
  const [askKey, setAskKey] = useState(false)

  useEffect(() => {
    void detectAr()
  }, [])

  // giroscopio: inclina suavemente el gemelo
  useEffect(() => {
    if (!tilt) {
      gyro.on = false
      return
    }
    const f = (e: DeviceOrientationEvent) => {
      gyro.y = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 30))
      gyro.x = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30))
    }
    gyro.on = true
    window.addEventListener('deviceorientation', f)
    return () => {
      gyro.on = false
      window.removeEventListener('deviceorientation', f)
    }
  }, [tilt])

  const toggleTilt = async () => {
    if (tilt) return setTilt(false)
    const O = DeviceOrientationEvent as unknown as Orient & { requestPermission?: () => Promise<string> }
    try {
      if (typeof O.requestPermission === 'function') {
        if ((await O.requestPermission()) !== 'granted') return
      }
      setTilt(true)
    } catch {
      setMsg('No se pudo activar el giroscopio.')
    }
  }

  const water = async () => {
    if (!deviceId) return
    if (!key) return setAskKey(true)
    setBusy(true)
    setMsg(null)
    navigator.vibrate?.(30)
    try {
      await pump(deviceId, 10, key)
      navigator.vibrate?.([20, 40, 20])
      setMsg('Regando 10 segundos')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const preset = (p: (typeof PRESETS)[number]) => {
    onMode('sim')
    sim.onRun(p.req)
    setOpen(true)
  }

  // ---------- modo AR: solo controles mínimos ----------
  if (xr.active)
    return (
      <div
        className="m-ar"
        onPointerDown={(e) => e.stopPropagation()}
        ref={(el) => el?.addEventListener('beforexrselect', (e) => e.preventDefault())}
      >
        <div className="m-glass m-ar-top">
          <span className={'dot ' + (phrase.tone === 'ok' ? 'ok' : phrase.tone === 'bad' ? 'bad' : 'warn')} />
          <b>{xr.placed ? phrase.text : 'Apunta al suelo o a una mesa y toca para colocarlo'}</b>
        </div>
        <div className="m-ar-bar">
          <button type="button" className="m-pill" onClick={() => setXr({ scale: Math.max(0.02, xr.scale * 0.8) })}>
            −
          </button>
          <button type="button" className="m-pill" onClick={() => setXr({ scale: Math.min(0.3, xr.scale * 1.25) })}>
            +
          </button>
          <button type="button" className="m-pill" onClick={() => xrRequest('replace')}>
            Reubicar
          </button>
          <button type="button" className="m-pill danger" onClick={() => xrRequest('stop')}>
            Salir
          </button>
        </div>
      </div>
    )

  const r = s?.readings
  const aw = s?.soil?.aw_pct
  return (
    <>
      <div className="m-top">
        <div className="m-glass m-id">
          <span className={'dot ' + (s?.online ? 'ok' : s ? 'bad' : '')} />
          <b>{deviceId ?? 'Sin dispositivo'}</b>
        </div>
        <button type="button" className="m-glass m-icon" aria-pressed={clean} onClick={() => setClean((c) => !c)} aria-label="Vista limpia">
          {clean ? 'Mostrar' : 'Ocultar'}
        </button>
      </div>

      {!clean && (
        <div className={'m-sheet' + (open ? ' open' : '')} role="region" aria-label="Tu jardín">
          <button type="button" className="m-grab" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Cerrar detalle' : 'Abrir detalle'}>
            <i />
          </button>

          <div className={'m-status ' + phrase.tone}>
            <div className="m-ring" aria-hidden="true" style={{ ['--p' as string]: `${Math.min(100, Math.max(0, aw ?? 0))}` }}>
              <span>{aw == null ? '—' : Math.round(aw)}</span>
            </div>
            <div>
              <b>{phrase.text}</b>
              <small className="muted">
                {s?.stage ? `${s.stage.name} · ` : ''}
                {r ? `${fmt(r.air_t, 0, ' °C')} · ${fmt(r.air_rh, 0, ' %')} humedad` : 'agua útil del suelo'}
              </small>
            </div>
          </div>

          <div className="m-actions">
            <button type="button" className="m-water" onClick={water} disabled={busy || !s?.online}>
              {busy ? 'Enviando…' : 'Regar 10 s'}
            </button>
            {xr.support === 'yes' ? (
              <button type="button" className="m-ar-btn" onClick={() => xrRequest('start')}>
                Ver en AR
              </button>
            ) : (
              <button type="button" className="m-ar-btn off" onClick={() => setMsg(xr.why || 'Comprobando AR…')}>
                AR no disponible
              </button>
            )}
          </div>
          {askKey && (
            <form
              className="m-key"
              onSubmit={(e) => {
                e.preventDefault()
                try {
                  sessionStorage.setItem(KEY, key)
                } catch {
                  /* solo en memoria */
                }
                setAskKey(false)
                void water()
              }}
            >
              <input type="password" placeholder="API key de riego" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <button type="submit" className="btn" disabled={!key}>
                Guardar y regar
              </button>
            </form>
          )}
          {msg && (
            <p className="m-msg" role="status" aria-live="polite">
              {msg}
            </p>
          )}

          <div className="m-presets" role="group" aria-label="Escenarios rápidos">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className="m-chip" onClick={() => preset(p)} disabled={sim.busy}>
                {p.label}
              </button>
            ))}
            <button type="button" className="m-chip" aria-pressed={tilt} onClick={toggleTilt}>
              Mover con el celular
            </button>
          </div>

          {open && (
            <div className="m-detail">
              <div className="seg" role="group" aria-label="Modo">
                <button type="button" aria-pressed={mode === 'live'} onClick={() => onMode('live')}>
                  En vivo
                </button>
                <button type="button" aria-pressed={mode === 'sim'} onClick={() => onMode('sim')}>
                  Simulación
                </button>
              </div>
              {mode === 'live' ? <LivePanel deviceId={deviceId} live={live} /> : <div className="card sim-card"><SimPanel {...sim} /></div>}
            </div>
          )}
        </div>
      )}
    </>
  )
}
