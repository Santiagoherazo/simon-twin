import { fmtAge } from '../format'
import type { LiveData } from '../live'
import { QUALITY_LABEL, QUALITY_ORDER, type Quality } from '../scene/quality'
import type { DeviceInfo } from '../types'

export type Mode = 'live' | 'sim'

interface Props {
  devices: DeviceInfo[]
  deviceId: string | null
  onDevice: (id: string) => void
  mode: Mode
  onMode: (m: Mode) => void
  live: LiveData
  ageS: number | null
  quality: Quality
  onQuality: (q: Quality) => void
}

export function Header({ devices, deviceId, onDevice, mode, onMode, live, ageS, quality, onQuality }: Props) {
  const online = live.state?.online ?? (live.status ? live.status === 'online' : null)
  const mq = live.mqtt
  return (
    <header className="bar">
      <div className="brand">
        <h1>Simón</h1>
        <span>gemelo digital del cultivo</span>
      </div>
      <div className="chips">
        <label className="sr" htmlFor="dev">
          Dispositivo
        </label>
        <select id="dev" className="select" value={deviceId ?? ''} onChange={(e) => onDevice(e.target.value)} disabled={!devices.length}>
          {!devices.length && <option value="">Sin dispositivos</option>}
          {devices.map((d) => (
            <option key={d.device_id} value={d.device_id}>
              {d.name ? `${d.name} (${d.device_id})` : d.device_id}
            </option>
          ))}
        </select>
        <span className="chip" role="status">
          <span className={'dot ' + (mq === 'connected' ? 'ok' : 'warn')} />
          <span className="t">{mq === 'connected' ? 'MQTT en vivo' : mq === 'connecting' ? 'Conectando…' : 'Sin MQTT, usando REST'}</span>
        </span>
        {mode === 'live' && (
          <span className="chip">
            <span className={'dot ' + (online ? 'ok' : online === false ? 'bad' : '')} />
            <span className="t">
              {online ? 'En línea' : online === false ? 'Sin conexión' : 'Sin dato'}
              {ageS != null && ` · hace ${fmtAge(ageS)}`}
            </span>
          </span>
        )}
      </div>
      <button
        type="button"
        className="qbtn"
        title="Calidad gráfica"
        onClick={() => onQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(quality) + 1) % QUALITY_ORDER.length])}
      >
        Gráficos: {QUALITY_LABEL[quality]}
      </button>
      <div className="seg" role="group" aria-label="Modo">
        <button type="button" aria-pressed={mode === 'live'} onClick={() => onMode('live')}>
          En vivo
        </button>
        <button type="button" aria-pressed={mode === 'sim'} onClick={() => onMode('sim')}>
          Simulación
        </button>
      </div>
    </header>
  )
}
