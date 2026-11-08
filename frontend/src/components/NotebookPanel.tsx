import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError, nbDelete, nbDeploy, nbGet, nbList, nbPredict, nbRestart, nbRun, nbSave, nbTemplates,
  type NbAlert, type NbCell, type NbMeta, type NbTemplate, type PredictResult, type RunResult,
} from '../api'

type CellOut = RunResult & { n: number }
interface Curve {
  label: string
  rows: Record<string, number>[]
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'modelo'

const RUNS_KEY = 'simon.nb.runs.v1'
interface RunRec { name: string; at: number; points: number; last: Record<string, number> }
const loadRuns = (): Record<string, RunRec> => {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '{}') } catch { return {} }
}
const saveRuns = (r: Record<string, RunRec>) => { try { localStorage.setItem(RUNS_KEY, JSON.stringify(r)) } catch { /* sin almacenamiento */ } }

const REGISTER_CELL = `# Generada al importar: entrena y registra tu modelo si el archivo define train()/predict()
import inspect
if 'train' in globals():
    _r = train(simon.data()) if inspect.signature(train).parameters else train()
    print('train() terminó', '' if _r is None else _r)
if 'predict' in globals():
    simon.register(predict)
    print('predict() registrado')
else:
    print('Tu archivo no define predict(row): decláralo para usarlo en vivo.')`

/** Convierte un .py (celdas con «# %%») o un .ipynb en celdas de cuaderno. */
function parseImport(fileName: string, text: string): NbCell[] {
  if (fileName.endsWith('.ipynb')) {
    const j = JSON.parse(text) as { cells?: { cell_type: string; source: string | string[] }[] }
    const cells = (j.cells ?? []).map((c) => ({
      type: (c.cell_type === 'code' ? 'code' : 'text') as 'code' | 'text',
      source: (Array.isArray(c.source) ? c.source.join('') : c.source).replace(/\s+$/, ''),
    })).filter((c) => c.source)
    if (!cells.length) throw new Error('El .ipynb no tiene celdas')
    return cells
  }
  const parts = text.split(/^# %%.*$/m).map((x) => x.replace(/^\n+|\s+$/g, '')).filter(Boolean)
  const cells: NbCell[] = (parts.length ? parts : [text]).map((source) => ({ type: 'code' as const, source }))
  if (!cells.some((c) => c.source)) throw new Error('El archivo está vacío')
  return cells
}

/** Curva de aprendizaje: la última corrida en trazo fuerte y las anteriores tenues, para comparar. */
function LearningCurve({ curves, onClear }: { curves: Curve[]; onClear: () => void }) {
  const W = 560, H = 210, L = 44, R = 12, T = 12, B = 26
  const last = curves[curves.length - 1]
  const keys = useMemo(() => (last ? Object.keys(last.rows[0] ?? {}).filter((k) => k !== 'step') : []), [last])
  const all = curves.flatMap((c) => c.rows)
  if (!last || !all.length) {
    return (
      <div className="nb-curve empty">
        <b>Curva de aprendizaje</b>
        <p>Aparece aquí cuando una celda llama a <code>simon.log(epoca, perdida=…, validacion=…)</code>. Prueba la plantilla «Modelo que aprende».</p>
      </div>
    )
  }
  const xs = all.map((r) => r.step)
  const ys = all.flatMap((r) => keys.map((k) => r[k]).filter((v) => Number.isFinite(v)))
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const sx = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R)
  const sy = (v: number) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B)
  const path = (rows: Record<string, number>[], k: string) =>
    rows.filter((r) => Number.isFinite(r[k])).map((r, i) => `${i ? 'L' : 'M'}${sx(r.step).toFixed(1)},${sy(r[k]).toFixed(1)}`).join('')
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2))
  return (
    <div className="nb-curve">
      <div className="nb-curve-h">
        <b>Curva de aprendizaje</b>
        <span className="nb-legend">
          {keys.map((k, i) => <span key={k}><i className={'sw s' + (i % 4)} /> {k}</span>)}
        </span>
        <button className="btn ghost sm" onClick={onClear}>Limpiar</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Curva de aprendizaje: ${keys.join(', ')}`}>
        {[0, 0.5, 1].map((f) => {
          const v = y0 + (y1 - y0) * f
          return (
            <g key={f}>
              <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="grid" />
              <text x={L - 6} y={sy(v) + 4} textAnchor="end" className="tick">{fmt(v)}</text>
            </g>
          )
        })}
        <text x={L} y={H - 6} className="tick">{x0}</text>
        <text x={W - R} y={H - 6} textAnchor="end" className="tick">{x1}</text>
        {curves.slice(0, -1).slice(-3).map((c, ci) => keys.map((k, i) => (
          <path key={`${ci}-${k}`} d={path(c.rows, k)} className={'ln old s' + (i % 4)} />
        )))}
        {keys.map((k, i) => <path key={k} d={path(last.rows, k)} className={'ln s' + (i % 4)} />)}
      </svg>
      <small className="muted">{last.label} · {last.rows.length} puntos{curves.length > 1 ? ` · ${curves.length - 1} corrida(s) anterior(es) en tenue` : ''}</small>
    </div>
  )
}

function Alerts({ list }: { list: NbAlert[] }) {
  if (!list.length) return null
  return (
    <ul className="nb-alerts">
      {list.map((a, i) => <li key={i} className={a.level}><b>{a.level === 'critical' ? 'Crítica' : a.level === 'warn' ? 'Aviso' : 'Info'}</b> {a.message}{a.variable ? ` · ${a.variable}` : ''}</li>)}
    </ul>
  )
}

function Output({ o }: { o: CellOut }) {
  return (
    <div className="nb-out">
      {o.stdout && <pre>{o.stdout}</pre>}
      {o.result && <pre className="res">{o.result}</pre>}
      {o.figures.map((f, i) => <img key={i} alt={`Figura ${i + 1}`} src={`data:image/png;base64,${f}`} />)}
      <Alerts list={o.alerts} />
      {o.error && <pre className="err">{o.error}</pre>}
      <small className="muted">[{o.n}] {o.ok ? 'listo' : 'con error'} · {o.ms} ms{o.metrics.length ? ` · ${o.metrics.length} métricas` : ''}</small>
    </div>
  )
}

/** Compara los modelos entrenados (última métrica de cada cuaderno que usó simon.log); menor es mejor si es una pérdida. */
function ModelCompare({ tick, current }: { tick: number; current: string }) {
  const runs = useMemo(() => Object.entries(loadRuns()), [tick]) // eslint-disable-line react-hooks/exhaustive-deps
  if (runs.length < 2) return null
  const keys = Array.from(new Set(runs.flatMap(([, r]) => Object.keys(r.last))))
  const fmt = (v: number | undefined) => (v === undefined ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2))
  const valKey = keys.find((k) => /valid|val|test/i.test(k)) ?? keys[0]
  const best = Math.min(...runs.map(([, r]) => r.last[valKey]).filter((v) => Number.isFinite(v)))
  return (
    <div className="nb-pred">
      <b>Comparar modelos</b>
      <table className="nb-cmp">
        <thead><tr><th>Modelo</th>{keys.map((k) => <th key={k}>{k}</th>)}</tr></thead>
        <tbody>
          {runs.map(([nid, r]) => (
            <tr key={nid} className={nid === current ? 'cur' : ''}>
              <td>{r.name}{r.last[valKey] === best ? ' ★' : ''}</td>
              {keys.map((k) => <td key={k}>{fmt(r.last[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <small className="muted">★ mejor «{valKey}» (se asume que menor es mejor). Última ejecución de cada cuaderno en este navegador.</small>
    </div>
  )
}

export function NotebookPanel({ apiKey, deviceId }: { apiKey: string; deviceId: string }) {
  const [list, setList] = useState<NbMeta[]>([])
  const [templates, setTemplates] = useState<NbTemplate[]>([])
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [cells, setCells] = useState<NbCell[]>([])
  const [saved, setSaved] = useState('')
  const [outs, setOuts] = useState<Record<number, CellOut>>({})
  const [running, setRunning] = useState<number | null>(null)
  const [counter, setCounter] = useState(0)
  const [curves, setCurves] = useState<Curve[]>([])
  const [pred, setPred] = useState<PredictResult | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [hasPredict, setHasPredict] = useState(false)
  const [live, setLive] = useState(false)
  const [runsTick, setRunsTick] = useState(0)
  const taRefs = useRef<(HTMLTextAreaElement | null)[]>([])

  const fail = (e: unknown) => setMsg({ ok: false, text: e instanceof ApiError || e instanceof Error ? e.message : 'Error desconocido' })
  const dirty = id !== '' && JSON.stringify({ name, cells }) !== saved

  const refresh = useCallback(async () => {
    if (!apiKey) return
    try {
      const [l, t] = await Promise.all([nbList(apiKey), nbTemplates(apiKey)])
      setList(l)
      setTemplates(t)
      setMsg(null)
    } catch (e) {
      fail(e)
    }
  }, [apiKey])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = async (nid: string) => {
    if (!nid) return
    try {
      const n = await nbGet(apiKey, nid)
      setId(n.id)
      setName(n.name)
      setLive(!!n.live)
      setCells(n.cells)
      setSaved(JSON.stringify({ name: n.name, cells: n.cells }))
      setOuts({})
      setCurves([])
      setPred(null)
      setHasPredict(false)
      setMsg(null)
    } catch (e) {
      fail(e)
    }
  }

  const create = async (tpl: NbTemplate | null, custom?: { name: string; cells: NbCell[] }) => {
    const base = custom ? custom.name : tpl ? tpl.name : 'Modelo nuevo'
    let nid = slug(base)
    const used = new Set(list.map((n) => n.id))
    for (let i = 2; used.has(nid); i++) nid = `${slug(base)}-${i}`
    const body = { name: base, device_id: deviceId || null, cells: custom ? custom.cells : tpl ? tpl.cells : [{ type: 'text' as const, source: 'Escribe tu modelo aquí.' }, { type: 'code' as const, source: 'df = simon.data()\ndf.tail()' }] }
    try {
      await nbSave(apiKey, nid, body)
      await refresh()
      await open(nid)
    } catch (e) {
      fail(e)
    }
  }

  const importFile = async (f: File | undefined) => {
    if (!f) return
    try {
      if (f.size > 1_000_000) throw new Error('El archivo pesa más de 1 MB')
      const text = await f.text()
      let cells = parseImport(f.name.toLowerCase(), text)
      if (!f.name.toLowerCase().endsWith('.ipynb') || /def (train|predict)\b/.test(text))
        cells = [...cells, { type: 'code', source: REGISTER_CELL }]
      await create(null, { name: f.name.replace(/\.(py|ipynb)$/i, '').slice(0, 60) || 'Importado', cells })
      setMsg({ ok: true, text: 'Archivo importado. Ejecuta todo para entrenar y registrar el modelo.' })
    } catch (e) {
      fail(e)
    }
  }

  const save = async () => {
    try {
      const n = await nbSave(apiKey, id, { name, device_id: deviceId || null, cells })
      setSaved(JSON.stringify({ name: n.name, cells: n.cells }))
      void refresh()
      setMsg({ ok: true, text: 'Cuaderno guardado.' })
    } catch (e) {
      fail(e)
    }
  }

  const remove = async () => {
    if (!id || !window.confirm(`¿Borrar el cuaderno «${name}»?`)) return
    try {
      await nbDelete(apiKey, id)
      setId('')
      setCells([])
      void refresh()
    } catch (e) {
      fail(e)
    }
  }

  const run = async (i: number): Promise<boolean> => {
    if (cells[i]?.type !== 'code') return true
    setRunning(i)
    setMsg(null)
    try {
      if (dirty) await nbSave(apiKey, id, { name, device_id: deviceId || null, cells }).then((n) => setSaved(JSON.stringify({ name: n.name, cells: n.cells })))
      const r = await nbRun(apiKey, id, cells[i].source)
      const n = counter + 1
      setCounter(n)
      setOuts((o) => ({ ...o, [i]: { ...r, n } }))
      setHasPredict(r.has_predict || hasPredict)
      if (r.metrics.length) {
        const last = Object.fromEntries(Object.entries(r.metrics[r.metrics.length - 1]).filter(([k]) => k !== 'step')) as Record<string, number>
        const all = loadRuns()
        all[id] = { name, at: Date.now(), points: r.metrics.length, last }
        saveRuns(all)
        setRunsTick((t) => t + 1)
      }
      if (r.metrics.length) setCurves((c) => [...c, { label: `Celda ${i + 1}`, rows: r.metrics }].slice(-5))
      if (r.restarted) setMsg({ ok: false, text: 'El kernel se reinició: vuelve a ejecutar las celdas anteriores.' })
      return r.ok
    } catch (e) {
      fail(e)
      return false
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    for (let i = 0; i < cells.length; i++) if (!(await run(i))) break
  }

  const restart = async () => {
    try {
      await nbRestart(apiKey, id)
      setOuts({})
      setHasPredict(false)
      setMsg({ ok: true, text: 'Kernel reiniciado: variables borradas y lecturas recargadas.' })
    } catch (e) {
      fail(e)
    }
  }

  const toggleLive = async () => {
    try {
      await nbDeploy(apiKey, id, !live)
      setLive(!live)
      setMsg({ ok: true, text: !live ? 'Modelo activo: sus alertas y ajustes se aplican a los datos en vivo.' : 'Modelo desactivado.' })
    } catch (e) {
      fail(e)
    }
  }
  const probe = async () => {
    try {
      setPred(await nbPredict(apiKey, id))
    } catch (e) {
      fail(e)
    }
  }

  const setCell = (i: number, p: Partial<NbCell>) => setCells((c) => c.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const insert = (at: number, type: NbCell['type']) => setCells((c) => [...c.slice(0, at), { type, source: '' }, ...c.slice(at)])
  const move = (i: number, d: number) =>
    setCells((c) => {
      const j = i + d
      if (j < 0 || j >= c.length) return c
      const x = [...c]
      ;[x[i], x[j]] = [x[j], x[i]]
      return x
    })

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
      e.preventDefault()
      void run(i).then(() => taRefs.current[i + 1]?.focus())
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const t = e.currentTarget
      const s = t.selectionStart
      setCell(i, { source: t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd) })
      requestAnimationFrame(() => t.setSelectionRange(s + 4, s + 4))
    }
  }

  if (!apiKey)
    return (
      <div className="adm-empty">
        <h3>Modelos de predicción</h3>
        <p>Escribe la <b>API key</b> en la parte superior para abrir los cuadernos.</p>
      </div>
    )

  return (
    <section className="nb">
      <div className="nb-bar">
        <label className="adm-f">
          Cuaderno
          <select value={id} onChange={(e) => void open(e.target.value)}>
            <option value="">{list.length ? 'Elige uno…' : 'Aún no tienes cuadernos'}</option>
            {list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </label>
        <label className="adm-f">
          Nuevo desde plantilla
          <select value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (e.target.value) void create(t ?? null) }}>
            <option value="">+ Crear…</option>
            <option value="__blank">En blanco</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="adm-f">
          Importar .py / .ipynb
          <input type="file" accept=".py,.ipynb" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {id && (
          <>
            <label className="adm-f grow">Nombre<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="btn primary" onClick={save} disabled={!dirty}>{dirty ? 'Guardar' : 'Guardado'}</button>
            <button className="btn" onClick={runAll} disabled={running !== null}>▶ Ejecutar todo</button>
            <button className="btn" onClick={restart} disabled={running !== null}>Reiniciar kernel</button>
            <button className="btn danger" onClick={remove}>Borrar</button>
          </>
        )}
      </div>
      {msg && <div className={'adm-msg ' + (msg.ok ? 'ok' : 'bad')} role="status">{msg.text}</div>}

      {!id && (
        <div className="adm-empty">
          <h3>Tu laboratorio de modelos</h3>
          <p>Un cuaderno es como Colab: celdas de Python que comparten variables, con tablas, gráficas y la curva de aprendizaje. Tus datos reales llegan con <code>simon.data()</code>.</p>
          <ul>
            <li><code>simon.log(epoca, perdida=…)</code> dibuja cómo aprende el modelo.</li>
            <li><code>@simon.register def predict(row): …</code> deja el modelo listo para usarse con la última lectura.</li>
            <li><code>simon.alert('warn', 'mensaje')</code> emite alertas desde el modelo.</li>
          </ul>
          <p>Crea uno con la lista «Nuevo desde plantilla».</p>
        </div>
      )}

      {id && (
        <div className="nb-layout">
          <div className="nb-cells">
            {cells.map((c, i) => (
              <div key={i}>
                <div className={'nb-cell ' + c.type + (running === i ? ' running' : '')}>
                  <div className="nb-gutter">
                    {c.type === 'code' ? (
                      <button className="nb-run" onClick={() => void run(i)} disabled={running !== null} aria-label={`Ejecutar celda ${i + 1}`}>{running === i ? '…' : '▶'}</button>
                    ) : <span className="nb-note-ico" aria-hidden="true">¶</span>}
                  </div>
                  <div className="nb-body">
                    <textarea
                      ref={(el) => { taRefs.current[i] = el }}
                      value={c.source}
                      spellCheck={false}
                      rows={Math.min(28, Math.max(2, c.source.split('\n').length))}
                      onChange={(e) => setCell(i, { source: e.target.value })}
                      onKeyDown={(e) => onKey(e, i)}
                      aria-label={c.type === 'code' ? `Código de la celda ${i + 1}` : `Nota ${i + 1}`}
                    />
                    {outs[i] && <Output o={outs[i]} />}
                  </div>
                  <div className="nb-tools">
                    <button onClick={() => move(i, -1)} aria-label="Subir" disabled={i === 0}>↑</button>
                    <button onClick={() => move(i, 1)} aria-label="Bajar" disabled={i === cells.length - 1}>↓</button>
                    <button onClick={() => setCells((x) => x.filter((_, k) => k !== i))} aria-label="Quitar celda">✕</button>
                  </div>
                </div>
                <div className="nb-add">
                  <button onClick={() => insert(i + 1, 'code')}>+ Código</button>
                  <button onClick={() => insert(i + 1, 'text')}>+ Texto</button>
                </div>
              </div>
            ))}
            {!cells.length && (
              <div className="nb-add always"><button onClick={() => insert(0, 'code')}>+ Código</button><button onClick={() => insert(0, 'text')}>+ Texto</button></div>
            )}
            <small className="muted">Mayús+Enter ejecuta la celda y pasa a la siguiente · Tab indenta · el kernel conserva las variables hasta que lo reinicies.</small>
          </div>

          <aside className="nb-side">
            <LearningCurve curves={curves} onClear={() => setCurves([])} />
            <ModelCompare tick={runsTick} current={id} />
            <div className="nb-pred">
              <b>Modelo en uso</b>
              <p className="muted">{hasPredict ? 'Hay un predict(row) registrado.' : 'Ejecuta la celda con @simon.register para registrar predict(row).'}</p>
              <button className="btn" onClick={probe} disabled={!hasPredict}>Probar con la última lectura</button>
              <button className={`btn${live ? ' on' : ''}`} onClick={toggleLive} disabled={!hasPredict && !live}>
                {live ? 'Desactivar en vivo' : 'Activar en vivo'}
              </button>
              <p className="muted">En vivo: el servidor llama a predict(row) con cada estado. Sus <code>simon.alert()</code> salen en las alertas y si devuelve <code>{'{"overrides": {"vwc_pct": 31}}'}</code> ajusta esa lectura.</p>
              {pred && (
                <div className="nb-out">
                  {pred.error && <pre className="err">{pred.error}</pre>}
                  {pred.ok && <pre className="res">{JSON.stringify(pred.output, null, 1)}</pre>}
                  <Alerts list={pred.alerts ?? []} />
                  {pred.stdout && <pre>{pred.stdout}</pre>}
                  {pred.input && <details><summary>Lectura usada</summary><pre>{JSON.stringify(pred.input, null, 1)}</pre></details>}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
