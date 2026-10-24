import { useState } from 'react'
import { pump } from '../api'

const KEY = 'simon.apikey'
const read = () => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** Riego manual: POST /devices/{id}/pump con la API key (se guarda solo en esta pestaña). */
export function PumpControl({ deviceId, online }: { deviceId: string; online: boolean }) {
  const [apiKey, setApiKey] = useState(read)
  const [seconds, setSeconds] = useState(10)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const send = async () => {
    setBusy(true)
    setMsg(null)
    try {
      try {
        sessionStorage.setItem(KEY, apiKey)
      } catch {
        /* sin almacenamiento: la clave queda solo en memoria */
      }
      await pump(deviceId, seconds, apiKey)
      setMsg({ ok: true, text: `Orden enviada: la bomba regará ${seconds} s.` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" id="card-tank" aria-labelledby="pump-h">
      <h2 id="pump-h">Riego manual</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="row">
          <label>
            API key
            <input type="password" value={apiKey} autoComplete="off" onChange={(e) => setApiKey(e.target.value)} />
          </label>
          <label>
            Duración
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              {[5, 10, 20, 30, 60].map((s) => (
                <option key={s} value={s}>
                  {s} s
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn water" type="submit" disabled={busy || !apiKey || !online}>
          {busy ? 'Enviando…' : `Regar ${seconds} s`}
        </button>
        {!online && <p className="msg muted">El dispositivo está offline: no se puede regar.</p>}
        <p className={'msg ' + (msg?.ok ? 'ok' : 'err')} role="status" aria-live="polite">
          {msg?.text}
        </p>
      </form>
    </section>
  )
}
