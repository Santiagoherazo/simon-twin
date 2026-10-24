import { useState } from 'react'
import { fmt, fmtHours } from '../format'
import type { CropInfo, SimEventInput, SimRequest, SimResponse, SoilCatalogItem } from '../types'
import { SimChart } from './SimChart'

export interface SimPanelProps {
  deviceId: string | null
  crops: CropInfo[]
  soils: SoilCatalogItem[]
  sim: SimResponse | null
  pos: number
  playing: boolean
  busy: boolean
  error: string | null
  onRun: (req: SimRequest) => void
  onPos: (p: number) => void
  onPlay: (p: boolean) => void
}

const num = (v: string, d: number) => {
  const n = Number(v)
  return v.trim() !== '' && Number.isFinite(n) ? n : d
}

export function SimPanel(p: SimPanelProps) {
  const [crop, setCrop] = useState('')
  const [soil, setSoil] = useState('')
  const [hours, setHours] = useState(72)
  const [vwc, setVwc] = useState('')
  const [tempOff, setTempOff] = useState('0')
  const [luxScale, setLuxScale] = useState('1')
  const [auto, setAuto] = useState(false)
  const [autoMm, setAutoMm] = useState('10')
  const [events, setEvents] = useState<SimEventInput[]>([])
  const [evType, setEvType] = useState<'irrigation' | 'rain'>('irrigation')
  const [evHour, setEvHour] = useState('12')
  const [evMm, setEvMm] = useState('8')

  const addEvent = () => {
    const at = Math.min(hours, Math.max(0, num(evHour, 0)))
    setEvents((e) => [...e, { at_hour: at, type: evType, mm: Math.max(0.1, num(evMm, 5)) }].sort((a, b) => a.at_hour - b.at_hour))
  }

  const run = () => {
    const overrides: SimRequest['overrides'] = {}
    if (crop) overrides.crop = crop
    if (soil) overrides.soil_type = soil
    if (vwc.trim() !== '') overrides.vwc_pct = num(vwc, 40)
    p.onRun({
      hours,
      step_minutes: hours > 96 ? 60 : 30,
      weather: { mode: 'persist', temp_offset_c: num(tempOff, 0), rh_offset: 0, lux_scale: num(luxScale, 1) },
      events,
      auto_irrigation: { enabled: auto, mm: Math.max(1, num(autoMm, 10)) },
      overrides,
    })
  }

  if (!p.deviceId)
    return (
      <div className="note">
        <b>Elige un dispositivo</b>La simulación parte del estado actual del suelo de ese dispositivo.
      </div>
    )

  const sim = p.sim
  const sum = sim?.summary
  const cur = sim ? sim.series[Math.min(sim.series.length - 1, Math.floor(p.pos))] : null

  return (
    <>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <h2 style={{ margin: 0 }}>¿Qué pasaría si…?</h2>
        <div className="row">
          <label>
            Cultivo
            <select value={crop} onChange={(e) => setCrop(e.target.value)}>
              <option value="">El del dispositivo</option>
              {p.crops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Suelo
            <select value={soil} onChange={(e) => setSoil(e.target.value)}>
              <option value="">El del dispositivo</option>
              {p.soils.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            Horizonte
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[24, 48, 72, 120, 168].map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <label>
            Humedad inicial (%)
            <input type="number" min={0} max={100} step="any" placeholder="actual" value={vwc} onChange={(e) => setVwc(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label>
            Más calor (°C)
            <input type="number" min={-15} max={15} step="any" value={tempOff} onChange={(e) => setTempOff(e.target.value)} />
          </label>
          <label>
            Luz (× normal)
            <input type="number" min={0} max={2} step="any" value={luxScale} onChange={(e) => setLuxScale(e.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Riego automático al llegar al umbral
        </label>
        {auto && (
          <label>
            Lámina por riego (mm)
            <input type="number" min={1} max={50} step="any" value={autoMm} onChange={(e) => setAutoMm(e.target.value)} />
          </label>
        )}

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          <legend className="muted" style={{ padding: 0, fontSize: 12.5, marginBottom: 4 }}>
            Eventos
          </legend>
          <div className="row" style={{ gridTemplateColumns: '1.2fr 1fr 1fr auto', alignItems: 'end' }}>
            <label>
              Tipo
              <select value={evType} onChange={(e) => setEvType(e.target.value as 'irrigation' | 'rain')}>
                <option value="irrigation">Riego</option>
                <option value="rain">Lluvia</option>
              </select>
            </label>
            <label>
              Hora
              <input type="number" min={0} max={hours} value={evHour} onChange={(e) => setEvHour(e.target.value)} />
            </label>
            <label>
              mm
              <input type="number" min={0.1} step="any" value={evMm} onChange={(e) => setEvMm(e.target.value)} />
            </label>
            <button type="button" className="btn ghost" onClick={addEvent} aria-label="Agregar evento">
              +
            </button>
          </div>
          {events.length > 0 && (
            <ul className="events">
              {events.map((ev, i) => (
                <li key={i}>
                  <span>
                    {ev.type === 'rain' ? 'Lluvia' : 'Riego'} de {ev.mm} mm a la hora {ev.at_hour}
                  </span>
                  <button type="button" aria-label="Quitar evento" onClick={() => setEvents((e) => e.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <button className="btn" type="submit" disabled={p.busy}>
          {p.busy ? 'Simulando…' : 'Simular'}
        </button>
        {p.error && (
          <p className="msg err" role="alert" style={{ whiteSpace: 'pre-line' }}>
            {p.error}
          </p>
        )}
      </form>

      {sim && sum && cur && (
        <>
          <section aria-labelledby="sres-h">
            <h2 id="sres-h">Resultado</h2>
            <div className="player">
              <button
                type="button"
                className="btn ghost"
                onClick={() => p.onPlay(!p.playing)}
                aria-label={p.playing ? 'Pausar' : 'Reproducir'}
              >
                {p.playing ? '❚❚' : '▶'}
              </button>
              <input
                type="range"
                min={0}
                max={sim.series.length - 1}
                step={0.01}
                value={p.pos}
                aria-label="Momento de la simulación"
                onChange={(e) => {
                  p.onPlay(false)
                  p.onPos(Number(e.target.value))
                }}
              />
              <span style={{ minWidth: 52, textAlign: 'right' }}>{Math.round(cur.t_hour)} h</span>
            </div>
            <SimChart sim={sim} pos={p.pos} />
            <div className="grid" style={{ marginTop: 10 }}>
              <div className="kpi">
                <b>{fmt(cur.plant.height_cm, 0, ' cm')}</b>
                <small>altura en este momento</small>
              </div>
              <div className="kpi">
                <b>{fmt(cur.aw_pct, 0, ' %')}</b>
                <small>agua útil</small>
              </div>
            </div>
          </section>
          <section aria-labelledby="ssum-h">
            <h2 id="ssum-h">Resumen</h2>
            <div className="grid">
              <div className="kpi">
                <b>{fmtHours(sum.first_irrigation_due_h)}</b>
                <small>hasta el primer riego</small>
              </div>
              <div className="kpi">
                <b>{fmt(sum.min_aw_pct, 0, ' %')}</b>
                <small>agua útil mínima</small>
              </div>
              <div className="kpi">
                <b>{fmt(sum.irrigation_total_mm, 1, ' mm')}</b>
                <small>riego aplicado</small>
              </div>
              <div className="kpi">
                <b>{fmt(sum.etc_total_mm, 1, ' mm')}</b>
                <small>consumo de la planta</small>
              </div>
              <div className="kpi">
                <b>{fmt(sum.hours_water_stress, 0, ' h')}</b>
                <small>con estrés hídrico</small>
              </div>
              <div className="kpi">
                <b>{fmt(sum.growth_index * 100, 0, ' %')}</b>
                <small>crecimiento logrado</small>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  )
}
