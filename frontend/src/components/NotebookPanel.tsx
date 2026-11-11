import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  ApiError, nbDelete, nbDeploy, nbGet, nbList, nbPredict, nbRestart, nbRun, nbSave, nbTemplates,
  type NbAlert, type NbCell, type NbMeta, type NbTemplate, type PredictResult, type RunResult,
} from '../api'
import { CodeEditor } from './admin/CodeEditor'

type CellOut = RunResult & { n: number }
interface Cell extends NbCell {
  uid: string
}
interface Curve {
  label: string
  rows: Record<string, number>[]
}
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

let uidSeq = 0
const newUid = () => `c${++uidSeq}${Date.now().toString(36)}`
const withUid = (c: NbCell): Cell => ({ ...c, uid: newUid() })
const strip = (cells: Cell[]): NbCell[] => cells.map(({ type, source }) => ({ type, source }))

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'modelo'

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(s)) return ''
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

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

/** Exporta el cuaderno como .py con marcadores «# %%» (se puede volver a importar). */
function toPython(cells: Cell[]): string {
  return cells
    .map((c) => (c.type === 'code' ? `# %%\n${c.source}` : `# %% [markdown]\n${c.source.split('\n').map((l) => `# ${l}`).join('\n')}`))
    .join('\n\n') + '\n'
}

// ---------------------------------------------------------------------------------------------
// Markdown mínimo (sin HTML crudo): títulos, listas, citas, código, negrita, cursiva, enlaces.
// ---------------------------------------------------------------------------------------------
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    if (m[1]) out.push(<code key={k++}>{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    else {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(t) ?? []
      out.push(<a key={k++} href={url} target="_blank" rel="noopener noreferrer">{label}</a>)
    }
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

function Markdown({ src }: { src: string }) {
  const lines = src.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^```/.test(l)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++
      blocks.push(<pre key={k++}>{buf.join('\n')}</pre>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l)
    if (h) {
      const Tag = (`h${Math.min(4, h[1].length + 1)}`) as 'h2' | 'h3' | 'h4' | 'h5'
      blocks.push(<Tag key={k++}>{inline(h[2])}</Tag>)
      i++
      continue
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''))
      blocks.push(<ul key={k++}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push(<ol key={k++}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol>)
      continue
    }
    if (/^>\s?/.test(l)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={k++}>{inline(buf.join(' '))}</blockquote>)
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s+|\s*\d+[.)]\s+|>)/.test(lines[i])) buf.push(lines[i++])
    blocks.push(<p key={k++}>{inline(buf.join(' '))}</p>)
  }
  return <div className="md">{blocks}</div>
}

// ---------------------------------------------------------------------------------------------
// Piezas del panel lateral: curva de aprendizaje, comparación, alertas, salida de celda.
// ---------------------------------------------------------------------------------------------
function LearningCurve({ curves, onClear }: { curves: Curve[]; onClear: () => void }) {
  const W = 560, H = 210, L = 44, R = 12, T = 12, B = 26
  const last = curves[curves.length - 1]
  const keys = useMemo(() => (last ? Object.keys(last.rows[0] ?? {}).filter((k) => k !== 'step') : []), [last])
  const all = curves.flatMap((c) => c.rows)
  if (!last || !all.length) {
    return (
      <div className="nb-card empty">
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
    <div className="nb-card nb-curve">
      <div className="nb-card-h">
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
      <small className="muted">{o.ok ? 'Listo' : 'Con error'} · {o.ms} ms{o.metrics.length ? ` · ${o.metrics.length} métricas` : ''}</small>
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
    <div className="nb-card">
      <b>Comparar modelos</b>
      <div className="adm-scroll">
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
      </div>
      <small className="muted">★ mejor «{valKey}» (se asume que menor es mejor). Última ejecución de cada cuaderno en este navegador.</small>
    </div>
  )
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
const I = {
  plus: 'M12 5v14M5 12h14',
  play: 'M7 4l13 8-13 8z',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  swap: 'M7 7h13l-3-3M17 17H4l3 3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  menu: 'M5 12h.01M12 12h.01M19 12h.01',
  panel: 'M4 5h16v14H4zM15 5v14',
  files: 'M4 4h6l2 3h8v13H4z',
  stop: 'M5 5h14v14H5z',
}

// ---------------------------------------------------------------------------------------------

interface Props {
  apiKey: string
  deviceId: string
  /** Abre el diálogo de la API key del panel. */
  onNeedKey: () => void
}

export function NotebookPanel({ apiKey, deviceId, onNeedKey }: Props) {
  const [list, setList] = useState<NbMeta[]>([])
  const [templates, setTemplates] = useState<NbTemplate[]>([])
  const [loaded, setLoaded] = useState(false)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [cells, setCells] = useState<Cell[]>([])
  const [saved, setSaved] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [outs, setOuts] = useState<Record<string, CellOut>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [counter, setCounter] = useState(0)
  const [curves, setCurves] = useState<Curve[]>([])
  const [pred, setPred] = useState<PredictResult | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [hasPredict, setHasPredict] = useState(false)
  const [live, setLive] = useState(false)
  const [runsTick, setRunsTick] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<'new' | 'more' | null>(null)
  const [showFiles, setShowFiles] = useState(false)
  const [showSide, setShowSide] = useState(() => window.innerWidth >= 1560)
  const focusers = useRef<Record<string, (() => void) | null>>({})
  const pendingFocus = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const sig = useMemo(() => JSON.stringify({ name, cells: strip(cells) }), [name, cells])
  const dirty = id !== '' && sig !== saved

  const fail = (e: unknown) => setMsg({ ok: false, text: e instanceof ApiError || e instanceof Error ? e.message : 'Error desconocido' })

  const refresh = useCallback(async () => {
    if (!apiKey) return
    try {
      const [l, t] = await Promise.all([nbList(apiKey), nbTemplates(apiKey)])
      setList(l)
      setTemplates(t)
      setMsg(null)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error desconocido' })
    } finally {
      setLoaded(true)
    }
  }, [apiKey])
  useEffect(() => {
    void refresh()
  }, [refresh])

  // --- guardado ---
  const persist = useCallback(
    async (quiet: boolean) => {
      if (!id) return
      const snapshot = JSON.stringify({ name, cells: strip(cells) })
      setSaveState('saving')
      try {
        const n = await nbSave(apiKey, id, { name, device_id: deviceId || null, cells: strip(cells) })
        setSaved(snapshot)
        setSaveState('saved')
        setList((l) => l.map((x) => (x.id === id ? { ...x, name: n.name, updated_at: n.updated_at } : x)))
        if (!quiet) setMsg({ ok: true, text: 'Cuaderno guardado.' })
      } catch (e) {
        setSaveState('error')
        fail(e)
      }
    },
    [apiKey, cells, deviceId, id, name],
  )

  // Autoguardado: 1,8 s después del último cambio y sin celdas corriendo
  useEffect(() => {
    if (!dirty || running !== null) {
      if (!dirty && saveState === 'dirty') setSaveState('saved')
      return
    }
    setSaveState((s) => (s === 'saving' ? s : 'dirty'))
    const t = window.setTimeout(() => void persist(true), 1800)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, running])

  // Avisar si se cierra la pestaña con cambios sin guardar
  useEffect(() => {
    if (!dirty) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [dirty])

  // --- abrir / crear / borrar ---
  const open = async (nid: string) => {
    if (!nid || nid === id) { setShowFiles(false); return }
    if (dirty) await persist(true)
    try {
      const n = await nbGet(apiKey, nid)
      const cs = n.cells.map(withUid)
      setId(n.id)
      setName(n.name)
      setLive(!!n.live)
      setCells(cs)
      setSaved(JSON.stringify({ name: n.name, cells: n.cells.map(({ type, source }) => ({ type, source })) }))
      setSaveState('saved')
      setOuts({})
      setCurves([])
      setPred(null)
      setHasPredict(false)
      setActive(cs[0]?.uid ?? null)
      setEditingText(new Set())
      setMsg(null)
      setShowFiles(false)
    } catch (e) {
      fail(e)
    }
  }

  const create = async (tpl: NbTemplate | null, custom?: { name: string; cells: NbCell[] }) => {
    setMenu(null)
    const base = custom ? custom.name : tpl ? tpl.name : 'Modelo nuevo'
    let nid = slug(base)
    const used = new Set(list.map((n) => n.id))
    for (let i = 2; used.has(nid); i++) nid = `${slug(base)}-${i}`
    const body = {
      name: base,
      device_id: deviceId || null,
      cells: custom ? custom.cells : tpl ? tpl.cells : [{ type: 'text' as const, source: '# Modelo nuevo\nDescribe aquí qué quieres predecir.' }, { type: 'code' as const, source: 'df = simon.data()\ndf.tail()' }],
    }
    try {
      if (dirty) await persist(true)
      await nbSave(apiKey, nid, body)
      await refresh()
      setId('')
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
      let cs = parseImport(f.name.toLowerCase(), text)
      if (!f.name.toLowerCase().endsWith('.ipynb') || /def (train|predict)\b/.test(text)) cs = [...cs, { type: 'code', source: REGISTER_CELL }]
      await create(null, { name: f.name.replace(/\.(py|ipynb)$/i, '').slice(0, 60) || 'Importado', cells: cs })
      setMsg({ ok: true, text: 'Archivo importado. Ejecuta todo para entrenar y registrar el modelo.' })
    } catch (e) {
      fail(e)
    }
  }

  const remove = async () => {
    setMenu(null)
    if (!id || !window.confirm(`¿Borrar el cuaderno «${name}»? No se puede deshacer.`)) return
    try {
      await nbDelete(apiKey, id)
      setId('')
      setCells([])
      setSaved('')
      await refresh()
    } catch (e) {
      fail(e)
    }
  }

  const download = () => {
    setMenu(null)
    const url = URL.createObjectURL(new Blob([toPython(cells)], { type: 'text/x-python' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug(name)}.py`
    a.click()
    URL.revokeObjectURL(url)
  }

  // --- ejecución ---
  const run = async (uid: string): Promise<boolean> => {
    const cell = cells.find((c) => c.uid === uid)
    if (!cell || cell.type !== 'code') return true
    setRunning(uid)
    setMsg(null)
    try {
      if (dirty) await persist(true)
      const r = await nbRun(apiKey, id, cell.source)
      const n = counter + 1
      setCounter(n)
      setOuts((o) => ({ ...o, [uid]: { ...r, n } }))
      setHasPredict(r.has_predict || hasPredict)
      if (r.metrics.length) {
        const last = Object.fromEntries(Object.entries(r.metrics[r.metrics.length - 1]).filter(([k]) => k !== 'step')) as Record<string, number>
        const all = loadRuns()
        all[id] = { name, at: Date.now(), points: r.metrics.length, last }
        saveRuns(all)
        setRunsTick((t) => t + 1)
        const idx = cells.findIndex((c) => c.uid === uid)
        setCurves((c) => [...c, { label: `Celda ${idx + 1}`, rows: r.metrics }].slice(-5))
      }
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
    for (const c of cells) if (!(await run(c.uid))) break
  }

  const restart = async () => {
    try {
      await nbRestart(apiKey, id)
      setOuts({})
      setCounter(0)
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
      setList((l) => l.map((x) => (x.id === id ? { ...x, live: !live } : x)))
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

  // --- edición de celdas ---
  const setCell = (uid: string, p: Partial<NbCell>) => setCells((c) => c.map((x) => (x.uid === uid ? { ...x, ...p } : x)))
  const insertAt = (at: number, type: NbCell['type'], source = '') => {
    const cell = withUid({ type, source })
    pendingFocus.current = cell.uid
    setCells((c) => [...c.slice(0, at), cell, ...c.slice(at)])
    setActive(cell.uid)
    if (type === 'text') setEditingText((s) => new Set(s).add(cell.uid))
    return cell.uid
  }
  const move = (uid: string, d: number) =>
    setCells((c) => {
      const i = c.findIndex((x) => x.uid === uid)
      const j = i + d
      if (i < 0 || j < 0 || j >= c.length) return c
      const x = [...c]
      ;[x[i], x[j]] = [x[j], x[i]]
      return x
    })
  const duplicate = (uid: string) => {
    const i = cells.findIndex((c) => c.uid === uid)
    if (i >= 0) insertAt(i + 1, cells[i].type, cells[i].source)
  }
  const dropCell = (uid: string) => setCells((c) => c.filter((x) => x.uid !== uid))
  const retype = (uid: string) => {
    const c = cells.find((x) => x.uid === uid)
    if (!c) return
    setCell(uid, { type: c.type === 'code' ? 'text' : 'code' })
    setOuts((o) => { const n = { ...o }; delete n[uid]; return n })
    setEditingText((s) => { const n = new Set(s); n.delete(uid); return n })
  }

  const runFromEditor = async (uid: string, advance: boolean) => {
    const idx = cells.findIndex((c) => c.uid === uid)
    const cell = cells[idx]
    if (cell?.type === 'text') setEditingText((s) => { const n = new Set(s); n.delete(uid); return n })
    const ok = await run(uid)
    if (!advance || !ok) return
    const next = cells[idx + 1]
    if (next) {
      setActive(next.uid)
      if (next.type === 'text') setEditingText((s) => new Set(s).add(next.uid))
      requestAnimationFrame(() => focusers.current[next.uid]?.())
    } else insertAt(idx + 1, 'code')
  }

  const onRootKey = (e: ReactKeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (id) void persist(false)
    }
  }

  // ------------------------------------------------------------------------------------------
  if (!apiKey)
    return (
      <div className="adm-empty nb-locked">
        <div className="adm-empty-ico" aria-hidden="true">🔒</div>
        <h3>Laboratorio de modelos</h3>
        <p>Los cuadernos guardan código que corre en tu servidor, por eso piden la <b>API key</b>.</p>
        <button className="btn primary" onClick={onNeedKey}>Ingresar API key</button>
      </div>
    )

  const saveLabel = saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? 'Error al guardar' : dirty ? 'Cambios sin guardar' : 'Todos los cambios guardados'
  const liveCount = list.filter((n) => n.live).length

  return (
    <section className="nbs" onKeyDown={onRootKey}>
      {/* ---- lista de cuadernos ---- */}
      <aside className={'nbs-files' + (showFiles ? ' open' : '')} aria-label="Cuadernos">
        <div className="nbs-files-h">
          <b>Cuadernos</b>
          <div className="nbs-pop-wrap">
            <button className="btn primary sm" onClick={() => setMenu(menu === 'new' ? null : 'new')} aria-expanded={menu === 'new'}><Icon d={I.plus} /> Nuevo</button>
            {menu === 'new' && (
              <>
                <button className="nbs-backdrop" aria-label="Cerrar menú" onClick={() => setMenu(null)} />
                <div className="nbs-pop" role="menu">
                  <button role="menuitem" onClick={() => void create(null)}>Cuaderno en blanco</button>
                  {!!templates.length && <span className="nbs-pop-sep">Plantillas</span>}
                  {templates.map((t) => <button key={t.id} role="menuitem" onClick={() => void create(t)}>{t.name}</button>)}
                  <span className="nbs-pop-sep">Archivo</span>
                  <button role="menuitem" onClick={() => { setMenu(null); fileInput.current?.click() }}><Icon d={I.upload} /> Importar .py / .ipynb</button>
                </div>
              </>
            )}
          </div>
          <input ref={fileInput} type="file" accept=".py,.ipynb" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <ul className="nbs-list">
          {list.map((n) => (
            <li key={n.id}>
              <button className={n.id === id ? 'on' : ''} onClick={() => void open(n.id)} aria-current={n.id === id ? 'true' : undefined}>
                <span className="nbs-file-name">{n.id === id ? name || n.name : n.name}</span>
                <span className="nbs-file-meta">
                  {n.live && <span className="badge live">en vivo</span>}
                  {ago(n.updated_at)}
                </span>
              </button>
            </li>
          ))}
          {loaded && !list.length && <li className="nbs-none">Aún no tienes cuadernos. Crea el primero con «Nuevo».</li>}
          {!loaded && <li className="nbs-none">Cargando…</li>}
        </ul>
        {liveCount > 0 && <small className="muted nbs-foot">{liveCount} modelo{liveCount > 1 ? 's' : ''} aplicándose a los datos en vivo</small>}
      </aside>

      {/* ---- zona principal ---- */}
      <div className="nbs-main">
        {msg && (
          <div className={'adm-msg inline ' + (msg.ok ? 'ok' : 'bad')} role="status">
            <span>{msg.text}</span>
            <button className="adm-x" onClick={() => setMsg(null)} aria-label="Cerrar aviso">✕</button>
          </div>
        )}

        {!id ? (
          <div className="nbs-welcome">
            <button className="btn sm nbs-files-toggle" onClick={() => setShowFiles(true)}><Icon d={I.files} /> Cuadernos</button>
            <h2>Tu laboratorio de modelos</h2>
            <p className="muted">Un cuaderno es como Colab: celdas de Python que comparten variables, con tablas, gráficas y la curva de aprendizaje. Tus lecturas reales llegan con <code>simon.data()</code>.</p>
            <div className="nbs-tpl-grid">
              {templates.map((t) => (
                <button key={t.id} className="nbs-tpl" onClick={() => void create(t)}>
                  <b>{t.name}</b>
                  <span>{t.cells.find((c) => c.type === 'text')?.source.replace(/^#+\s*/, '').split('\n')[0] ?? `${t.cells.length} celdas`}</span>
                </button>
              ))}
              <button className="nbs-tpl blank" onClick={() => void create(null)}><b>+ En blanco</b><span>Empieza desde cero</span></button>
              <button className="nbs-tpl blank" onClick={() => fileInput.current?.click()}><b>Importar archivo</b><span>.py con «# %%» o .ipynb</span></button>
            </div>
            <div className="nbs-cheat">
              <h4>Atajos de la API</h4>
              <ul>
                <li><code>simon.log(epoca, perdida=…)</code> dibuja cómo aprende el modelo.</li>
                <li><code>@simon.register def predict(row): …</code> lo deja listo para usarse con la última lectura.</li>
                <li><code>simon.alert('warn', 'mensaje')</code> emite alertas desde el modelo.</li>
              </ul>
            </div>
          </div>
        ) : (
          <>
            <div className="nbs-bar">
              <button className="btn ghost sm nbs-files-toggle" onClick={() => setShowFiles(true)} aria-label="Ver cuadernos"><Icon d={I.files} /></button>
              <div className="nbs-title">
                <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del cuaderno" spellCheck={false} />
                <span className={'nbs-state ' + (dirty ? 'dirty' : saveState)} role="status">{saveLabel}</span>
              </div>
              <div className="nbs-actions">
                <button className="btn sm" onClick={() => insertAt(cells.length, 'code')}><Icon d={I.plus} /> Código</button>
                <button className="btn sm" onClick={() => insertAt(cells.length, 'text')}><Icon d={I.plus} /> Texto</button>
                <button className="btn primary sm" onClick={() => void runAll()} disabled={running !== null}><Icon d={I.play} /> Ejecutar todo</button>
                <button className="btn sm" onClick={() => void restart()} disabled={running !== null} title="Borra las variables y recarga las lecturas">Reiniciar kernel</button>
                <button className={'btn sm' + (live ? ' on' : '')} onClick={() => void toggleLive()} disabled={!hasPredict && !live} title={hasPredict || live ? '' : 'Ejecuta una celda con @simon.register primero'}>
                  <span className={'dot ' + (live ? 'ok' : '')} /> {live ? 'En vivo' : 'Activar en vivo'}
                </button>
                <div className="nbs-pop-wrap">
                  <button className="btn ghost sm" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="Más acciones" aria-expanded={menu === 'more'}><Icon d={I.menu} /></button>
                  {menu === 'more' && (
                    <>
                      <button className="nbs-backdrop" aria-label="Cerrar menú" onClick={() => setMenu(null)} />
                      <div className="nbs-pop right" role="menu">
                        <button role="menuitem" onClick={() => { setMenu(null); void persist(false) }} disabled={!dirty}>Guardar ahora <kbd>Ctrl S</kbd></button>
                        <button role="menuitem" onClick={download}>Descargar como .py</button>
                        <button role="menuitem" className="danger" onClick={() => void remove()}>Borrar cuaderno</button>
                      </div>
                    </>
                  )}
                </div>
                <button className={'btn ghost sm nbs-side-toggle' + (showSide ? ' on' : '')} onClick={() => setShowSide((s) => !s)} aria-pressed={showSide} aria-label="Panel del modelo" title="Panel del modelo"><Icon d={I.panel} /></button>
              </div>
            </div>

            <div className={'nbs-body' + (showSide ? ' with-side' : '')}>
              <div className="nbs-cells">
                <AddRow onCode={() => insertAt(0, 'code')} onText={() => insertAt(0, 'text')} always={!cells.length} />
                {cells.map((c, i) => {
                  const isRunning = running === c.uid
                  const out = outs[c.uid]
                  const rendered = c.type === 'text' && !editingText.has(c.uid) && c.source.trim() !== ''
                  return (
                    <Fragment key={c.uid}>
                      <div
                        className={'nbc ' + c.type + (isRunning ? ' running' : '') + (active === c.uid ? ' active' : '')}
                        onFocusCapture={() => setActive(c.uid)}
                        onClick={() => setActive(c.uid)}
                      >
                        <div className="nbc-gutter">
                          {c.type === 'code' ? (
                            <>
                              <button className="nbc-run" onClick={() => void run(c.uid)} disabled={running !== null} aria-label={`Ejecutar celda ${i + 1}`}>
                                {isRunning ? <span className="spin" /> : <Icon d={I.play} />}
                              </button>
                              <span className="nbc-n" aria-label="Orden de ejecución">[{isRunning ? '*' : out ? out.n : ' '}]</span>
                            </>
                          ) : <span className="nbc-n" aria-hidden="true">¶</span>}
                        </div>
                        <div className="nbc-body">
                          {rendered ? (
                            <div
                              className="nbc-md"
                              tabIndex={0}
                              role="button"
                              aria-label={`Nota ${i + 1}: doble clic o Enter para editar`}
                              onDoubleClick={() => setEditingText((s) => new Set(s).add(c.uid))}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditingText((s) => new Set(s).add(c.uid)); requestAnimationFrame(() => focusers.current[c.uid]?.()) } }}
                            >
                              <Markdown src={c.source} />
                            </div>
                          ) : (
                            <CodeEditor
                              value={c.source}
                              language={c.type === 'code' ? 'python' : 'markdown'}
                              placeholder={c.type === 'code' ? 'Escribe código Python…  (Mayús+Enter para ejecutar)' : 'Escribe una nota en Markdown…  (Mayús+Enter para terminar)'}
                              onChange={(v) => setCell(c.uid, { source: v })}
                              onRun={(adv) => void runFromEditor(c.uid, adv)}
                              onFocus={() => setActive(c.uid)}
                              ariaLabel={c.type === 'code' ? `Código de la celda ${i + 1}` : `Nota ${i + 1}`}
                              autoFocus={pendingFocus.current === c.uid}
                              registerFocus={(f) => { focusers.current[c.uid] = f }}
                            />
                          )}
                          {out && c.type === 'code' && <Output o={out} />}
                        </div>
                        <div className="nbc-tools" role="toolbar" aria-label={`Acciones de la celda ${i + 1}`}>
                          <button onClick={() => move(c.uid, -1)} disabled={i === 0} aria-label="Subir" title="Subir"><Icon d={I.up} /></button>
                          <button onClick={() => move(c.uid, 1)} disabled={i === cells.length - 1} aria-label="Bajar" title="Bajar"><Icon d={I.down} /></button>
                          <button onClick={() => duplicate(c.uid)} aria-label="Duplicar" title="Duplicar"><Icon d={I.copy} /></button>
                          <button onClick={() => retype(c.uid)} aria-label={c.type === 'code' ? 'Convertir en texto' : 'Convertir en código'} title={c.type === 'code' ? 'Convertir en texto' : 'Convertir en código'}><Icon d={I.swap} /></button>
                          <button className="danger" onClick={() => dropCell(c.uid)} aria-label="Quitar celda" title="Quitar celda"><Icon d={I.trash} /></button>
                        </div>
                      </div>
                      <AddRow onCode={() => insertAt(i + 1, 'code')} onText={() => insertAt(i + 1, 'text')} />
                    </Fragment>
                  )
                })}
                <small className="muted nbs-hint">Mayús+Enter ejecuta y pasa a la siguiente · Ctrl+Enter ejecuta y se queda · Ctrl+S guarda · el kernel conserva las variables hasta que lo reinicies.</small>
              </div>

              {showSide && (
                <aside className="nbs-side" aria-label="Panel del modelo">
                  <div className="nb-card">
                    <div className="nb-card-h">
                      <b>Modelo en uso</b>
                      <span className={'badge' + (live ? ' live' : '')}>{live ? 'en vivo' : hasPredict ? 'listo' : 'sin registrar'}</span>
                    </div>
                    <p className="muted">{hasPredict ? 'Hay un predict(row) registrado en este kernel.' : 'Ejecuta la celda con @simon.register para registrar predict(row).'}</p>
                    <div className="nb-card-actions">
                      <button className="btn sm" onClick={() => void probe()} disabled={!hasPredict}>Probar con la última lectura</button>
                      <button className={'btn sm' + (live ? ' on' : '')} onClick={() => void toggleLive()} disabled={!hasPredict && !live}>{live ? 'Desactivar en vivo' : 'Activar en vivo'}</button>
                    </div>
                    <small className="muted">En vivo: el servidor llama a predict(row) con cada estado. Sus <code>simon.alert()</code> salen en las alertas y si devuelve <code>{'{"overrides": {"vwc_pct": 31}}'}</code> ajusta esa lectura.</small>
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
                  <LearningCurve curves={curves} onClear={() => setCurves([])} />
                  <ModelCompare tick={runsTick} current={id} />
                </aside>
              )}
            </div>
          </>
        )}
      </div>
      {showFiles && <button className="nbs-scrim" aria-label="Cerrar lista de cuadernos" onClick={() => setShowFiles(false)} />}
    </section>
  )
}

function AddRow({ onCode, onText, always }: { onCode: () => void; onText: () => void; always?: boolean }) {
  return (
    <div className={'nbc-add' + (always ? ' always' : '')}>
      <button onClick={onCode}><Icon d={I.plus} /> Código</button>
      <button onClick={onText}><Icon d={I.plus} /> Texto</button>
    </div>
  )
}
