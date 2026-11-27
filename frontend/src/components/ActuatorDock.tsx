import { useEffect, useRef, useState } from 'react'
import { actuate } from '../api'
import { dur, isLatch, kindOf, optionsFor, stateWord, toSeconds, UNITS, VERB, type ActKind, type UnitId } from '../actuators'
import type { ActuatorState } from '../types'
import { useActuatorPick } from '../xr'
import { useApiKey } from '../apikey'

const ICON: Record<ActKind, string> = {
  pump: 'M12 3c3.2 4.2 6 6.9 6 10.2A6 6 0 016 13.2C6 9.9 8.8 7.2 12 3z',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0012 3z',
  servo: 'M4 5h16M4 5v14M7 7l9 3M7 11l9 3M7 15l9 3',
  strip: 'M3 9h18v6H3zM6 9v6M9 9v6M12 9v6M15 9v6M18 9v6',
}

const SWATCHES = ['#ffffff', '#ffd9a0', '#ff3b30', '#ff9500', '#ffe600', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ff2d92']

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
  const [apiKey] = useApiKey()
  const list = (actuators ?? []).filter((a) => !exclude.includes(a.key))
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Orden recién enviada: se muestra ya, sin esperar a la siguiente lectura del equipo (que llega cada ~10 s)
  const [override, setOverride] = useState<Record<string, { on: boolean; until: number }>>({})
  const [now, setNow] = useState(() => Date.now())
  // tiempo libre: abierto o no, valor escrito y unidad
  const [custom, setCustom] = useState(false)
  const [customVal, setCustomVal] = useState('')
  const [customUnit, setCustomUnit] = useState<UnitId>('min')
  const [customErr, setCustomErr] = useState<string | null>(null)
  const [color, setColor] = useState('#ffffff')
  const [bright, setBright] = useState(60)
  const [servoAngle, setServoAngle] = useState(105)
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

  /** Cambia solo color/brillo de la tira (sin tocar el tiempo); si está apagada, quedan guardados para cuando se encienda. */
  const sendStyle = async (a: ActuatorState, c: string, b: number) => {
    if (!apiKey) { setMsg({ ok: false, text: 'Falta la API key. Abre Configuración y guárdala una vez.' }); return }
    try {
      await actuate(deviceId, a.key, null, apiKey, { color: c, brightness: b })
      setMsg({ ok: true, text: `${a.label}: color enviado` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  /** Servo: manda un ángulo absoluto sin tocar el temporizador (0 = posición de reposo). */
  const sendAngle = async (a: ActuatorState, angle: number) => {
    if (!apiKey) { setMsg({ ok: false, text: 'Falta la API key. Abre Configuración y guárdala una vez.' }); return }
    setBusy(true)
    setMsg(null)
    navigator.vibrate?.(25)
    try {
      await actuate(deviceId, a.key, null, apiKey, { degrees: angle })
      setOverride((m) => ({ ...m, [a.key]: { on: angle > 0, until: Date.now() + 15000 } }))
      setNow(Date.now())
      setMsg({ ok: true, text: `${a.label}: ${angle}° enviado` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const send = async (a: ActuatorState, seconds: number) => {
    if (!apiKey) { setMsg({ ok: false, text: 'Falta la API key. Abre Configuración y guárdala una vez.' }); return }
    setBusy(true)
    setMsg(null)
    navigator.vibrate?.(25)
    try {
      await actuate(deviceId, a.key, seconds, apiKey, kindOf(a) === 'strip' && seconds > 0 ? { color, brightness: bright } : {})
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
                className={'act-key' + (on ? ' on' : '') + (sel ? ' sel' : '')}
                data-kind={kind}
                onClick={() => {
                  setOpen(sel ? null : a.key)
                  setMsg(null)
                  setCustom(false)
                  setCustomVal('')
                  setCustomErr(null)
                  setCustomUnit(kind === 'light' || kind === 'strip' ? 'min' : 's')
                  if (kind === 'strip') {
                    if (a.color) setColor(a.color)
                    if (a.brightness) setBright(a.brightness)
                  }
                }}
                aria-expanded={sel}
                aria-label={`${a.label}: ${stateWord(kind, on)}. Abrir control`}
              >
                <span className="act-ico">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={ICON[kind]} />
                  </svg>
                </span>
                <span className="act-name">{a.label}</span>
                <span className="act-st">{stateWord(kind, on)}</span>
              </button>
              {sel && (
                <>
                  {variant === 'float' && <button type="button" className="act-backdrop" aria-label="Cerrar el control" onClick={() => setOpen(null)} />}
                  <div className="act-pop" role="dialog" aria-label={`Control de ${a.label}`}>
                    <b>{a.label}</b>
                    {!online && <small className="act-warn">El dispositivo está sin conexión: no se puede enviar.</small>}
                    {kind === 'strip' && (
                      <div className="act-color">
                        <small className="act-cap">Color</small>
                        <div className="act-swatches">
                          {SWATCHES.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={'act-sw' + (c === color ? ' sel' : '')}
                              style={{ background: c }}
                              aria-label={`Color ${c}`}
                              disabled={!online}
                              onClick={() => {
                                setColor(c)
                                void sendStyle(a, c, bright)
                              }}
                            />
                          ))}
                          <label className="act-sw custom" title="Otro color">
                            <input
                              type="color"
                              value={color}
                              aria-label="Elegir otro color"
                              disabled={!online}
                              onChange={(e) => setColor(e.target.value)}
                              onBlur={(e) => void sendStyle(a, e.target.value, bright)}
                            />
                          </label>
                        </div>
                        <label className="act-bright">
                          <small className="act-cap">Brillo {bright} %</small>
                          <input
                            type="range"
                            min={5}
                            max={100}
                            step={5}
                            value={bright}
                            disabled={!online}
                            onChange={(e) => setBright(Number(e.target.value))}
                            onPointerUp={() => void sendStyle(a, color, bright)}
                            onKeyUp={() => void sendStyle(a, color, bright)}
                          />
                        </label>
                      </div>
                    )}
                    {isLatch(kind) ? (
                      <>
                        <div className="act-opts two">
                          <button type="button" onClick={() => void send(a, 1)} disabled={busy || !online || on}>Abrir</button>
                          <button type="button" onClick={() => void send(a, 0)} disabled={busy || !online || !on}>Cerrar</button>
                        </div>
                        <label className="act-bright">
                          <small className="act-cap">Ángulo {servoAngle}°</small>
                          <input
                            type="number"
                            min={0}
                            max={180}
                            step={5}
                            value={servoAngle}
                            disabled={!online}
                            onChange={(e) => setServoAngle(Math.min(180, Math.max(0, Number(e.target.value) || 0)))}
                            aria-label="Ángulo del servo en grados"
                          />
                        </label>
                        <button type="button" onClick={() => void sendAngle(a, servoAngle)} disabled={busy || !online}>
                          Aplicar ángulo
                        </button>
                      </>
                    ) : (
                      <>
                        {on && (
                          <button type="button" className="act-stop" onClick={() => void send(a, 0)} disabled={busy || !online}>
                            Apagar ahora
                          </button>
                        )}
                        <small className="act-cap">{VERB[kind]} durante</small>
                        <div className="act-opts">
                          {optionsFor(a, true).map((s) => (
                            <button key={s} type="button" onClick={() => void send(a, s)} disabled={busy || !online}>
                              {dur(s)}
                            </button>
                          ))}
                        </div>
                        <button type="button" className={'act-other' + (custom ? ' on' : '')} aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
                          Otro
                        </button>
                        {custom && (
                          <form
                            className="act-custom"
                            onSubmit={(e) => {
                              e.preventDefault()
                              const secs = toSeconds(customVal, customUnit)
                              if (secs == null) return setCustomErr('Escribe un tiempo mayor que cero.')
                              if (secs > a.max_seconds) return setCustomErr(`El tope de seguridad de este actuador es ${dur(a.max_seconds)}. Se cambia en Configuración.`)
                              setCustomErr(null)
                              void send(a, secs)
                            }}
                          >
                            <div className="act-custom-row">
                              <input
                                type="text"
                                inputMode="decimal"
                                autoFocus
                                autoComplete="off"
                                placeholder="Ej.: 2,5"
                                aria-label="Duración"
                                value={customVal}
                                onChange={(e) => {
                                  setCustomVal(e.target.value)
                                  setCustomErr(null)
                                }}
                              />
                              <select aria-label="Unidad" value={customUnit} onChange={(e) => setCustomUnit(e.target.value as UnitId)}>
                                {UNITS.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button type="submit" className="act-go" disabled={busy || !online}>
                              {VERB[kind]} {customVal.trim() && toSeconds(customVal, customUnit) ? dur(toSeconds(customVal, customUnit)!) : 'ahora'}
                            </button>
                            <small className={customErr ? 'act-warn' : ''} role={customErr ? 'alert' : undefined}>
                              {customErr ?? `Hasta ${dur(a.max_seconds)}.`}
                            </small>
                          </form>
                        )}
                      </>
                    )}
                    {(kind === 'light' || kind === 'strip') && <small>Se apaga sola al terminar el tiempo.</small>}
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

