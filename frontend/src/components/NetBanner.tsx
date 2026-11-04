import { useState } from 'react'
import { CAN_FETCH_LOCAL, type FailoverInfo } from '../local'

/** Aviso de conexión: nube caída → datos locales del ESP32 (o redirección a su página). */
export function NetBanner({ net }: { net: FailoverInfo }) {
  const [txt, setTxt] = useState('')
  const [bad, setBad] = useState(false)
  if (net.mode === 'cloud') return null

  if (!net.host) {
    return (
      <div className="net-banner" role="status">
        <b>Sin conexión con la nube.</b> No conozco la dirección del ESP32 (se aprende cuando hay nube).
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setBad(!net.setHost(txt))
          }}
        >
          <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="192.168.1.20 o simon-esp32-01.local" aria-label="Dirección del ESP32" />
          <button type="submit">Usar</button>
        </form>
        {bad && <small>Solo se aceptan direcciones de red local.</small>}
      </div>
    )
  }

  if (!CAN_FETCH_LOCAL) {
    return (
      <div className="net-banner" role="status">
        <b>Sin conexión con la nube.</b>{' '}
        {net.redirectIn != null ? (
          <>
            Abriendo el ESP32 ({net.host}) en {net.redirectIn} s…
            <button onClick={net.cancelRedirect}>Cancelar</button>
          </>
        ) : (
          <a href={`http://${net.host}/#auto`}>Abrir el ESP32 ({net.host})</a>
        )}
        <button onClick={net.retryCloud}>Reintentar nube</button>
      </div>
    )
  }

  return (
    <div className="net-banner" role="status">
      <b>Sin nube · datos locales de {net.host}.</b> {net.localError ?? 'Lecturas en vivo; las predicciones del gemelo quedan congeladas.'}
      <button onClick={net.retryCloud}>Reintentar nube</button>
    </div>
  )
}
