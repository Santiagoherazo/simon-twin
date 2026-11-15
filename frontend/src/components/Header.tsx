import { fmtAge } from '../format'
import type { LiveData } from '../live'
import { PREF_ORDER, QUALITY_LABEL, type Quality, type QualityPref } from '../scene/quality'
import { useDevice } from './DeviceDetector'
import type { DeviceInfo } from '../types'
import { Icon } from './admin/ui'

export type Mode = 'live' | 'sim'

interface Props {
  devices: DeviceInfo[]
  deviceId: string | null
  onDevice: (id: string) => void
  mode: Mode
  onMode: (m: Mode) => void
  live: LiveData
  ageS: number | null
  /** Calidad que se está usando ahora. */
  quality: Quality
  /** Lo elegido: «auto» o un nivel fijo. */
  pref: QualityPref
  onQuality: (p: QualityPref) => void
}

export function Header({ devices, deviceId, onDevice, mode, onMode, live, ageS, quality, pref, onQuality }: Props) {
  const device = useDevice()
  const online = live.state?.online ?? (live.status ? live.status === 'online' : null)
  const mq = live.mqtt
  return (
    <header className="bar">
      <a className="brand" href="#/" aria-label="Simón, gemelo digital del cultivo">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 26V13M16 16c-5 0-7-4-7-7 5 0 7 3 7 7zM16 19c5 0 7-3 7-6-5 0-7 2-7 6z" />
          </svg>
        </span>
        <h1>Simón</h1>
      </a>
      <div className="devsel">
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
        {mode === 'live' && (
          <span className="chip" role="status">
            <span className={'dot ' + (online ? 'ok' : online === false ? 'bad' : '')} />
            {online ? 'En línea' : online === false ? 'Sin conexión' : 'Sin dato'}
            {ageS != null && <em>hace {fmtAge(ageS)}</em>}
          </span>
        )}
        <span className="chip" title={mq === 'connected' ? 'Datos por MQTT en tiempo real' : mq === 'connecting' ? 'Conectando con MQTT…' : 'Sin MQTT: los datos llegan por REST'}>
          <span className={'dot ' + (mq === 'connected' ? 'ok' : 'warn')} />
          {mq === 'connected' ? 'Tiempo real' : mq === 'connecting' ? 'Conectando…' : 'Modo REST'}
        </span>
      </div>
      <div className="bar-end">
        <button
          type="button"
          className="qbtn"
          title={`Equipo detectado: ${device.label}. ${pref === 'auto' ? device.reason : 'Calidad fija elegida por ti.'} Clic para cambiar (G)`}
          onClick={() => onQuality(PREF_ORDER[(PREF_ORDER.indexOf(pref) + 1) % PREF_ORDER.length])}
        >
          Gráficos: {pref === 'auto' ? `Auto (${QUALITY_LABEL[quality]})` : QUALITY_LABEL[quality]}
        </button>
        <div className="seg" role="group" aria-label="Modo">
          <button type="button" aria-pressed={mode === 'live'} onClick={() => onMode('live')} title="Datos en vivo (L)">
            En vivo
          </button>
          <button type="button" aria-pressed={mode === 'sim'} onClick={() => onMode('sim')} title="¿Qué pasaría si…? (S)">
            Simulación
          </button>
        </div>
        <a className="gear" href="#/admin" aria-label="Configuración" title="Configuración (,)">
          <Icon name="gear" size={20} />
        </a>
      </div>
    </header>
  )
}
