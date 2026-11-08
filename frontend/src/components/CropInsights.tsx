import { useState } from 'react'
import type { FitResponse, CropEvent, OptimizeResponse, RecommendResponse, SimResponse } from '../types'

export const FACTOR_LABEL: Record<string, string> = {
  water: 'Falta de agua',
  hypoxia: 'Exceso de agua',
  temp: 'Temperatura',
  light: 'Luz',
  vpd: 'Aire seco/húmedo',
  nutrient: 'Nutrientes',
  ph: 'pH',
  salinity: 'Salinidad',
  disease: 'Enfermedades',
  pest: 'Plagas',
}
const LOSS_LABEL: Record<string, string> = {
  floracion: 'Floración (calor, frío o sequía)',
  calcio_fruto: 'Pudrición apical (calcio)',
  espigado: 'Espigado',
  quemadura_puntas: 'Quemadura de puntas',
}
const LEVEL_LABEL = { critical: 'Crítico', warn: 'Aviso', info: 'Info' } as const

const days = (h: number) => (h < 48 ? `${Math.round(h)} h` : `día ${(h / 24).toFixed(h < 240 ? 1 : 0)}`)

/** Línea de tiempo: qué pasó, por qué, qué consecuencia tuvo y qué hacer. */
export function EventTimeline({ events }: { events: CropEvent[] }) {
  const stages = events.filter((e) => e.code.startsWith('stage_') || e.code === 'harvest')
  const issues = events
    .filter((e) => e.level !== 'info')
    .sort((a, b) => (a.level === b.level ? a.t_hour - b.t_hour : a.level === 'critical' ? -1 : 1))
  return (
    <div className="ci-events">
      {stages.length > 0 && (
        <ol className="ci-stages" aria-label="Etapas del cultivo">
          {stages.map((e) => (
            <li key={e.code}>
              <b>{e.title.replace('Entró a: ', '')}</b>
              <small>{days(e.t_hour)}</small>
            </li>
          ))}
        </ol>
      )}
      {!issues.length && <p className="muted">Sin estreses relevantes en este escenario.</p>}
      <ul className="ci-list">
        {issues.map((e) => (
          <li key={e.code} className={e.level}>
            <div className="ci-h">
              <span className="ci-tag">{LEVEL_LABEL[e.level]}</span>
              <b>{e.title}</b>
              <small>
                {days(e.t_hour)}
                {e.hours >= 1 ? ` · ${Math.round(e.hours)} h en total` : ''}
                {e.episodes > 1 ? ` · ${e.episodes} veces` : ''}
              </small>
            </div>
            <p>
              <b>Por qué:</b> {e.cause}
            </p>
            <p>
              <b>Consecuencia:</b> {e.consequence}
            </p>
            {e.action && (
              <p>
                <b>Qué hacer:</b> {e.action}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const W = 340
const PAD = { l: 78, r: 8, t: 6, b: 18 }

/** Mapa de estrés: una fila por factor, más oscuro = más estrés en ese momento. */
export function StressMap({ sim, pos }: { sim: SimResponse; pos: number }) {
  const s = sim.series
  const keys = Object.keys(FACTOR_LABEL).filter((k) => s.some((p) => p.stress && p.stress[k] != null && p.stress[k] < 0.97))
  if (!s.length || !s[0].stress || !keys.length)
    return <p className="muted">Ningún factor bajó del 97 % en este escenario: sin estrés apreciable.</p>
  const n = s.length
  const t1 = Math.max(1, s[n - 1].t_hour)
  const rowH = 14
  const H = PAD.t + keys.length * (rowH + 3) + PAD.b
  const x = (h: number) => PAD.l + (h / t1) * (W - PAD.l - PAD.r)
  const bins = Math.min(n, 110)
  const per = n / bins
  const cur = s[Math.min(n - 1, Math.max(0, Math.floor(pos)))]
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mapa de estrés por factor: ${keys.map((k) => FACTOR_LABEL[k]).join(', ')}`}>
      {keys.map((k, r) => {
        const y = PAD.t + r * (rowH + 3)
        return (
          <g key={k}>
            <text x={PAD.l - 6} y={y + rowH - 3} textAnchor="end">
              {FACTOR_LABEL[k]}
            </text>
            <rect x={PAD.l} y={y} width={W - PAD.l - PAD.r} height={rowH} rx="3" fill="var(--line)" opacity="0.35" />
            {Array.from({ length: bins }, (_, b) => {
              const a = Math.floor(b * per)
              const e = Math.max(a + 1, Math.floor((b + 1) * per))
              let worst = 1
              for (let i = a; i < e && i < n; i++) worst = Math.min(worst, s[i].stress?.[k] ?? 1)
              const sev = Math.min(1, (1 - worst) * 2.2)
              if (sev < 0.04) return null
              const x0 = x(s[a].t_hour)
              const x1 = x(s[Math.min(n - 1, e)].t_hour)
              return <rect key={b} x={x0} y={y} width={Math.max(1.5, x1 - x0)} height={rowH} fill="var(--crit)" opacity={0.25 + 0.75 * sev} />
            })}
          </g>
        )
      })}
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={x(f * t1)} y={H - 4} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
          {days(f * t1)}
        </text>
      ))}
      <line x1={x(cur.t_hour)} x2={x(cur.t_hour)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeWidth="1.2" opacity="0.7" />
    </svg>
  )
}

const HP = { l: 30, r: 8, t: 8, b: 20 }
const HH = 150
/** Rendimiento proyectado, salud y raíz en el tiempo. */
export function HealthChart({ sim, pos }: { sim: SimResponse; pos: number }) {
  const s = sim.series.filter((p) => p.yield_pct != null)
  if (s.length < 2) return null
  const t1 = Math.max(1, s[s.length - 1].t_hour)
  const x = (h: number) => HP.l + (h / t1) * (W - HP.l - HP.r)
  const y = (v: number) => HP.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (HH - HP.t - HP.b)
  const line = (get: (p: (typeof s)[number]) => number) => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t_hour).toFixed(1)} ${y(get(p)).toFixed(1)}`).join('')
  const cur = sim.series[Math.min(sim.series.length - 1, Math.max(0, Math.floor(pos)))]
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${HH}`} role="img" aria-label="Rendimiento proyectado, salud y raíz durante la simulación">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={HP.l} x2={W - HP.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={HP.l - 5} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={x(f * t1)} y={HH - 5} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
            {days(f * t1)}
          </text>
        ))}
        <path d={line((p) => (p.health ?? 1) * 100)} fill="none" stroke="var(--warn)" strokeWidth="2" strokeDasharray="5 3" />
        <path d={line((p) => p.root_pct ?? 100)} fill="none" stroke="var(--water)" strokeWidth="1.6" />
        <path d={line((p) => p.yield_pct ?? 0)} fill="none" stroke="var(--moss)" strokeWidth="2.4" strokeLinejoin="round" />
        <line x1={x(cur.t_hour)} x2={x(cur.t_hour)} y1={HP.t} y2={HH - HP.b} stroke="var(--ink)" strokeWidth="1.2" opacity="0.7" />
      </svg>
      <div className="ci-legend">
        <span>
          <i style={{ background: 'var(--moss)' }} /> rendimiento proyectado
        </span>
        <span>
          <i style={{ background: 'var(--warn)' }} /> salud
        </span>
        <span>
          <i style={{ background: 'var(--water)' }} /> raíz
        </span>
      </div>
    </>
  )
}

export function LossList({ losses }: { losses: Record<string, number> }) {
  const e = Object.entries(losses)
  if (!e.length) return null
  return (
    <ul className="ci-losses">
      {e.map(([k, v]) => (
        <li key={k}>
          <span>{LOSS_LABEL[k] ?? k}</span>
          <b>−{Math.round(v * 100)} %</b>
        </li>
      ))}
    </ul>
  )
}

export function CropAdvice({ data, current }: { data: RecommendResponse; current?: string | null }) {
  const [open, setOpen] = useState<string | null>(data.ranking[0]?.crop ?? null)
  return (
    <div className="ci-advice">
      <p className="muted">Ciclo completo simulado por cultivo con {data.basis}.</p>
      <ul>
        {data.ranking.map((r, i) => (
          <li key={r.crop} className={r.crop === current ? 'cur' : ''}>
            <button type="button" onClick={() => setOpen(open === r.crop ? null : r.crop)} aria-expanded={open === r.crop}>
              <span className="ci-rank">{i + 1}</span>
              <span className="ci-name">
                {r.name}
                {r.crop === current && <small> · el tuyo</small>}
              </span>
              <span className="ci-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(2, r.yield_pct)}%` }} />
              </span>
              <b>{Math.round(r.yield_pct)} %</b>
            </button>
            {open === r.crop && (
              <div className="ci-more">
                <p>
                  <b>{r.verdict}</b>
                  {r.days ? ` · cosecha en ~${r.days} días` : ''}
                  {r.yield_kg_m2 != null ? ` · ≈ ${r.yield_kg_m2} kg/m² (referencia típica × %)` : ''}
                </p>
                {r.issues.length === 0 && <p className="muted">Sin problemas relevantes con estas condiciones.</p>}
                {r.issues.map((x) => (
                  <p key={x.title} className={'ci-issue ' + x.level}>
                    <b>{x.title}.</b> {x.cause} <em>{x.action}</em>
                  </p>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <small className="muted">{data.disclaimer}</small>
    </div>
  )
}

export function CropFit({ data }: { data: FitResponse }) {
  const [open, setOpen] = useState<string | null>(data.ranking.find((r) => r.current)?.crop ?? null)
  if (!data.ranking.length) return <p className="muted">Aún no hay suficientes lecturas para comparar (se necesitan datos de varias horas).</p>
  return (
    <div className="ci-advice">
      <p className="muted">Historial real de {data.window_h} h pasado por el modelo de cada cultivo.</p>
      {data.note && <p className="ci-issue warn"><b>Ojo.</b> {data.note}</p>}
      <ul>
        {data.ranking.map((r) => (
          <li key={r.crop} className={r.current ? 'cur' : ''}>
            <button type="button" onClick={() => setOpen(open === r.crop ? null : r.crop)} aria-expanded={open === r.crop}>
              <span className="ci-rank">{r.rank}</span>
              <span className="ci-name">{r.name}{r.current && <small> · el tuyo</small>}</span>
              <span className="ci-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, r.score)}%` }} /></span>
              <b>{Math.round(r.score)}</b>
            </button>
            {open === r.crop && (
              <div className="ci-more">
                <p>Salud estimada con lo vivido: <b>{Math.round(r.health_pct)} %</b>{r.dead ? ' · no habría sobrevivido' : ''}</p>
                {r.issues.length === 0 && <p className="muted">Sin problemas relevantes.</p>}
                {r.issues.map((x) => (
                  <p key={x.title} className={'ci-issue ' + x.level}><b>{x.title}.</b> {x.cause} <em>{x.action}</em></p>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <small className="muted">{data.disclaimer}</small>
    </div>
  )
}

export function OptimizeResult({ data, onApply }: { data: OptimizeResponse; onApply: (trigger: number, mm: number) => void }) {
  const b = data.best
  if (b.yield_pct < 20)
    return (
      <div className="ci-opt">
        <p>
          <b>Ninguna estrategia de riego salva este escenario</b> (la mejor llega a {Math.round(b.yield_pct)} %). El problema no es el
          riego: revisa el drenaje del recipiente, el clima o los nutrientes en la lista «Qué pasó y por qué».
        </p>
      </div>
    )
  return (
    <div className="ci-opt">
      <p>
        <b>Mejor estrategia:</b> regar cuando el agua útil baje de <b>{b.trigger_aw_pct} %</b>, con <b>{b.mm} mm</b> por riego →
        rendimiento <b>{Math.round(b.yield_pct)} %</b> usando {Math.round(b.irrigation_mm)} mm de agua.
      </p>
      <p className="muted">
        La peor probada ({data.worst.trigger_aw_pct} % / {data.worst.mm} mm) da {Math.round(data.worst.yield_pct)} %
        {data.worst.waterlog_h > 0 ? ` y ${Math.round(data.worst.waterlog_h)} h de encharcamiento` : ''}
        {data.worst.hours_water_stress > 0 ? ` y ${Math.round(data.worst.hours_water_stress)} h de sed` : ''}.
      </p>
      <table className="ci-table">
        <thead>
          <tr>
            <th>Umbral</th>
            <th>mm</th>
            <th>Rend.</th>
            <th>Agua</th>
          </tr>
        </thead>
        <tbody>
          {data.top.map((r) => (
            <tr key={r.trigger_aw_pct + '-' + r.mm}>
              <td>{r.trigger_aw_pct} %</td>
              <td>{r.mm}</td>
              <td>{Math.round(r.yield_pct)} %</td>
              <td>{Math.round(r.irrigation_mm)} mm</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn" onClick={() => onApply(b.trigger_aw_pct, b.mm)}>
        Usar esta estrategia en la simulación
      </button>
    </div>
  )
}
