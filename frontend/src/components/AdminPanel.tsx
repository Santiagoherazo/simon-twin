import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, commandActuator, getCatalog, getConfig, getDevices, getHardwarePreset, putConfig } from '../api'
import { NotebookPanel } from './NotebookPanel'
import type { ActuatorCfg, DeviceConfigFull, DeviceInfo, DriverInfo, IndicatorCfg, SensorCfg, SensorDriver } from '../types'

const KEY = 'simon.apikey'
const readKey = () => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

type Tab = 'sensors' | 'actuators' | 'indicators' | 'device' | 'models'
type Cfg = Pick<DeviceConfigFull, 'report_interval_s' | 'sensors' | 'actuators' | 'indicators'>

const num = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v))
const val = (v: number | null | undefined) => (v == null ? '' : String(v))

const mkSensor = (p: Partial<SensorCfg> & Pick<SensorCfg, 'key' | 'label' | 'driver'>): SensorCfg => ({
  pin: null, param: null, unit: '', scale: 1, offset: 0, sim_min: null, sim_max: null, min_ok: null, max_ok: null, enabled: true, ...p,
})

/** Plantillas para agregar sensores sin escribir todo a mano. */
const PRESETS: { id: string; label: string; make: () => SensorCfg[] }[] = [
  { id: 'soil', label: 'Humedad del suelo (capacitivo, ADC)', make: () => [mkSensor({ key: 'vwc_raw', label: 'Humedad suelo (ADC)', driver: 'analog', pin: 33 })] },
  { id: 'dht', label: 'Temperatura y humedad del aire (DHT22)', make: () => [
    mkSensor({ key: 'air_t', label: 'Temp. aire', driver: 'dht_t', pin: 4, param: 22, unit: '°C', min_ok: 15, max_ok: 32 }),
    mkSensor({ key: 'air_rh', label: 'Humedad aire', driver: 'dht_h', pin: 4, param: 22, unit: '%', min_ok: 40, max_ok: 85 }),
  ] },
  { id: 'ds', label: 'Temperatura del suelo (DS18B20)', make: () => [mkSensor({ key: 'soil_t', label: 'Temp. suelo', driver: 'ds18b20', pin: 5, unit: '°C', min_ok: 15, max_ok: 28 })] },
  { id: 'lux', label: 'Luz (BH1750, I2C)', make: () => [mkSensor({ key: 'lux', label: 'Luz', driver: 'bh1750', param: 35, unit: 'lx' })] },
  { id: 'ldr4', label: 'Matriz de luz: 4 fotorresistencias (esquinas)', make: () => [
    mkSensor({ key: 'ldr_nw', label: 'Luz esquina NO', driver: 'analog', pin: 32, unit: '%', scale: 100 / 4095, min_ok: 15 }),
    mkSensor({ key: 'ldr_ne', label: 'Luz esquina NE', driver: 'analog', pin: 33, unit: '%', scale: 100 / 4095, min_ok: 15 }),
    mkSensor({ key: 'ldr_sw', label: 'Luz esquina SO', driver: 'analog', pin: 34, unit: '%', scale: 100 / 4095, min_ok: 15 }),
    mkSensor({ key: 'ldr_se', label: 'Luz esquina SE', driver: 'analog', pin: 35, unit: '%', scale: 100 / 4095, min_ok: 15 }),
  ] },
  { id: 'tank', label: 'Nivel de tanque (digital)', make: () => [mkSensor({ key: 'tank_ok', label: 'Tanque con agua', driver: 'digital', pin: 17 })] },
  { id: 'custom', label: 'Personalizado (analógico, p. ej. CO₂)', make: () => [mkSensor({ key: 'variable', label: 'Nueva variable', driver: 'analog', pin: 32 })] },
  { id: 'sim', label: 'Simulado (sin hardware)', make: () => [mkSensor({ key: 'simulada', label: 'Simulada', driver: 'simulated', sim_min: 0, sim_max: 100 })] },
]

function uniqueKey(base: string, used: Set<string>) {
  let k = base
  for (let i = 2; used.has(k); i++) k = `${base}_${i}`
  return k
}

export function AdminPanel() {
  const [apiKey, setApiKey] = useState(readKey)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [drivers, setDrivers] = useState<DriverInfo[]>([])
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [version, setVersion] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>('sensors')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, apiKey)
    } catch {
      /* sin almacenamiento */
    }
  }, [apiKey])

  useEffect(() => {
    getDevices().then((d) => {
      setDevices(d)
      setDeviceId((cur) => cur || (d.find((x) => x.device_id.startsWith('esp32')) ?? d[0])?.device_id || '')
    }).catch((e: Error) => setMsg({ ok: false, text: e.message }))
    getCatalog().then((c) => setDrivers(c.drivers)).catch(() => {})
  }, [])

  const load = useCallback(async (id: string) => {
    if (!id) return
    setMsg(null)
    try {
      const c = await getConfig(id)
      const next: Cfg = { report_interval_s: c.report_interval_s, sensors: c.sensors, actuators: c.actuators, indicators: c.indicators }
      setCfg(next)
      setSaved(JSON.stringify(next))
      setVersion(c.version)
      setWarnings(c.warnings ?? [])
    } catch (e) {
      setCfg(null)
      setMsg({ ok: false, text: (e as Error).message })
    }
  }, [])
  useEffect(() => {
    void load(deviceId)
  }, [deviceId, load])

  const dirty = cfg != null && JSON.stringify(cfg) !== saved
  const sensorDrivers = drivers.filter((d) => d.kind === 'sensor')
  const actuatorDrivers = drivers.filter((d) => d.kind === 'actuator')
  const drv = (name: string) => drivers.find((d) => d.driver === name)
  const sensorKeys = useMemo(() => (cfg?.sensors ?? []).filter((s) => s.enabled).map((s) => s.key), [cfg])
  const allVars = useMemo(
    () => [...sensorKeys, ...(cfg?.indicators ?? []).map((i) => i.key), 'vwc_pct', 'vpd_kpa'],
    [sensorKeys, cfg],
  )

  const patch = (p: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...p } : c))
  const setSensor = (i: number, p: Partial<SensorCfg>) => patch({ sensors: cfg!.sensors.map((s, k) => (k === i ? { ...s, ...p } : s)) })
  const setAct = (i: number, p: Partial<ActuatorCfg>) => patch({ actuators: cfg!.actuators.map((s, k) => (k === i ? { ...s, ...p } : s)) })
  const setInd = (i: number, p: Partial<IndicatorCfg>) => patch({ indicators: cfg!.indicators.map((s, k) => (k === i ? { ...s, ...p } : s)) })

  const addPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset || !cfg) return
    const used = new Set([...cfg.sensors.map((s) => s.key), ...cfg.indicators.map((i) => i.key)])
    const add = preset.make().map((s) => {
      const key = uniqueKey(s.key, used)
      used.add(key)
      return { ...s, key }
    })
    patch({ sensors: [...cfg.sensors, ...add] })
  }

  const loadHardware = async () => {
    if (!cfg) return
    if (!window.confirm('Esto reemplaza los sensores, actuadores e indicadores de la lista por el hardware confirmado (aún no se guarda). ¿Continuar?')) return
    try {
      const h = await getHardwarePreset()
      patch({ report_interval_s: h.report_interval_s, sensors: h.sensors, actuators: h.actuators, indicators: h.indicators })
      setMsg({ ok: true, text: 'Hardware confirmado cargado. Revisa los pines y pulsa Guardar.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo cargar' })
    }
  }

  const save = async () => {
    if (!cfg) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await putConfig(deviceId, cfg, apiKey)
      setWarnings(r.warnings)
      setVersion(r.version)
      setSaved(JSON.stringify(cfg))
      setMsg({ ok: true, text: `Guardado (versión ${r.version}). El ESP32 la aplica en menos de 30 s, sin reflashear.` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'No se pudo guardar.' })
    } finally {
      setBusy(false)
    }
  }

  const test = async (key: string) => {
    try {
      await commandActuator(deviceId, key, 5, apiKey)
      setMsg({ ok: true, text: `Orden enviada: ${key} 5 s.` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  /** Lo que recibirá el ESP32 (solo lo activo; los indicadores los calcula el servidor). */
  const espJson = useMemo(
    () =>
      cfg
        ? JSON.stringify({ version, report_interval_s: cfg.report_interval_s, sensors: cfg.sensors.filter((s) => s.enabled), actuators: cfg.actuators.filter((a) => a.enabled) }, null, 1)
        : '',
    [cfg, version],
  )

  const wiring = useMemo(() => {
    const rows: { pin: string; who: string; kind: string }[] = []
    cfg?.sensors.filter((s) => s.enabled).forEach((s) => {
      if (s.driver === 'bh1750') rows.push({ pin: 'GPIO 21/22 (I2C)', who: s.label, kind: 'BH1750' })
      else if (s.driver !== 'simulated') rows.push({ pin: s.pin == null ? '—' : `GPIO ${s.pin}`, who: s.label, kind: s.driver })
    })
    cfg?.actuators.filter((a) => a.enabled).forEach((a) => rows.push({ pin: a.pin == null ? 'virtual' : `GPIO ${a.pin}`, who: a.label, kind: a.driver }))
    return rows
  }, [cfg])

  return (
    <div className="admin">
      <header className="admin-head">
        <a href="#/" className="btn ghost">← Gemelo</a>
        <h1>Panel administrativo</h1>
        <label className="adm-f">
          Dispositivo
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((d) => (
              <option key={d.device_id} value={d.device_id}>{d.device_id}</option>
            ))}
          </select>
        </label>
        <label className="adm-f">
          API key
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="para guardar y probar" />
        </label>
      </header>

      {msg && <div className={'adm-msg ' + (msg.ok ? 'ok' : 'bad')} role="status">{msg.text}</div>}
      {!!warnings.length && (
        <div className="adm-msg warn" role="status">
          <b>Revisa el cableado:</b>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="adm-layout">
        <nav className="adm-tabs" aria-label="Secciones">
          {([['sensors', 'Sensores', cfg?.sensors.length], ['actuators', 'Actuadores', cfg?.actuators.length], ['indicators', 'Indicadores', cfg?.indicators.length], ['device', 'ESP32 y cableado', undefined], ['models', 'Modelos', undefined]] as [Tab, string, number | undefined][]).map(([t, l, n]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
              {l}{n != null && <span className="cnt">{n}</span>}
            </button>
          ))}
        </nav>
        <main className="adm-main">
          {tab === 'models' && <NotebookPanel apiKey={apiKey} deviceId={deviceId} />}
          {tab !== 'models' && !cfg && <p className="muted">Cargando la configuración del dispositivo…</p>}
          {tab !== 'models' && cfg && (
        <>
          {tab === 'sensors' && (
            <section>
              <div className="adm-bar">
                <select value="" onChange={(e) => { addPreset(e.target.value); e.target.value = '' }} aria-label="Agregar sensor">
                  <option value="">+ Agregar sensor…</option>
                  {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button type="button" className="btn" onClick={loadHardware}>Cargar hardware confirmado</button>
              </div>
              {cfg.sensors.map((s, i) => {
                const d = drv(s.driver)
                return (
                  <div className={'adm-card' + (s.enabled ? '' : ' off')} key={i}>
                    <div className="adm-row">
                      <label className="chk"><input type="checkbox" checked={s.enabled} onChange={(e) => setSensor(i, { enabled: e.target.checked })} /> activo</label>
                      <label className="adm-f">Variable<input value={s.key} onChange={(e) => setSensor(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></label>
                      <label className="adm-f">Nombre<input value={s.label} onChange={(e) => setSensor(i, { label: e.target.value })} /></label>
                      <label className="adm-f">Tipo
                        <select value={s.driver} onChange={(e) => setSensor(i, { driver: e.target.value as SensorDriver })}>
                          {sensorDrivers.map((x) => <option key={x.driver} value={x.driver}>{x.label}</option>)}
                        </select>
                      </label>
                      {d?.needs_pin && <label className="adm-f sm">Pin<input type="number" value={val(s.pin)} onChange={(e) => setSensor(i, { pin: num(e.target.value) })} /></label>}
                      {(s.driver === 'dht_t' || s.driver === 'dht_h' || s.driver === 'bh1750') && (
                        <label className="adm-f sm">{s.driver === 'bh1750' ? 'Dir. I2C' : 'Modelo'}<input type="number" value={val(s.param)} onChange={(e) => setSensor(i, { param: num(e.target.value) })} /></label>
                      )}
                      <label className="adm-f sm">Unidad<input value={s.unit} onChange={(e) => setSensor(i, { unit: e.target.value })} /></label>
                      <button className="btn danger" onClick={() => patch({ sensors: cfg.sensors.filter((_, k) => k !== i) })} aria-label={`Quitar ${s.key}`}>Quitar</button>
                    </div>
                    <div className="adm-row sub">
                      <span className="adm-sub">Calibración y rangos</span>
                      <label className="adm-f sm">Escala<input type="number" step="any" value={s.scale} onChange={(e) => setSensor(i, { scale: Number(e.target.value) || 0 })} /></label>
                      <label className="adm-f sm">Desplaz.<input type="number" step="any" value={s.offset} onChange={(e) => setSensor(i, { offset: Number(e.target.value) || 0 })} /></label>
                      {s.driver === 'simulated' && (
                        <>
                          <label className="adm-f sm">Sim. mín<input type="number" step="any" value={val(s.sim_min)} onChange={(e) => setSensor(i, { sim_min: num(e.target.value) })} /></label>
                          <label className="adm-f sm">Sim. máx<input type="number" step="any" value={val(s.sim_max)} onChange={(e) => setSensor(i, { sim_max: num(e.target.value) })} /></label>
                        </>
                      )}
                      <label className="adm-f sm">Ideal mín<input type="number" step="any" value={val(s.min_ok)} onChange={(e) => setSensor(i, { min_ok: num(e.target.value) })} /></label>
                      <label className="adm-f sm">Ideal máx<input type="number" step="any" value={val(s.max_ok)} onChange={(e) => setSensor(i, { max_ok: num(e.target.value) })} /></label>
                    </div>
                    {d && <small className="muted">{d.help}</small>}
                  </div>
                )
              })}
              {!cfg.sensors.length && <p className="muted">Sin sensores. Agrega uno con la lista de arriba.</p>}
            </section>
          )}

          {tab === 'actuators' && (
            <section>
              <div className="adm-bar">
                <button className="btn" onClick={() => {
                  const used = new Set(cfg.actuators.map((a) => a.key))
                  patch({ actuators: [...cfg.actuators, { key: uniqueKey('actuador', used), label: 'Nuevo actuador', driver: 'relay', pin: 26, active_high: true, max_seconds: 120, auto_variable: null, auto_on_below: null, auto_on_above: null, auto_off_at: null, auto_seconds: 30, cooldown_s: 600, enabled: true }] })
                }}>+ Agregar actuador</button>
              </div>
              {cfg.actuators.map((a, i) => {
                const rule = a.auto_variable != null
                const below = a.auto_on_below != null
                return (
                  <div className={'adm-card' + (a.enabled ? '' : ' off')} key={i}>
                    <div className="adm-row">
                      <label className="chk"><input type="checkbox" checked={a.enabled} onChange={(e) => setAct(i, { enabled: e.target.checked })} /> activo</label>
                      <label className="adm-f">Clave<input value={a.key} onChange={(e) => setAct(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></label>
                      <label className="adm-f">Nombre<input value={a.label} onChange={(e) => setAct(i, { label: e.target.value })} /></label>
                      <label className="adm-f">Tipo
                        <select value={a.driver} onChange={(e) => setAct(i, { driver: e.target.value as ActuatorCfg['driver'] })}>
                          {actuatorDrivers.map((x) => <option key={x.driver} value={x.driver}>{x.label}</option>)}
                        </select>
                      </label>
                      <label className="adm-f sm">Pin<input type="number" placeholder="virtual" value={val(a.pin)} onChange={(e) => setAct(i, { pin: num(e.target.value) })} /></label>
                      <label className="chk"><input type="checkbox" checked={a.active_high} onChange={(e) => setAct(i, { active_high: e.target.checked })} /> activo en alto</label>
                      <label className="adm-f sm">Tope (s)<input type="number" value={a.max_seconds} onChange={(e) => setAct(i, { max_seconds: Number(e.target.value) || 1 })} /></label>
                      <button className="btn" onClick={() => test(a.key)} disabled={!apiKey || dirty} title={dirty ? 'Guarda primero' : 'Enciende 5 s'}>Probar 5 s</button>
                      <button className="btn danger" onClick={() => patch({ actuators: cfg.actuators.filter((_, k) => k !== i) })}>Quitar</button>
                    </div>
                    <div className="adm-row">
                      <label className="chk">
                        <input type="checkbox" checked={rule} onChange={(e) => setAct(i, e.target.checked ? { auto_variable: sensorKeys[0] ?? null, auto_on_below: 0, auto_on_above: null } : { auto_variable: null, auto_on_below: null, auto_on_above: null, auto_off_at: null })} />
                        riego/acción automática (funciona aunque no haya nube)
                      </label>
                      {rule && (
                        <>
                          <label className="adm-f">Cuando<select value={a.auto_variable ?? ''} onChange={(e) => setAct(i, { auto_variable: e.target.value })}>{sensorKeys.map((k) => <option key={k}>{k}</option>)}</select></label>
                          <label className="adm-f sm">esté
                            <select value={below ? 'below' : 'above'} onChange={(e) => setAct(i, e.target.value === 'below' ? { auto_on_below: a.auto_on_above ?? 0, auto_on_above: null } : { auto_on_above: a.auto_on_below ?? 0, auto_on_below: null })}>
                              <option value="below">debajo de</option>
                              <option value="above">encima de</option>
                            </select>
                          </label>
                          <label className="adm-f sm">Valor<input type="number" step="any" value={val(below ? a.auto_on_below : a.auto_on_above)} onChange={(e) => setAct(i, below ? { auto_on_below: num(e.target.value) } : { auto_on_above: num(e.target.value) })} /></label>
                          <label className="adm-f sm">Cortar en<input type="number" step="any" value={val(a.auto_off_at)} onChange={(e) => setAct(i, { auto_off_at: num(e.target.value) })} /></label>
                          <label className="adm-f sm">Dura (s)<input type="number" value={a.auto_seconds} onChange={(e) => setAct(i, { auto_seconds: Number(e.target.value) || 1 })} /></label>
                          <label className="adm-f sm">Espera (s)<input type="number" value={a.cooldown_s} onChange={(e) => setAct(i, { cooldown_s: Number(e.target.value) || 0 })} /></label>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              {!cfg.actuators.length && <p className="muted">Sin actuadores.</p>}
            </section>
          )}

          {tab === 'indicators' && (
            <section>
              <p className="muted">Un indicador es una fórmula sobre las variables (se calcula en el servidor con cada lectura y se guarda). Funciones: min, max, abs, round, sqrt, exp, log, pow. Ej.: <code>air_t - soil_t</code></p>
              <div className="adm-bar">
                <button className="btn" onClick={() => {
                  const used = new Set([...cfg.sensors.map((s) => s.key), ...cfg.indicators.map((n) => n.key)])
                  patch({ indicators: [...cfg.indicators, { key: uniqueKey('indicador', used), label: 'Nuevo indicador', formula: sensorKeys[0] ?? '1', unit: '', min_ok: null, max_ok: null, enabled: true }] })
                }}>+ Agregar indicador</button>
              </div>
              {cfg.indicators.map((n, i) => (
                <div className={'adm-card' + (n.enabled ? '' : ' off')} key={i}>
                  <div className="adm-row">
                    <label className="chk"><input type="checkbox" checked={n.enabled} onChange={(e) => setInd(i, { enabled: e.target.checked })} /> activo</label>
                    <label className="adm-f">Clave<input value={n.key} onChange={(e) => setInd(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></label>
                    <label className="adm-f">Nombre<input value={n.label} onChange={(e) => setInd(i, { label: e.target.value })} /></label>
                    <label className="adm-f grow">Fórmula<input value={n.formula} onChange={(e) => setInd(i, { formula: e.target.value })} spellCheck={false} /></label>
                    <label className="adm-f sm">Unidad<input value={n.unit} onChange={(e) => setInd(i, { unit: e.target.value })} /></label>
                    <label className="adm-f sm">Ideal mín<input type="number" step="any" value={val(n.min_ok)} onChange={(e) => setInd(i, { min_ok: num(e.target.value) })} /></label>
                    <label className="adm-f sm">Ideal máx<input type="number" step="any" value={val(n.max_ok)} onChange={(e) => setInd(i, { max_ok: num(e.target.value) })} /></label>
                    <button className="btn danger" onClick={() => patch({ indicators: cfg.indicators.filter((_, k) => k !== i) })}>Quitar</button>
                  </div>
                  <div className="chips">
                    {allVars.filter((v) => v !== n.key).map((v) => (
                      <button key={v} className="chip-btn" onClick={() => setInd(i, { formula: (n.formula + ' ' + v).trim() })}>{v}</button>
                    ))}
                  </div>
                </div>
              ))}
              {!cfg.indicators.length && <p className="muted">Sin indicadores.</p>}
            </section>
          )}

          {tab === 'device' && (
            <section>
              <div className="adm-card">
                <div className="adm-row">
                  <label className="adm-f sm">Enviar cada (s)<input type="number" min={2} value={cfg.report_interval_s} onChange={(e) => patch({ report_interval_s: Math.max(2, Number(e.target.value) || 2) })} /></label>
                  <span className="muted">Versión de la configuración: <b>{version}</b></span>
                </div>
                <small className="muted">El ESP32 consulta cada 30 s; si hay una versión nueva la aplica y la guarda en su memoria (funciona también sin internet).</small>
              </div>
              <h3>Cableado</h3>
              <table className="adm-table">
                <thead><tr><th>Pin</th><th>Qué es</th><th>Tipo</th></tr></thead>
                <tbody>{wiring.map((w, i) => <tr key={i}><td>{w.pin}</td><td>{w.who}</td><td>{w.kind}</td></tr>)}</tbody>
              </table>
              <h3>Lo que recibe el ESP32</h3>
              <pre className="adm-json">{espJson}</pre>
            </section>
          )}

        </>
          )}
        </main>
      </div>
      {tab !== 'models' && cfg && (
        <footer className="adm-foot">
          <button className="btn primary" onClick={save} disabled={!dirty || busy || !apiKey}>{busy ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Sin cambios'}</button>
          {dirty && <button className="btn ghost" onClick={() => void load(deviceId)}>Descartar</button>}
          {!apiKey && <small className="muted">Escribe la API key para guardar.</small>}
        </footer>
      )}
    </div>
  )
}
