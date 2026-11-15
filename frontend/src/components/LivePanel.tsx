import { fmt, fmtHours } from '../format'
import type { LiveData } from '../live'
import { kindOf, stateWord } from '../actuators'
import { statusPhrase } from '../status'
import type { CustomVar, Suitability, TwinState, VarStatus } from '../types'
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
function Ring({ value, label, color, size = 76, stroke = 8 }: { value: number | null | undefined; label: string; color: string; size?: number; stroke?: number }) {
  const R = (size - stroke) / 2
  const C = 2 * Math.PI * R
  const m = size / 2
  return (
    <div className="ringbox" style={{ width: size }} role="img" aria-label={`${label}: ${fmt(value, 0, ' %')}`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={m} cy={m} r={R} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={m} cy={m} r={R} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(clamp(value) / 100) * C} ${C}`} transform={`rotate(-90 ${m} ${m})`} />
      </svg>
      <b>
        <span className="n">
          {value == null ? '—' : Math.round(value)}
          {value != null && <small>%</small>}
        </span>
      </b>
    </div>
  )
}

type Tone = 'water' | 'sun' | 'earth' | 'leaf' | 'crit'

/** Sección de la ficha: cada subsistema conserva su color (agua azul, luz ámbar, suelo y aire madera). */
function Section({ id, tone, title, aside, children }: { id?: string; tone: Tone; title: string; aside?: string; children: React.ReactNode }) {
  const hid = `${id ?? tone}-h`
  return (
    <section className={'sec tone-' + tone} id={id} aria-labelledby={hid}>
      <h2 id={hid}>
        {title}
        {aside && <span className="aside">{aside}</span>}
      </h2>
      {children}
    </section>
  )
}

/** Lectura: número grande con su unidad, la etiqueta debajo y un punto si está fuera de rango. */
function Read({ v, u, label, flag, wide }: { v: string; u?: string; label: string; flag?: 'low' | 'high' | null; wide?: boolean }) {
  return (
    <div className={'read' + (wide ? ' wide' : '')}>
      <div className="v">
        {v}
        {u && v !== '—' && <span className="u">{u}</span>}
      </div>
      <div className="l">
        {flag && <i className={'flag ' + flag} aria-hidden="true" />}
        {label}
        {flag && <span className="sr">{flag === 'low' ? ' (bajo)' : ' (alto)'}</span>}
      </div>
    </div>
  )
}

/** Estado de los actuadores de un subsistema, con el color de ese subsistema cuando están activos. */
function States({ items }: { items: { key: string; label: string; kind: ReturnType<typeof kindOf>; on: boolean | null | undefined }[] }) {
  if (!items.length) return null
  return (
    <ul className="states">
      {items.map((a) => (
        <li key={a.key} className={a.on ? 'on' : ''}>
          <i className={'dot' + (a.on ? ' on' : '')} aria-hidden="true" />
          {a.label}
          <b>{a.on == null ? '—' : stateWord(a.kind, a.on)}</b>
        </li>
      ))}
    </ul>
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
  const shown = s.variables.filter((v) => v.id !== 'light' && v.score != null)   // lo que no se mide no se lista
  const worst = shown.filter((v) => v.status !== 'ok' && v.status !== 'n/a')
  return (
    <section className="card" aria-labelledby="suit-h">
      <h2 id="suit-h">Aptitud para el cultivo</h2>
      <div className="bars">
        {shown.map((v) => (
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

const CORNER: Record<string, string> = { nw: 'NO', ne: 'NE', sw: 'SO', se: 'SE' }

/** Las 4 LDR vistas desde arriba (norte arriba): cada esquina brilla según la luz que recibe. */
function LdrPlan({ ldrs }: { ldrs: CustomVar[] }) {
  const cells = ['nw', 'ne', 'sw', 'se'].map((c) => ({ c, v: ldrs.find((x) => x.key === `ldr_${c}`) })).filter((x) => x.v)
  if (!cells.length) return null
  return (
    <div className="ldr-plan" role="group" aria-label="Luz por esquina, vista desde arriba">
      {cells.map(({ c, v }) => {
        const val = typeof v!.value === 'number' ? v!.value : null
        return (
          <div className="ldr-c" key={c} style={{ ['--lv' as string]: clamp(val) / 100 }} title={`Luz en la esquina ${CORNER[c]}`}>
            <span>{CORNER[c]}</span>
            <b>
              {val == null ? '—' : Math.round(val)}
              <small>{val == null ? '' : ' %'}</small>
            </b>
          </div>
        )
      })}
    </div>
  )
}

function Content({ s }: { s: TwinState }) {
  const r = s.readings ?? {}
  const aw = s.soil?.aw_pct
  // Solo se muestra lo que el equipo realmente mide: nada de pH/EC/NPK ni lux inventados.
  const custom = s.custom ?? []
  const ldrs = custom.filter((c) => c.key.startsWith('ldr_'))
  const luz = custom.find((c) => c.key === 'luz_media')
  const tank = custom.find((c) => c.key === 'tank_pct')
  const apart = new Set(['luz_media', 'tank_pct', ...ldrs.map((c) => c.key)])
  const rest = custom.filter((c) => !apart.has(c.key))
  const tankPct = typeof tank?.value === 'number' ? Math.round(tank.value) : null
  const flagOf = (st: string | null | undefined) => (st === 'high' ? 'high' : st === 'low' ? 'low' : null)
  const acts = (s.actuators ?? []).map((a) => ({ key: a.key, label: a.label, kind: kindOf(a), on: a.on }))
  // Si el equipo no reporta la bomba como actuador, se usa la lectura suelta pump_on
  const waterActs = acts.filter((a) => a.kind === 'pump')
  if (!waterActs.length && r.pump_on != null) waterActs.push({ key: 'pump', label: 'Mini bomba', kind: 'pump', on: r.pump_on })
  const lightActs = acts.filter((a) => a.kind !== 'pump')
  const showLight = ldrs.length > 0 || typeof luz?.value === 'number' || r.lux != null || lightActs.length > 0
  const phrase = statusPhrase(s)
  const tankRead = tankPct != null ? { v: String(tankPct), u: '%' } : r.tank_ok != null ? { v: r.tank_ok ? 'Con agua' : 'Vacío', u: '' } : null
  return (
    <>
      <section className="sec hero" id="card-plant" aria-labelledby="crop-h">
        <div className="hero-top">
          <div className="hero-id">
            <h2 id="crop-h" className="crop">{s.crop?.name ?? 'Cultivo'}</h2>
            <p className="hero-sub">
              {s.stage?.name ?? 'Etapa sin definir'}
              {s.stage && s.stage.days_since_sowing != null ? `, día ${s.stage.days_since_sowing}` : ''}
            </p>
          </div>
          <Ring value={s.suitability?.overall} label="Aptitud del cultivo" color="var(--leaf)" size={92} stroke={9} />
        </div>
        <p className={'hero-status ' + phrase.tone} role="status">
          <i className="dot" aria-hidden="true" />
          {phrase.text}
        </p>
        {s.stage && <StageTrack s={s.stage} />}
        <p className="hero-meta">
          Aptitud {fmt(s.suitability?.overall, 0)} %, etapa {s.stage ? fmt(s.stage.progress_pct, 0) : '—'} %
          {s.plant?.height_cm != null ? `, ${fmt(s.plant.height_cm, 0)} cm de alto` : ''}. Suelo {s.soil_type?.name?.toLowerCase() ?? 'sin definir'}.
        </p>
      </section>

      {!!s.alerts?.length && (
        <section className="sec tone-crit" aria-labelledby="al-h">
          <h2 id="al-h">
            Alertas
            <span className="aside">{s.alerts.length}</span>
          </h2>
          <ul className="alerts">
            {s.alerts.map((a) => (
              <li key={a.code} className={a.level}>
                <i className="al-dot" aria-hidden="true" />
                <div>
                  {a.title ? (
                    <>
                      <b>{a.title}</b>
                      {a.cause && <span className="al-line">{a.cause}</span>}
                      {a.consequence && <span className="al-line">{a.consequence}</span>}
                      {a.action && <span className="al-line al-act">Qué hacer: {a.action}</span>}
                    </>
                  ) : (
                    a.message
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section id="card-tank" tone="water" title="Agua">
        <div className="reads">
          <Read v={fmt(r.vwc_pct, 1)} u="%" label="Humedad del suelo" />
          {tankRead && <Read v={tankRead.v} u={tankRead.u} label="Nivel del tanque" flag={r.tank_ok === false ? 'low' : null} />}
        </div>
        {aw != null && (
          <div className="meter" role="img" aria-label={`Agua útil: ${fmt(aw, 0, ' %')}`}>
            <span>Agua útil para la raíz</span>
            <b>{fmt(aw, 0)}<small>%</small></b>
            <i aria-hidden="true"><u style={{ width: `${clamp(aw)}%` }} /></i>
          </div>
        )}
        <States items={waterActs} />
        {s.prediction && (
          <p className="line">
            Próximo riego: <b>{s.soil?.needs_irrigation ? 'ya conviene regar' : fmtHours(s.prediction.hours_to_irrigation)}</b>
            {s.prediction.et_scale != null ? `, consumo calibrado ×${fmt(s.prediction.et_scale, 2)}` : ''}.
          </p>
        )}
      </Section>

      {showLight && (
        <Section tone="sun" title="Luz">
          <LdrPlan ldrs={ldrs} />
          <div className="reads">
            {typeof luz?.value === 'number' ? (
              <Read v={fmt(luz.value, 0)} u="%" label="Luz media de las 4 esquinas" wide />
            ) : !ldrs.length && r.lux != null ? (
              <Read v={Math.round(r.lux).toLocaleString('es-CO')} u="lx" label="Luz" wide />
            ) : null}
          </div>
          <States items={lightActs} />
        </Section>
      )}

      <Section id="card-soil" tone="earth" title="Suelo y aire">
        <div className="reads">
          <Read v={fmt(r.soil_t, 1)} u="°C" label="Temp. del suelo" />
          <Read v={fmt(r.air_t, 1)} u="°C" label="Temp. del aire" />
          <Read v={fmt(r.air_rh, 0)} u="%" label="Humedad del aire" />
          <Read v={fmt(r.vpd_kpa, 2)} u="kPa" label="Déficit de vapor (VPD)" />
          {r.ph != null && <Read v={fmt(r.ph, 1)} label="pH" />}
          {r.ec != null && <Read v={fmt(r.ec, 0)} u="µS/cm" label="Conductividad" />}
          {rest.map((c) => (
            <Read
              key={c.key}
              v={c.value == null ? '—' : typeof c.value === 'boolean' ? (c.value ? 'sí' : 'no') : fmt(c.value, Math.abs(c.value) >= 100 ? 0 : 2)}
              u={c.unit}
              label={c.label}
              flag={flagOf(c.status)}
            />
          ))}
        </div>
      </Section>

      {s.health && <HealthBlockCard h={s.health} />}

      <Sparkline deviceId={s.device_id} />

      {s.suitability && <SuitabilityBlock s={s.suitability} />}
    </>
  )
}

function HealthBlockCard({ h }: { h: NonNullable<TwinState['health']> }) {
  const f = Object.entries(h.factors).filter(([, v]) => v < 0.97).sort((a, b) => a[1] - b[1])
  const sm = h.summary
  return (
    <section className="card" aria-labelledby="hl-h">
      <h2 id="hl-h">Salud de la planta</h2>
      <div className="grid">
        <div className="kpi">
          <b>{Math.round(sm.health_pct)} %</b>
          <small>salud general</small>
        </div>
        <div className="kpi">
          <b>{Math.round(sm.root_health_pct)} %</b>
          <small>raíz</small>
        </div>
        <div className="kpi">
          <b>{Math.round(sm.yield_pct)} %</b>
          <small>rendimiento proyectado</small>
        </div>
      </div>
      {f.length > 0 ? (
        <ul className="hl-factors" aria-label="Factores que frenan el crecimiento ahora">
          {f.map(([k, v]) => (
            <li key={k}>
              <span>{h.factor_names[k] ?? k}</span>
              <span className="hl-bar" aria-hidden="true">
                <i style={{ width: `${Math.round((1 - v) * 100)}%` }} />
              </span>
              <b>−{Math.round((1 - v) * 100)} %</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nada frena el crecimiento en este momento.</p>
      )}
      <small className="muted">Calculado repitiendo las últimas {Math.round(h.window_h / 24)} días de lecturas por el modelo de ciclo de cultivo.</small>
    </section>
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
  if (s.local && s.readings && !s.soil) {
    const r = s.readings
    const rows: [string, string][] = [
      ['Humedad', r.vwc_pct != null ? `${r.vwc_pct.toFixed(1)} %` : '–'],
      ['Suelo', r.soil_t != null ? `${r.soil_t.toFixed(1)} °C` : '–'],
      ['Aire', r.air_t != null ? `${r.air_t.toFixed(1)} °C, ${r.air_rh ?? '–'} %` : '–'],
      ['Bomba', r.pump_on ? 'encendida' : 'apagada'],
    ]
    return (
      <div className="note">
        <b>Datos locales del ESP32</b>
        {rows.map(([k, v]) => (
          <div key={k}>
            {k}: {v}
          </div>
        ))}
      </div>
    )
  }
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
