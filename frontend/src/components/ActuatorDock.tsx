import { useEffect, useRef, useState } from 'react'
import { actuate } from '../api'
import { dur, isLatch, kindOf, optionsFor, stateWord, VERB, type ActKind } from '../actuators'
import type { ActuatorState } from '../types'
import { useActuatorPick } from '../xr'

const KEY = 'simon.apikey'
const readKey = () => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

const ICON: Record<ActKind, string> = {
  pump: 'M12 3c3.2 4.2 6 6.9 6 10.2A6 6 0 016 13.2C6 9.9 8.8 7.2 12 3z',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0012 3z',
  servo: 'M4 9h12v8H4zM16 12h4M8 9V6h4v3',
}

interface Props {
  deviceId: string | null
  online: boolean
  actuators?: ActuatorState[]
  /** float: botonera flotante sobre la animación (escritorio). inline: dentro del panel inferior del celular. */
  variant?: 'float' | 'inline'
  /** Claves que no se muestran (p. ej. la bomba, que el celular ya riega con su botón principal). */
  exclude?: string[]
}

/**
 * Control de los actuadores directamente sobre la animación: un botón por actuador (mini bomba, luz externa, servo).
 * Tocar uno abre sus duraciones; si está encendido ofrece apagarlo ya. Tocar su modelo 3D hace lo mismo.
 */
export function ActuatorDock({ deviceId, online, actuators, variant = 'float', exclude = [] }: Props) {
  const list = (actuators ?? []).filter((a) => !exclude.includes(a.key))
  const [open, setOpen] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState(readKey)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Orden recién enviada: se muestra ya, sin esperar a la siguiente lectura del equipo (que llega cada ~10 s)
  const [override, setOverride] = useState<Record<string, { on: boolean; until: number }>>({})
  const [now, setNow] = useState(() => Date.now())
  const pick = useActuatorPick()
  const lastPick = useRef(0)

  // Clic en el modelo 3D de un actuador → abre su control
  useEffect(() => {
    if (!pick || pick.n === lastPick.current) return
    lastPick.current = pick.n
    if (list.some((a) => a.key === pick.key)) {
      setOpen(pick.key)
      setMsg(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick])

  useEffect(() => {
    if (!open) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [open])

  // Mientras haya una orden reciente, se muestra como activo sin esperar a la siguiente lectura
  useEffect(() => {
    if (!Object.values(override).some((o) => o.until > Date.now())) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [override])

  useEffect(() => {
    if (!msg) return
    const id = window.setTimeout(() => setMsg(null), 5000)
    return () => window.clearTimeout(id)
  }, [msg])

  if (!deviceId || !list.length) return null

  const isOn = (a: ActuatorState) => {
    const o = override[a.key]
    return o && o.until > now ? o.on : !!a.on
  }

  const send = async (a: ActuatorState, seconds: number) => {
    if (!apiKey) return setMsg({ ok: false, text: 'Ingresa la API key para controlar el equipo.' })
    setBusy(true)
    setMsg(null)
    navigator.vibrate?.(25)
    try {
      try {
        sessionStorage.setItem(KEY, apiKey)
      } catch {
        /* solo en memoria */
      }
      await actuate(deviceId, a.key, seconds, apiKey)
      const latch = isLatch(kindOf(a))
      // temporizado: activo mientras dure; postigo/apagado: se muestra el cambio ~15 s hasta que llegue la lectura real
      setOverride((m) => ({ ...m, [a.key]: { on: seconds > 0, until: Date.now() + (latch || seconds === 0 ? 15000 : seconds * 1000) } }))
      setNow(Date.now())
      setMsg({ ok: true, text: latch ? `${a.label}: ${seconds > 0 ? 'abriendo' : 'cerrando'}` : seconds > 0 ? `${a.label}: ${dur(seconds)} enviado` : `${a.label}: apagando` })
      setOpen(null)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={'act-dock ' + variant} role="group" aria-label="Control de actuadores">
      <div className="act-row">
        {list.map((a) => {
          const kind = kindOf(a)
          const on = isOn(a)
          const sel = open === a.key
          return (
            <div className="act-item" key={a.key}>
              <button
                type="button"
                className={'act-chip' + (on ? ' on' : '') + (sel ? ' sel' : '')}
                onClick={() => {
                  setOpen(sel ? null : a.key)
                  setMsg(null)
                }}
                aria-expanded={sel}
                aria-label={`${a.label}: ${stateWord(kind, on)}. Abrir control`}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={ICON[kind]} />
                </svg>
                <span>{a.label}</span>
                {isLatch(kind) && <em className="act-state">{stateWord(kind, on)}</em>}
                <i className="act-dot" aria-hidden="true" />
              </button>
              {sel && (
                <>
                  {variant === 'float' && <button type="button" className="act-backdrop" aria-label="Cerrar el control" onClick={() => setOpen(null)} />}
                  <div className="act-pop" role="dialog" aria-label={`Control de ${a.label}`}>
                    <b>{a.label}</b>
                    {!online && <small className="act-warn">El dispositivo está sin conexión: no se puede enviar.</small>}
                    {!apiKey && (
                      <label className="act-key">
                        API key
                        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="La del servidor" />
                      </label>
                    )}
                    {isLatch(kind) ? (
                      <div className="act-opts two">
                        <button type="button" onClick={() => void send(a, 1)} disabled={busy || !online || !apiKey || on}>Abrir</button>
                        <button type="button" onClick={() => void send(a, 0)} disabled={busy || !online || !apiKey || !on}>Cerrar</button>
                      </div>
                    ) : (
                      <>
                        {on && (
                          <button type="button" className="act-stop" onClick={() => void send(a, 0)} disabled={busy || !online || !apiKey}>
                            Apagar ahora
                          </button>
                        )}
                        <div className="act-opts">
                          {optionsFor(a, true).map((s) => (
                            <button key={s} type="button" onClick={() => void send(a, s)} disabled={busy || !online || !apiKey}>
                              {VERB[kind]} {dur(s)}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {kind === 'light' && <small>Se apaga sola al terminar el tiempo.</small>}
                    {isLatch(kind) && <small>Se queda en esa posición hasta que lo cambies.</small>}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      {msg && (
        <p className={'act-msg ' + (msg.ok ? 'ok' : 'err')} role="status" aria-live="polite">
          {msg.text}
        </p>
      )}
    </div>
  )
}

