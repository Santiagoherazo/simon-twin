import type { SimResponse } from '../types'

const W = 340
const H = 150
const PAD = { l: 30, r: 8, t: 8, b: 20 }

/** Agua útil (%) en el tiempo, con el umbral de riego, los eventos y el punto que se está viendo. */
export function SimChart({ sim, pos }: { sim: SimResponse; pos: number }) {
  const s = sim.series
  const n = s.length
  const t1 = Math.max(1, s[n - 1].t_hour)
  const x = (h: number) => PAD.l + (h / t1) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - PAD.t - PAD.b)
  const path = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t_hour).toFixed(1)} ${y(p.aw_pct).toFixed(1)}`).join('')
  const thr = s[0].taw_mm > 0 ? 100 * (1 - s[0].raw_mm / s[0].taw_mm) : 50
  const i0 = Math.min(n - 1, Math.max(0, Math.floor(pos)))
  const cur = s[i0]
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * t1)
  const stress = s.filter((p) => p.ks < 1)

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Agua útil del suelo durante ${t1} horas: mínimo ${sim.summary.min_aw_pct.toFixed(0)} %, ${sim.summary.irrigations.length} riegos`}
      >
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={PAD.l - 5} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {ticks.map((h) => (
          <text key={h} x={x(h)} y={H - 5} textAnchor="middle">
            {Math.round(h)} h
          </text>
        ))}
        {stress.length > 0 && (
          <rect
            x={x(stress[0].t_hour)}
            width={Math.max(2, x(stress[stress.length - 1].t_hour) - x(stress[0].t_hour))}
            y={PAD.t}
            height={H - PAD.t - PAD.b}
            fill="var(--crit)"
            opacity="0.1"
          />
        )}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(thr)} y2={y(thr)} stroke="var(--warn)" strokeDasharray="4 3" />
        <path d={path} fill="none" stroke="var(--water)" strokeWidth="2" strokeLinejoin="round" />
        {sim.summary.irrigations.map((ir, i) => (
          <line key={'i' + i} x1={x(ir.t_hour)} x2={x(ir.t_hour)} y1={y(0)} y2={y(0) - 14} stroke="var(--moss)" strokeWidth="3" strokeLinecap="round" />
        ))}
        {s
          .filter((p) => p.rain_mm > 0)
          .map((p, i) => (
            <circle key={'r' + i} cx={x(p.t_hour)} cy={PAD.t + 4} r="2.5" fill="var(--water)" />
          ))}
        <line x1={x(cur.t_hour)} x2={x(cur.t_hour)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeWidth="1" />
        <circle cx={x(cur.t_hour)} cy={y(cur.aw_pct)} r="4" fill="var(--ink)" />
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--water)' }} />
          agua útil (%)
        </span>
        <span>
          <i style={{ background: 'var(--warn)' }} />
          umbral de riego
        </span>
        <span>
          <i style={{ background: 'var(--moss)' }} />
          riego
        </span>
      </div>
    </>
  )
}
