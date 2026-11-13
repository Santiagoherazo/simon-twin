import { useEffect, useMemo, useState } from 'react'
import { actuate } from '../api'
import { dur, isLatch, kindOf, OPTIONS, VERB } from '../actuators'
import type { ActuatorState } from '../types'

const KEY = 'simon.apikey'
const read = () => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** Control manual: bomba, luz externa y servo. POST con la API key (solo vive en esta pestaña) o directo al ESP32 sin nube. */
export function PumpControl({ deviceId, online, actuators }: { deviceId: string; online: boolean; actuators?: ActuatorState[] }) {
  const list = useMemo<ActuatorState[]>(
    () => (actuators?.length ? actuators : [{ key: 'pump', label: 'Mini bomba', on: null, max_seconds: 120 }]),
    [actuators],
  )
  const [sel, setSel] = useState(list.find((a) => a.key === 'pump')?.key ?? list[0].key)
  const act = list.find((a) => a.key === sel) ?? list[0]
  const kind = kindOf(act)
  // Solo duraciones que no pasen el tope de seguridad del actuador
  const options = OPTIONS[kind].filter((s) => s <= act.max_seconds)
  const [apiKey, setApiKey] = useState(read)
  const [seconds, setSeconds] = useState(options[1] ?? options[0] ?? 10)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setSeconds((cur) => (options.includes(cur) ? cur : options[Math.min(1, options.length - 1)] ?? 10))
    setMsg(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  const send = () => run(seconds, `Orden enviada: ${act.label.toLowerCase()} ${dur(seconds)}.`)
  const run = async (secs: number, okText: string) => {
    setBusy(true)
    setMsg(null)
    try {
      try {
        sessionStorage.setItem(KEY, apiKey)
      } catch {
        /* sin almacenamiento: la clave queda solo en memoria */
      }
      await actuate(deviceId, act.key, secs, apiKey)
      setMsg({ ok: true, text: okText })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" id="card-tank" aria-labelledby="pump-h">
      <h2 id="pump-h">Control manual</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="row">
          {list.length > 1 && (
            <label>
              Actuador
              <select value={act.key} onChange={(e) => setSel(e.target.value)}>
                {list.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            API key
            <input type="password" value={apiKey} autoComplete="off" onChange={(e) => setApiKey(e.target.value)} />
          </label>
          {!isLatch(kind) && (
            <label>
              Duración
              <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {options.map((s) => (
                  <option key={s} value={s}>
                    {dur(s)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {isLatch(kind) ? (
          <div className="row">
            <button className="btn water" type="button" disabled={busy || !apiKey || !online} onClick={() => void run(1, `${act.label}: abriendo.`)}>
              Abrir
            </button>
            <button className="btn" type="button" disabled={busy || !apiKey || !online} onClick={() => void run(0, `${act.label}: cerrando.`)}>
              Cerrar
            </button>
          </div>
        ) : (
          <button className="btn water" type="submit" disabled={busy || !apiKey || !online || !options.length}>
            {busy ? 'Enviando…' : `${VERB[kind]} ${dur(seconds)}`}
          </button>
        )}
        {!online && <p className="msg muted">El dispositivo está offline: no se puede enviar la orden.</p>}
        <p className={'msg ' + (msg?.ok ? 'ok' : 'err')} role="status" aria-live="polite">
          {msg?.text}
        </p>
      </form>
    </section>
  )
}
