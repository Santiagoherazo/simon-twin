import { useEffect, useState } from 'react'
import { getCropParams, getFit, getRecommend, optimizeIrrigation } from '../api'
import { fmt, fmtHours } from '../format'
import type { CropInfo, CropParam, OptimizeResponse, RecommendResponse, FitResponse, SimEventInput, SimRequest, SimResponse, SoilCatalogItem } from '../types'
import { CropAdvice, CropFit, EventTimeline, HealthChart, LossList, OptimizeResult, StressMap } from './CropInsights'
import { SimChart } from './SimChart'

export interface SimPanelProps {
  deviceId: string | null
  /** Cultivo configurado en el dispositivo (para cargar sus parámetros editables). */
  deviceCropId?: string | null
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
  const [drainage, setDrainage] = useState('')
  const [chem, setChem] = useState({ ph: '', ec: '', n: '', p: '', k: '' })
  const [trigger, setTrigger] = useState('')
  const [dCtl, setDCtl] = useState(0)
  const [pCtl, setPCtl] = useState(0)
  const [params, setParams] = useState<CropParam[]>([])
  const [edited, setEdited] = useState<Record<string, number>>({})
  const [advice, setAdvice] = useState<RecommendResponse | null>(null)
  const [fit, setFit] = useState<FitResponse | null>(null)
  const [opt, setOpt] = useState<OptimizeResponse | null>(null)
  const [aux, setAux] = useState<'advice' | 'opt' | 'fit' | null>(null)
  const [auxBusy, setAuxBusy] = useState(false)
  const [auxErr, setAuxErr] = useState<string | null>(null)
  const cropId = crop || p.deviceCropId || ''

  // parámetros editables del cultivo elegido (los valores base vienen del perfil)
  useEffect(() => {
    if (!cropId) return
    const ac = new AbortController()
    setEdited({})
    getCropParams(cropId, ac.signal)
      .then(setParams)
      .catch(() => setParams([]))
    return () => ac.abort()
  }, [cropId])
  const [vwc, setVwc] = useState('')
  const [tempOff, setTempOff] = useState('0')
  const [luxScale, setLuxScale] = useState('1')
  const [auto, setAuto] = useState(false)
  const [autoMm, setAutoMm] = useState('10')
  const [events, setEvents] = useState<SimEventInput[]>([])
  const [evType, setEvType] = useState<'irrigation' | 'rain' | 'fertilize'>('irrigation')
  const [evHour, setEvHour] = useState('12')
  const [evMm, setEvMm] = useState('8')

  const addEvent = () => {
    const at = Math.min(hours, Math.max(0, num(evHour, 0)))
    const ev: SimEventInput =
      evType === 'fertilize'
        ? { at_hour: at, type: 'fertilize', n: Math.max(0, num(evMm, 60)), p: Math.max(0, num(evMm, 60) / 3), k: Math.max(0, num(evMm, 60) / 2) }
        : { at_hour: at, type: evType, mm: Math.max(0.1, num(evMm, 5)) }
    setEvents((e) => [...e, ev].sort((a, b) => a.at_hour - b.at_hour))
  }

  const buildRequest = (): SimRequest => {
    const overrides: SimRequest['overrides'] = {}
    if (crop) overrides.crop = crop
    if (soil) overrides.soil_type = soil
    if (vwc.trim() !== '') overrides.vwc_pct = num(vwc, 40)
    if (drainage) overrides.drainage = drainage as SimRequest['overrides']['drainage']
    for (const k of ['ph', 'ec', 'n', 'p', 'k'] as const) if (chem[k].trim() !== '') overrides[k] = num(chem[k], 0)
    if (Object.keys(edited).length) overrides.crop_params = edited
    return {
      hours,
      step_minutes: hours > 1200 ? 180 : hours > 240 ? 60 : hours > 96 ? 60 : 30,
      weather: { mode: 'persist', temp_offset_c: num(tempOff, 0), rh_offset: 0, lux_scale: num(luxScale, 1) },
      events,
      auto_irrigation: { enabled: auto, mm: Math.max(1, num(autoMm, 10)), trigger_aw_pct: trigger.trim() === '' ? null : num(trigger, 50) },
      overrides,
      management: { disease_control: dCtl, pest_control: pCtl },
    }
  }
  const run = () => p.onRun(buildRequest())

  const guard = async (kind: 'advice' | 'opt' | 'fit', f: () => Promise<void>) => {
    if (!p.deviceId) return
    setAux(kind)
    setAuxBusy(true)
    setAuxErr(null)
    try {
      await f()
    } catch (e) {
      setAuxErr((e as Error).message || 'No se pudo calcular')
    } finally {
      setAuxBusy(false)
    }
  }
  const askAdvice = () => guard('advice', async () => setAdvice(await getRecommend(p.deviceId!, drainage || undefined)))
  const askFit = () => guard('fit', async () => setFit(await getFit(p.deviceId!)))
  const askOptimize = () =>
    guard('opt', async () => {
      const req = buildRequest()
      if (req.hours < 24 * 14) req.hours = 24 * 90 // optimizar necesita un ciclo largo para ver el efecto en el rendimiento
      setOpt(await optimizeIrrigation(p.deviceId!, req))
    })

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
              {[24, 48, 72, 168, 24 * 14, 24 * 30, 24 * 60, 24 * 90, 24 * 120, 24 * 150, 24 * 200].map((h) => (
                <option key={h} value={h}>
                  {h < 168 ? `${h} h` : `${h / 24} días`}
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
          Riego automático
        </label>
        {auto && (
          <div className="row">
            <label>
              Regar si el agua útil baja de (%)
              <input type="number" min={0} max={100} step="any" placeholder="umbral del cultivo" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
            </label>
            <label>
              Lámina por riego (mm)
              <input type="number" min={1} max={50} step="any" value={autoMm} onChange={(e) => setAutoMm(e.target.value)} />
            </label>
          </div>
        )}
        <div className="row">
          <label>
            Drenaje del recipiente
            <select value={drainage} onChange={(e) => setDrainage(e.target.value)}>
              <option value="">Normal del suelo</option>
              <option value="regular">Regular</option>
              <option value="malo">Malo (se encharca)</option>
              <option value="sin_salida">Sin huecos de salida</option>
            </select>
          </label>
        </div>

        <details className="sim-adv">
          <summary>Suelo y nutrientes (vacío = lectura actual)</summary>
          <div className="row">
            {(
              [
                ['ph', 'pH'],
                ['ec', 'EC (µS/cm)'],
                ['n', 'N (mg/kg)'],
                ['p', 'P (mg/kg)'],
                ['k', 'K (mg/kg)'],
              ] as const
            ).map(([k, l]) => (
              <label key={k}>
                {l}
                <input type="number" min={0} step="any" placeholder="actual" value={chem[k]} onChange={(e) => setChem((c) => ({ ...c, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
        </details>

        <details className="sim-adv">
          <summary>Manejo sanitario</summary>
          <label>
            Control de enfermedades: {Math.round(dCtl * 100)} %
            <input type="range" min={0} max={1} step={0.05} value={dCtl} onChange={(e) => setDCtl(Number(e.target.value))} />
          </label>
          <label>
            Control de plagas: {Math.round(pCtl * 100)} %
            <input type="range" min={0} max={1} step={0.05} value={pCtl} onChange={(e) => setPCtl(Number(e.target.value))} />
          </label>
          <small className="muted">0 % = no haces nada (peor caso). Sirve para ver cuánto rendimiento protege vigilar y tratar a tiempo.</small>
        </details>

        {params.length > 0 && (
          <details className="sim-adv">
            <summary>
              Parámetros del cultivo{Object.keys(edited).length ? ` (${Object.keys(edited).length} editados)` : ''}
            </summary>
            <small className="muted">Valores base del perfil. Cámbialos para probar otra variedad o una planta más tolerante.</small>
            {params.map((q) => {
              const v = edited[q.key] ?? q.value
              return (
                <label key={q.key} className={'sim-param' + (q.key in edited ? ' on' : '')} title={q.help}>
                  <span>
                    {q.label} <small className="muted">({q.unit})</small>
                  </span>
                  <input
                    type="number"
                    min={q.min}
                    max={q.max}
                    step="any"
                    value={v}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setEdited((d) => {
                        const c = { ...d }
                        if (!Number.isFinite(n) || n === q.value) delete c[q.key]
                        else c[q.key] = Math.min(q.max, Math.max(q.min, n))
                        return c
                      })
                    }}
                  />
                </label>
              )
            })}
            {Object.keys(edited).length > 0 && (
              <button type="button" className="btn ghost" onClick={() => setEdited({})}>
                Restablecer valores base
              </button>
            )}
          </details>
        )}

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          <legend className="muted" style={{ padding: 0, fontSize: 12.5, marginBottom: 4 }}>
            Eventos
          </legend>
          <div className="row" style={{ gridTemplateColumns: '1.2fr 1fr 1fr auto', alignItems: 'end' }}>
            <label>
              Tipo
              <select value={evType} onChange={(e) => setEvType(e.target.value as 'irrigation' | 'rain' | 'fertilize')}>
                <option value="irrigation">Riego</option>
                <option value="rain">Lluvia</option>
                <option value="fertilize">Abono</option>
              </select>
            </label>
            <label>
              Hora
              <input type="number" min={0} max={hours} value={evHour} onChange={(e) => setEvHour(e.target.value)} />
            </label>
            <label>
              {evType === 'fertilize' ? 'N (mg/kg)' : 'mm'}
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
                    {ev.type === 'fertilize' ? `Abono (+${ev.n} N, +${Math.round(ev.p ?? 0)} P, +${Math.round(ev.k ?? 0)} K)` : `${ev.type === 'rain' ? 'Lluvia' : 'Riego'} de ${ev.mm} mm`} a la hora {ev.at_hour}
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
        <div className="row">
          <button type="button" className="btn ghost" onClick={askOptimize} disabled={auxBusy}>
            {auxBusy && aux === 'opt' ? 'Buscando…' : 'Buscar el mejor riego'}
          </button>
          <button type="button" className="btn ghost" onClick={askAdvice} disabled={auxBusy}>
            {auxBusy && aux === 'advice' ? 'Calculando…' : '¿Qué cultivo conviene?'}
          </button>
          <button type="button" className="btn ghost" style={{ gridColumn: '1 / -1' }} onClick={askFit} disabled={auxBusy}>
            {auxBusy && aux === 'fit' ? 'Comparando…' : 'Comparar con lo vivido'}
          </button>
        </div>
        {auxErr && (
          <p className="msg err" role="alert">
            {auxErr}
          </p>
        )}
        {p.error && (
          <p className="msg err" role="alert" style={{ whiteSpace: 'pre-line' }}>
            {p.error}
          </p>
        )}
      </form>

      {opt && (
        <section aria-labelledby="sopt-h">
          <h2 id="sopt-h">Mejor estrategia de riego</h2>
          <OptimizeResult
            data={opt}
            onApply={(t, mm) => {
              setAuto(true)
              setTrigger(String(t))
              setAutoMm(String(mm))
            }}
          />
        </section>
      )}
      {fit && (
        <section aria-labelledby="sfit-h">
          <h2 id="sfit-h">Cultivos según lo que ha vivido el dispositivo</h2>
          <CropFit data={fit} />
        </section>
      )}
      {advice && (
        <section aria-labelledby="sadv-h">
          <h2 id="sadv-h">Cultivos para tus condiciones</h2>
          <CropAdvice data={advice} current={cropId} />
        </section>
      )}

      {sim && sum && cur && (
        <>
          {sum.crop_model && (
            <section aria-labelledby="scm-h">
              <h2 id="scm-h">{sum.crop_model.dead ? 'La planta murió' : sum.crop_model.harvested ? 'Cosecha' : 'Proyección del cultivo'}</h2>
              <div className="grid">
                <div className="kpi">
                  <b>{fmt(sum.crop_model.yield_pct, 0, ' %')}</b>
                  <small>{sum.crop_model.harvested ? 'rendimiento (del potencial)' : 'rendimiento proyectado'}</small>
                </div>
                <div className="kpi">
                  <b>{fmt(sum.crop_model.health_pct, 0, ' %')}</b>
                  <small>salud de la planta</small>
                </div>
                <div className="kpi">
                  <b>{fmt(sum.crop_model.root_health_pct, 0, ' %')}</b>
                  <small>salud de la raíz</small>
                </div>
                <div className="kpi">
                  <b>{fmt(sum.crop_model.hours.waterlog ?? 0, 0, ' h')}</b>
                  <small>encharcado</small>
                </div>
              </div>
              <LossList losses={sum.crop_model.losses} />
              <HealthChart sim={sim} pos={p.pos} />
              <h3>Estreses en el tiempo</h3>
              <StressMap sim={sim} pos={p.pos} />
            </section>
          )}
          {!!sim.events?.length && (
            <section aria-labelledby="sev-h">
              <h2 id="sev-h">Qué pasó y por qué</h2>
              <EventTimeline events={sim.events} />
            </section>
          )}
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
