import { fmt, fmtHours } from '../format'
import type { LiveData } from '../live'
import type { Suitability, TwinState, VarStatus } from '../types'
import { PumpControl } from './PumpControl'
import { Sparkline } from './Sparkline'
import { useEffect } from 'react'
import { useFocus } from '../xr'

const STATUS_COLOR: Record<VarStatus, string> = {
  ok: 'var(--moss)',
  low: 'var(--warn)',
  high: 'var(--crit)',
  'n/a': 'var(--line)',
}
const STATUS_TEXT: Record<VarStatus, string> = { ok: 'en rango', low: 'bajo', high: 'alto', 'n/a': 'sin dato' }

const clamp = (v: number | null | undefined) => Math.min(100, Math.max(0, v ?? 0))

/** Anillo medidor: arco de color sobre pista suave, número grande al centro. */
function Ring({ value, label, color, suffix = '%' }: { value: number | null | undefined; label: string; color: string; suffix?: string }) {
  const R = 30
  const C = 2 * Math.PI * R
  return (
    <div className="ringbox" role="img" aria-label={`${label}: ${fmt(value, 0, ' ' + suffix)}`}>
      <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden="true">
        <circle cx="38" cy="38" r={R} fill="none" stroke="var(--track)" strokeWidth="8" />
        <circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(clamp(value) / 100) * C} ${C}`}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <b>{value == null ? '—' : Math.round(value)}<small>{suffix}</small></b>
      <span>{label}</span>
    </div>
  )
}

const I = {
  drop: 'M12 3c3.5 4.4 6 7.4 6 10.5A6 6 0 0 1 6 13.5C6 10.4 8.5 7.4 12 3z',
  therm: 'M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  air: 'M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7',
  leaf: 'M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l7-7',
  bolt: 'M13 2L5 13h6l-1 9 8-11h-6l1-9z',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
}

function Tile({ icon, tone, value, label }: { icon: keyof typeof I; tone: string; value: string; label: string }) {
  return (
    <div className="tile">
      <i className={'ico ' + tone} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={I[icon]} />
        </svg>
      </i>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  )
}

function StageTrack({ s }: { s: NonNullable<TwinState['stage']> }) {
  return (
    <div className="stages" role="img" aria-label={`Etapa ${s.index + 1} de ${s.count}: ${s.name}`}>
      {Array.from({ length: s.count }, (_, i) => (
        <i key={i} className={i < s.index ? 'done' : i === s.index ? 'now' : ''}>
          {i === s.index && <u style={{ width: `${Math.min(100, s.progress_pct)}%` }} />}
        </i>
      ))}
    </div>
  )
}

function SuitabilityBlock({ s }: { s: Suitability }) {
  const worst = s.variables.filter((v) => v.status !== 'ok' && v.status !== 'n/a')
  return (
    <section className="card" aria-labelledby="suit-h">
      <h2 id="suit-h">Aptitud para el cultivo</h2>
      <div className="bars">
        {s.variables.map((v) => (
          <div className="bar-row" key={v.id} title={v.optimal ? `Óptimo: ${v.optimal[0]}–${v.optimal[1]} ${v.unit}` : undefined}>
            <span>{v.label}</span>
            <div className="track" role="img" aria-label={`${v.label}: ${STATUS_TEXT[v.status]}`}>
              <i style={{ width: `${Math.round(clamp(v.score))}%`, background: STATUS_COLOR[v.status] }} />
            </div>
            <span className={'pill ' + v.status}>{STATUS_TEXT[v.status]}</span>
          </div>
        ))}
      </div>
      {worst.length > 0 && <p className="muted tip">Lo que más resta: {worst.map((v) => v.label.toLowerCase()).join(', ')}.</p>}
    </section>
  )
}

function Content({ s }: { s: TwinState }) {
  const r = s.readings ?? {}
  const aw = s.soil?.aw_pct
  return (
    <>
      <section className="card plant-card" id="card-plant">
        <div className="plant-head">
          <div>
            <h3>{s.crop?.name ?? 'Cultivo'}</h3>
            <span className="muted">{s.soil_type?.name ?? 'Suelo'}</span>
          </div>
          {s.stage && <span className="stage-chip">{s.stage.name}</span>}
        </div>
        {s.stage && <StageTrack s={s.stage} />}
        {s.stage && (
          <div className="plant-meta">
            <span>
              <b>{s.stage.days_since_sowing ?? '—'}</b> días de siembra
            </span>
            <span>
              <b>{fmt(s.plant?.height_cm, 0)}</b> cm de alto
            </span>
          </div>
        )}
        <div className="rings">
          <Ring value={aw} label="Agua útil" color="var(--water)" />
          <Ring value={s.suitability?.overall} label="Aptitud" color="var(--moss)" />
          <Ring value={s.stage?.progress_pct} label="Etapa" color="var(--sun)" />
        </div>
      </section>

      <section className="card" id="card-soil" aria-labelledby="read-h">
        <h2 id="read-h">Suelo y aire</h2>
        <div className="tiles">
          <Tile icon="drop" tone="water" value={fmt(r.vwc_pct, 1, ' %')} label="Humedad del suelo" />
          <Tile icon="therm" tone="clay" value={fmt(r.soil_t, 1, ' °C')} label="Temp. del suelo" />
          <Tile icon="flask" tone="leaf" value={fmt(r.ph, 1)} label="pH" />
          <Tile icon="bolt" tone="sun" value={fmt(r.ec, 0, ' µS/cm')} label="Conductividad" />
          <Tile icon="therm" tone="rose" value={fmt(r.air_t, 1, ' °C')} label="Temp. del aire" />
          <Tile icon="air" tone="water" value={fmt(r.air_rh, 0, ' %')} label="Humedad del aire" />
          <Tile icon="leaf" tone="leaf" value={fmt(r.vpd_kpa, 2, ' kPa')} label="VPD" />
          <Tile icon="sun" tone="sun" value={r.lux == null ? '—' : `${Math.round(r.lux).toLocaleString('es-CO')} lx`} label="Luz" />
        </div>
        <div className="status-row">
          <span className={'pill ' + (r.tank_ok === false ? 'high' : 'ok')}>Tanque {r.tank_ok == null ? '—' : r.tank_ok ? 'con agua' : 'vacío'}</span>
          <span className={'pill ' + (r.pump_on ? 'water' : 'idle')}>Bomba {r.pump_on == null ? '—' : r.pump_on ? 'regando' : 'apagada'}</span>
        </div>
      </section>

      {s.prediction && (
        <section className="card pred" aria-labelledby="pred-h">
          <h2 id="pred-h">Próximo riego</h2>
          <b className="big">{s.soil?.needs_irrigation ? 'Ya conviene regar' : fmtHours(s.prediction.hours_to_irrigation)}</b>
          <span className="muted">
            Pronóstico de {s.prediction.horizon_h} h
            {s.prediction.et_scale != null ? ` · consumo calibrado ×${fmt(s.prediction.et_scale, 2)}` : ''}
          </span>
        </section>
      )}

      <Sparkline deviceId={s.device_id} />

      {s.suitability && <SuitabilityBlock s={s.suitability} />}

      {!!s.alerts?.length && (
        <section className="card" aria-labelledby="al-h">
          <h2 id="al-h">Alertas</h2>
          <ul className="alerts">
            {s.alerts.map((a) => (
              <li key={a.code} className={a.level}>
                {a.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <PumpControl deviceId={s.device_id} online={s.online} />
    </>
  )
}

export function LivePanel({ deviceId, live }: { deviceId: string | null; live: LiveData }) {
  const s = live.state
  const f = useFocus()
  useEffect(() => {
    if (!f) return
    const el = document.getElementById(`card-${f.id}`)
    if (!el) return
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" })
    el.classList.remove("flash")
    void el.offsetWidth
    el.classList.add("flash")
  }, [f])
  if (!deviceId)
    return (
      <div className="note">
        <b>No hay dispositivos registrados</b>
        Registra uno con <code>POST /devices</code> y vuelve a cargar.
      </div>
    )
  if (!s && live.restError)
    return (
      <div className="note error" role="alert">
        <b>No se pudo cargar el estado</b>
        {live.restError}
      </div>
    )
  if (!s)
    return (
      <div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
        <div className="skeleton" style={{ width: '60%' }} />
        <div className="skeleton" />
        <div className="skeleton" style={{ width: '80%' }} />
      </div>
    )
  if (!s.readings || !s.soil)
    return (
      <div className="note">
        <b>Esperando los primeros datos de {deviceId}</b>
        Envía telemetría con <code>POST /ingest/{deviceId}</code> o publica en <code>simon/{deviceId}/telemetry</code>. La
        escena se actualiza sola en cuanto llegue.
      </div>
    )
  return <Content s={s} />
}
