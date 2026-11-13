import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, commandActuator, getCatalog, getConfig, getDevices, getHardwarePreset, nbList, putConfig, type NbMeta } from '../api'
import type { DeviceInfo, DriverInfo } from '../types'
import { ActuatorsTab, DeviceTab, IndicatorsTab, SensorsTab, type Cfg } from './admin/ConfigTabs'
import { Overview, type SectionId } from './admin/Overview'
import { Icon } from './admin/ui'
import { NotebookPanel } from './NotebookPanel'

const NO_DISPLAY: Cfg['display'] = { enabled: false, driver: 'ssd1306_128x32', address: 60, show: [], rotate_s: 4 }
const KEY = 'simon.apikey'
const readKey = () => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

const NAV: { id: SectionId; label: string; short: string; icon: 'home' | 'sensor' | 'actuator' | 'formula' | 'chip' | 'lab' }[] = [
  { id: 'overview', label: 'Resumen', short: 'Resumen', icon: 'home' },
  { id: 'sensors', label: 'Sensores', short: 'Sensores', icon: 'sensor' },
  { id: 'actuators', label: 'Actuadores', short: 'Riego', icon: 'actuator' },
  { id: 'indicators', label: 'Indicadores', short: 'Fórmulas', icon: 'formula' },
  { id: 'device', label: 'ESP32 y cableado', short: 'ESP32', icon: 'chip' },
  { id: 'models', label: 'Modelos', short: 'Modelos', icon: 'lab' },
]
const CONFIG_SECTIONS: SectionId[] = ['sensors', 'actuators', 'indicators', 'device']

const sectionFromHash = (): SectionId => {
  const s = location.hash.replace(/^#\/admin\/?/, '').split(/[/?]/)[0] as SectionId
  return NAV.some((n) => n.id === s) ? s : 'overview'
}

export function AdminPanel() {
  const [apiKey, setApiKey] = useState(readKey)
  const [keyOpen, setKeyOpen] = useState(false)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [drivers, setDrivers] = useState<DriverInfo[]>([])
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [version, setVersion] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [section, setSection] = useState<SectionId>(sectionFromHash)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notebooks, setNotebooks] = useState<NbMeta[] | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const closeKey = useCallback(() => setKeyOpen(false), [])

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, apiKey)
    } catch {
      /* sin almacenamiento */
    }
  }, [apiKey])

  // La sección vive en el hash (#/admin/sensors): se puede enlazar y el botón Atrás funciona.
  useEffect(() => {
    const f = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  const go = useCallback((s: SectionId) => {
    location.hash = s === 'overview' ? '#/admin' : `#/admin/${s}`
    scroller.current?.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    getDevices().then((d) => {
      setDevices(d)
      setDeviceId((cur) => cur || (d.find((x) => x.device_id.startsWith('esp32')) ?? d[0])?.device_id || '')
    }).catch((e: Error) => setMsg({ ok: false, text: e.message }))
    getCatalog().then((c) => setDrivers(c.drivers)).catch(() => {})
  }, [])

  const load = useCallback(async (id: string) => {
    if (!id) return
    try {
      const c = await getConfig(id)
      const next: Cfg = { report_interval_s: c.report_interval_s, sensors: c.sensors, actuators: c.actuators, indicators: c.indicators, display: c.display ?? NO_DISPLAY }
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
    setMsg(null)
    void load(deviceId)
  }, [deviceId, load])

  // Cuadernos (para el resumen); se recargan al entrar al panel o cambiar la clave
  useEffect(() => {
    if (!apiKey) { setNotebooks(null); return }
    let off = false
    nbList(apiKey).then((l) => { if (!off) setNotebooks(l) }).catch(() => { if (!off) setNotebooks(null) })
    return () => { off = true }
  }, [apiKey, section])

  const dirty = cfg != null && JSON.stringify(cfg) !== saved
  useEffect(() => {
    if (!dirty) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [dirty])

  const sensorKeys = useMemo(() => (cfg?.sensors ?? []).filter((s) => s.enabled).map((s) => s.key), [cfg])
  const allVars = useMemo(() => [...sensorKeys, ...(cfg?.indicators ?? []).map((i) => i.key), 'vwc_pct', 'vpd_kpa'], [sensorKeys, cfg])
  const patch = (p: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...p } : c))

  const loadHardware = async () => {
    if (!cfg) return
    if (!window.confirm('Esto reemplaza los sensores, actuadores, indicadores y la pantalla por el hardware confirmado (aún no se guarda). ¿Continuar?')) return
    try {
      const h = await getHardwarePreset()
      patch({ report_interval_s: h.report_interval_s, sensors: h.sensors, actuators: h.actuators, indicators: h.indicators, display: h.display ?? NO_DISPLAY })
      setMsg({ ok: true, text: 'Hardware confirmado cargado. Revisa los pines y pulsa Guardar.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo cargar' })
    }
  }

  const save = async () => {
    if (!cfg) return
    if (!apiKey) return setKeyOpen(true)
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

  const test = async (key: string, seconds: number) => {
    try {
      await commandActuator(deviceId, key, seconds, apiKey)
      setMsg({ ok: true, text: seconds === 0 ? `Orden enviada: ${key} apagar.` : `Orden enviada: ${key} ${seconds === 1 ? 'abrir' : seconds + ' s'}.` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  const changeDevice = (id: string) => {
    if (dirty && !window.confirm('Tienes cambios sin guardar en este dispositivo. ¿Descartarlos y cambiar?')) return
    setDeviceId(id)
  }

  const device = devices.find((d) => d.device_id === deviceId)
  const current = NAV.find((n) => n.id === section)!
  const isConfig = CONFIG_SECTIONS.includes(section)

  return (
    <div className="admin">
      <nav className="adm-nav" aria-label="Secciones">
        <a href="#/" className="adm-brand" aria-label="Volver al gemelo">
          <span className="adm-brand-ico"><Icon name="back" size={16} /></span>
          <span><b>Simón</b><small>Configuración</small></span>
        </a>
        <ul>
          {NAV.map((n) => {
            const count = n.id === 'sensors' ? cfg?.sensors.length : n.id === 'actuators' ? cfg?.actuators.length : n.id === 'indicators' ? cfg?.indicators.length : undefined
            return (
              <li key={n.id}>
                <button type="button" className={section === n.id ? 'on' : ''} onClick={() => go(n.id)} aria-current={section === n.id ? 'page' : undefined}>
                  <Icon name={n.icon} />
                  <span className="lbl">{n.label}</span>
                  <span className="lbl-s">{n.short}</span>
                  {count != null && <span className="cnt">{count}</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <button type="button" className={'adm-keybtn' + (apiKey ? ' set' : '')} onClick={() => setKeyOpen(true)}>
          <Icon name="key" />
          <span className="lbl">{apiKey ? 'API key lista' : 'Falta la API key'}</span>
        </button>
      </nav>

      <div className="adm-content" ref={scroller}>
        <header className="adm-top">
          <div className="adm-top-t">
            <a href="#/" className="adm-back" aria-label="Volver al gemelo"><Icon name="back" size={16} /> Gemelo</a>
            <h1 className="sr-only">Configuración · {current.label}</h1>
            <span className="adm-status" role="status">
              <span className={'dot ' + (device ? (device.online ? 'ok' : 'bad') : '')} />
              <b>{device?.name || device?.device_id || 'Sin dispositivo'}</b>
              {device && <span className="muted">{device.online ? 'en línea' : 'sin conexión'}</span>}
            </span>
          </div>
          <label className="adm-dev">
            <span>Dispositivo</span>
            <select value={deviceId} onChange={(e) => changeDevice(e.target.value)} disabled={!devices.length}>
              {!devices.length && <option value="">Sin dispositivos</option>}
              {devices.map((d) => <option key={d.device_id} value={d.device_id}>{d.name ? `${d.name} (${d.device_id})` : d.device_id}</option>)}
            </select>
          </label>
          <button type="button" className={'adm-keychip' + (apiKey ? ' set' : '')} onClick={() => setKeyOpen(true)}>
            <Icon name="key" size={16} /> {apiKey ? 'API key' : 'Ingresar API key'}
          </button>
        </header>

        {msg && section !== 'models' && (
          <div className={'adm-msg ' + (msg.ok ? 'ok' : 'bad')} role="status">
            <span>{msg.text}</span>
            <button type="button" className="adm-x" onClick={() => setMsg(null)} aria-label="Cerrar aviso">✕</button>
          </div>
        )}
        {!!warnings.length && isConfig && (
          <div className="adm-msg warn" role="status">
            <div><b>Revisa el cableado:</b><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
          </div>
        )}

        <main className={'adm-main' + (section === 'models' ? ' wide' : '')}>
          {section === 'overview' && (
            <Overview device={device} cfg={cfg} version={version} warnings={warnings} notebooks={notebooks} hasKey={!!apiKey} onGo={go} onNeedKey={() => setKeyOpen(true)} />
          )}
          {section === 'models' && <NotebookPanel apiKey={apiKey} deviceId={deviceId} onNeedKey={() => setKeyOpen(true)} />}
          {isConfig && !cfg && <p className="muted adm-loading">Cargando la configuración del dispositivo…</p>}
          {isConfig && cfg && (
            <>
              {section === 'sensors' && <SensorsTab cfg={cfg} patch={patch} drivers={drivers} onLoadHardware={loadHardware} />}
              {section === 'actuators' && <ActuatorsTab cfg={cfg} patch={patch} drivers={drivers} sensorKeys={sensorKeys} apiKey={apiKey} dirty={dirty} onTest={test} onNeedKey={() => setKeyOpen(true)} />}
              {section === 'indicators' && <IndicatorsTab cfg={cfg} patch={patch} allVars={allVars} sensorKeys={sensorKeys} />}
              {section === 'device' && <DeviceTab cfg={cfg} patch={patch} version={version} />}
            </>
          )}
        </main>

        {isConfig && cfg && dirty && (
          <div className="adm-savebar" role="region" aria-label="Cambios sin guardar">
            <span><i className="pulse" /> Cambios sin guardar</span>
            <button type="button" className="btn ghost sm" onClick={() => void load(deviceId)} disabled={busy}>Descartar</button>
            <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Guardando…' : apiKey ? 'Guardar cambios' : 'Ingresar API key para guardar'}</button>
          </div>
        )}
      </div>

      {keyOpen && <KeyDialog value={apiKey} onChange={setApiKey} onClose={closeKey} />}
    </div>
  )
}

/** Diálogo para la API key: se comprueba contra el servidor antes de cerrar. */
function KeyDialog({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value)
  const [show, setShow] = useState(false)
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])

  const submit = async () => {
    const k = draft.trim()
    onChange(k)
    if (!k) return onClose()
    setChecking(true)
    setState(null)
    try {
      await nbList(k)
      setState({ ok: true, text: 'Clave válida.' })
      window.setTimeout(onClose, 500)
    } catch (e) {
      // Sin cuadernos en el servidor (404) la clave igual pudo ser correcta: se guarda y se avisa.
      if (e instanceof ApiError && e.status === 401) setState({ ok: false, text: 'El servidor no reconoce esa clave. Revisa API_KEY en tu .env.' })
      else setState({ ok: true, text: 'Clave guardada (no se pudo comprobar con el servidor).' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="dlg-wrap" role="presentation">
      <button type="button" className="dlg-scrim" aria-label="Cerrar" onClick={onClose} />
      <form className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <h2 id="dlg-t">API key</h2>
        <p className="muted">Se pide para guardar la configuración, probar actuadores y usar los modelos. Vive solo en esta pestaña (se borra al cerrarla).</p>
        <label className="fld">
          <span>Clave</span>
          <div className="fld-row">
            <input ref={input} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="La misma API_KEY del servidor" />
            <button type="button" className="btn sm" onClick={() => setShow((s) => !s)}>{show ? 'Ocultar' : 'Mostrar'}</button>
          </div>
        </label>
        {state && <p className={'dlg-state ' + (state.ok ? 'ok' : 'bad')} role="status">{state.text}</p>}
        <div className="dlg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={checking}>{checking ? 'Comprobando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  )
}
