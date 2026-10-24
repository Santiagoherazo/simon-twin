import { useEffect, useState } from 'react'
import { getHistory, type HistoryPoint } from '../api'

/** Humedad del suelo de las últimas 24 h (GET /history). Si el backend no responde, no muestra nada. */
export function Sparkline({ deviceId }: { deviceId: string }) {
  const [pts, setPts] = useState<HistoryPoint[] | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    const load = () =>
      getHistory(deviceId, 24, 900, ctrl.signal)
        .then((r) => setPts(r.points))
        .catch(() => {})
    void load()
    const id = window.setInterval(load, 120_000)
    return () => {
      ctrl.abort()
      window.clearInterval(id)
    }
  }, [deviceId])
  const v = (pts ?? []).filter((p) => p.vwc_pct != null).map((p) => ({ t: Date.parse(p.t) / 1000, vwc_pct: p.vwc_pct }))
  if (v.length < 3) return null
  const W = 300
  const H = 64
  const ys = v.map((p) => p.vwc_pct as number)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const span = Math.max(hi - lo, 4)
  const t0 = v[0].t
  const t1 = v[v.length - 1].t
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W
  const y = (val: number) => H - 6 - ((val - lo) / span) * (H - 14)
  const line = v.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.vwc_pct as number).toFixed(1)}`).join(' ')
  const last = v[v.length - 1]
  return (
    <section className="card" aria-labelledby="hist-h">
      <h2 id="hist-h">Humedad, últimas 24 h</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label={`Humedad del suelo entre ${lo.toFixed(0)} % y ${hi.toFixed(0)} % en las últimas 24 horas`}>
        <defs>
          <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--water)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--water)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#spk)" />
        <path d={line} fill="none" stroke="var(--water)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.vwc_pct as number)} r="3.5" fill="var(--water)" />
      </svg>
      <div className="spark-meta muted">
        <span>mín {lo.toFixed(0)} %</span>
        <span>máx {hi.toFixed(0)} %</span>
      </div>
    </section>
  )
}
