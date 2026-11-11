import type { NbMeta } from '../../api'
import type { DeviceInfo } from '../../types'
import type { Cfg } from './ConfigTabs'
import { Icon, Section } from './ui'

export type SectionId = 'overview' | 'sensors' | 'actuators' | 'indicators' | 'device' | 'models'

interface Props {
  device: DeviceInfo | undefined
  cfg: Cfg | null
  version: number
  warnings: string[]
  notebooks: NbMeta[] | null
  hasKey: boolean
  onGo: (s: SectionId) => void
  onNeedKey: () => void
}

const when = (iso: string | null) => {
  if (!iso) return 'sin datos todavía'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(s)) return 'sin datos todavía'
  if (s < 90) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

export function Overview({ device, cfg, version, warnings, notebooks, hasKey, onGo, onNeedKey }: Props) {
  const sOn = cfg?.sensors.filter((s) => s.enabled).length ?? 0
  const aOn = cfg?.actuators.filter((s) => s.enabled).length ?? 0
  const iOn = cfg?.indicators.filter((s) => s.enabled).length ?? 0
  const liveModels = notebooks?.filter((n) => n.live) ?? []

  const stats: { id: SectionId; label: string; value: string; sub: string; icon: 'sensor' | 'actuator' | 'formula' | 'lab' }[] = [
    { id: 'sensors', label: 'Sensores', value: String(sOn), sub: cfg ? `de ${cfg.sensors.length} configurados` : '—', icon: 'sensor' },
    { id: 'actuators', label: 'Actuadores', value: String(aOn), sub: cfg ? `de ${cfg.actuators.length} configurados` : '—', icon: 'actuator' },
    { id: 'indicators', label: 'Indicadores', value: String(iOn), sub: cfg ? `de ${cfg.indicators.length} configurados` : '—', icon: 'formula' },
    { id: 'models', label: 'Modelos en vivo', value: notebooks ? String(liveModels.length) : '—', sub: notebooks ? `${notebooks.length} cuaderno${notebooks.length === 1 ? '' : 's'}` : hasKey ? 'cargando…' : 'requiere API key', icon: 'lab' },
  ]

  return (
    <Section title="Resumen" sub="Cómo está tu dispositivo y qué tienes configurado, de un vistazo.">
      <div className="ov-grid">
        <article className="ov-device">
          <div className="ov-device-h">
            <span className={'dot ' + (device ? (device.online ? 'ok' : 'bad') : '')} />
            <div>
              <h3>{device?.name || device?.device_id || 'Sin dispositivo'}</h3>
              <p className="muted">{device ? (device.online ? 'En línea' : 'Sin conexión') + ' · último dato ' + when(device.status_ts) : 'Elige un dispositivo arriba'}</p>
            </div>
          </div>
          {device && (
            <dl className="ov-dl">
              <div><dt>Cultivo</dt><dd>{device.crop || '—'}</dd></div>
              <div><dt>Suelo</dt><dd>{device.soil_type || '—'}</dd></div>
              <div><dt>Maceta</dt><dd>{device.soil_depth_cm} cm · {device.pot_area_cm2} cm²</dd></div>
              <div><dt>Configuración</dt><dd>versión {version || '—'}</dd></div>
              {device.local_ip && <div><dt>Red local</dt><dd>{device.local_ip}</dd></div>}
              <div><dt>ID</dt><dd><code>{device.device_id}</code></dd></div>
            </dl>
          )}
        </article>

        {stats.map((s) => (
          <button key={s.id} type="button" className="ov-stat" onClick={() => onGo(s.id)}>
            <span className="ov-ico"><Icon name={s.icon} /></span>
            <b>{s.value}</b>
            <span>{s.label}</span>
            <small>{s.sub}</small>
          </button>
        ))}
      </div>

      {!!warnings.length && (
        <div className="ov-warn" role="status">
          <h3><Icon name="alert" size={16} /> Revisa el cableado</h3>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <button type="button" className="btn sm" onClick={() => onGo('device')}>Ver cableado</button>
        </div>
      )}

      <div className="ov-cols">
        <article className="ov-card">
          <h3>Modelos activos</h3>
          {!hasKey ? (
            <p className="muted">Ingresa la API key para ver tus cuadernos.</p>
          ) : !notebooks ? (
            <p className="muted">Cargando…</p>
          ) : liveModels.length ? (
            <ul className="ov-list">{liveModels.map((n) => <li key={n.id}><span className="dot ok" /> {n.name}</li>)}</ul>
          ) : (
            <p className="muted">Ningún modelo se está aplicando a los datos en vivo.</p>
          )}
          <button type="button" className="btn sm" onClick={() => (hasKey ? onGo('models') : onNeedKey())}>{hasKey ? 'Abrir laboratorio' : 'Ingresar API key'}</button>
        </article>

        <article className="ov-card">
          <h3>Para empezar</h3>
          <ul className="ov-check">
            <li className={hasKey ? 'done' : ''}><Icon name="check" size={15} /> <button type="button" onClick={onNeedKey}>Ingresar la API key</button></li>
            <li className={sOn > 0 ? 'done' : ''}><Icon name="check" size={15} /> <button type="button" onClick={() => onGo('sensors')}>Activar al menos un sensor</button></li>
            <li className={aOn > 0 ? 'done' : ''}><Icon name="check" size={15} /> <button type="button" onClick={() => onGo('actuators')}>Configurar el riego</button></li>
            <li className={liveModels.length > 0 ? 'done' : ''}><Icon name="check" size={15} /> <button type="button" onClick={() => onGo('models')}>Activar un modelo en vivo</button></li>
          </ul>
        </article>
      </div>
    </Section>
  )
}
