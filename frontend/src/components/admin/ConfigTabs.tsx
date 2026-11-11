import { useMemo, useState, type ReactNode } from 'react'
import type { ActuatorCfg, DeviceConfigFull, DriverInfo, IndicatorCfg, SensorCfg, SensorDriver } from '../../types'
import { cleanKey, Field, Icon, num, Section, Switch, uniqueKey, val } from './ui'

export type Cfg = Pick<DeviceConfigFull, 'report_interval_s' | 'sensors' | 'actuators' | 'indicators'>

const mkSensor = (p: Partial<SensorCfg> & Pick<SensorCfg, 'key' | 'label' | 'driver'>): SensorCfg => ({
  pin: null, param: null, unit: '', scale: 1, offset: 0, sim_min: null, sim_max: null, min_ok: null, max_ok: null, enabled: true, ...p,
})

/** Plantillas para agregar sensores sin escribir todo a mano. */
const PRESETS: { id: string; label: string; hint: string; make: () => SensorCfg[] }[] = [
  { id: 'soil', label: 'Humedad del suelo', hint: 'Capacitivo, entrada analógica', make: () => [mkSensor({ key: 'vwc_raw', label: 'Humedad suelo (ADC)', driver: 'analog', pin: 33 })] },
  { id: 'dht', label: 'Temperatura y humedad del aire', hint: 'DHT22 · crea 2 variables', make: () => [
    mkSensor({ key: 'air_t', label: 'Temp. aire', driver: 'dht_t', pin: 4, param: 22, unit: '°C', min_ok: 15, max_ok: 32 }),
    mkSensor({ key: 'air_rh', label: 'Humedad aire', driver: 'dht_h', pin: 4, param: 22, unit: '%', min_ok: 40, max_ok: 85 }),
  ] },
  { id: 'ds', label: 'Temperatura del suelo', hint: 'DS18B20', make: () => [mkSensor({ key: 'soil_t', label: 'Temp. suelo', driver: 'ds18b20', pin: 5, unit: '°C', min_ok: 15, max_ok: 28 })] },
  { id: 'lux', label: 'Luz', hint: 'BH1750 por I2C', make: () => [mkSensor({ key: 'lux', label: 'Luz', driver: 'bh1750', param: 35, unit: 'lx' })] },
  { id: 'ldr4', label: 'Matriz de luz', hint: '4 fotorresistencias en las esquinas', make: () => [
    mkSensor({ key: 'ldr_nw', label: 'Luz esquina NO', driver: 'analog', pin: 32, unit: '%', scale: 100 / 4095, min_ok: 15 }),
    mkSensor({ key: 'ldr_ne', label: 'Luz esquina NE', driver: 'analog', pin: 33, unit: '%', scale: 100 / 4095, min_ok: 15 }),
    mkSensor({ key: 'ldr_sw', label: 'Luz esquina SO', driver: 'analog', pin: 34, unit: '%', scale: 100 / 4095, min_ok: 15 }),
    mkSensor({ key: 'ldr_se', label: 'Luz esquina SE', driver: 'analog', pin: 35, unit: '%', scale: 100 / 4095, min_ok: 15 }),
  ] },
  { id: 'tank', label: 'Nivel de tanque', hint: 'Entrada digital', make: () => [mkSensor({ key: 'tank_ok', label: 'Tanque con agua', driver: 'digital', pin: 17 })] },
  { id: 'custom', label: 'Personalizado', hint: 'Analógico, p. ej. CO₂', make: () => [mkSensor({ key: 'variable', label: 'Nueva variable', driver: 'analog', pin: 32 })] },
  { id: 'sim', label: 'Simulado', hint: 'Sin hardware, valores de prueba', make: () => [mkSensor({ key: 'simulada', label: 'Simulada', driver: 'simulated', sim_min: 0, sim_max: 100 })] },
]

interface Common {
  cfg: Cfg
  patch: (p: Partial<Cfg>) => void
}

const range = (min: number | null, max: number | null, unit: string) =>
  min == null && max == null ? '' : `ideal ${min ?? '…'}–${max ?? '…'}${unit ? ' ' + unit : ''}`

/** Tarjeta plegable: lo esencial a la vista, el detalle al desplegar. */
function Card({ on, head, summary, actions, children, startOpen = false }: { on: boolean; head: ReactNode; summary: string; actions: ReactNode; children: ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <article className={'cfg-card' + (on ? '' : ' off') + (open ? ' open' : '')}>
      <div className="cfg-card-h">
        {head}
        <button type="button" className="cfg-sum" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span>{summary}</span>
          <Icon name="chevron" size={16} />
        </button>
        <div className="cfg-card-a">{actions}</div>
      </div>
      {open && <div className="cfg-card-b">{children}</div>}
    </article>
  )
}

// ------------------------------------------------------------------------------------------ Sensores
export function SensorsTab({ cfg, patch, drivers, onLoadHardware }: Common & { drivers: DriverInfo[]; onLoadHardware: () => void }) {
  const [menu, setMenu] = useState(false)
  const sensorDrivers = drivers.filter((d) => d.kind === 'sensor')
  const drv = (name: string) => drivers.find((d) => d.driver === name)
  const set = (i: number, p: Partial<SensorCfg>) => patch({ sensors: cfg.sensors.map((s, k) => (k === i ? { ...s, ...p } : s)) })

  const add = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    const used = new Set([...cfg.sensors.map((s) => s.key), ...cfg.indicators.map((i) => i.key)])
    const made = preset.make().map((s) => {
      const key = uniqueKey(s.key, used)
      used.add(key)
      return { ...s, key }
    })
    patch({ sensors: [...cfg.sensors, ...made] })
    setMenu(false)
  }

  return (
    <Section
      title="Sensores"
      sub="Lo que mide tu dispositivo. Cada sensor se vuelve una variable que usan los modelos, los indicadores y las reglas."
      actions={
        <>
          <button type="button" className="btn sm" onClick={onLoadHardware}>Cargar hardware confirmado</button>
          <div className="pop-wrap">
            <button type="button" className="btn primary sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}><Icon name="plus" size={15} /> Agregar sensor</button>
            {menu && (
              <>
                <button type="button" className="pop-backdrop" aria-label="Cerrar menú" onClick={() => setMenu(false)} />
                <div className="pop right wide" role="menu">
                  {PRESETS.map((p) => (
                    <button key={p.id} type="button" role="menuitem" onClick={() => add(p.id)}>
                      <b>{p.label}</b>
                      <small>{p.hint}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      }
    >
      {cfg.sensors.map((s, i) => {
        const d = drv(s.driver)
        const where = s.driver === 'simulated' ? 'simulado' : s.driver === 'bh1750' ? 'I2C' : s.pin != null ? `GPIO ${s.pin}` : 'sin pin'
        const summary = [where, s.unit && `en ${s.unit}`, range(s.min_ok, s.max_ok, s.unit)].filter(Boolean).join(' · ')
        return (
          <Card
            key={i}
            on={s.enabled}
            summary={summary}
            head={
              <>
                <Switch checked={s.enabled} onChange={(v) => set(i, { enabled: v })} label={`Sensor ${s.label} activo`} />
                <input className="cfg-name" value={s.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Nombre del sensor" />
                <code className="cfg-key">{s.key}</code>
              </>
            }
            actions={<button type="button" className="icon-btn danger" onClick={() => patch({ sensors: cfg.sensors.filter((_, k) => k !== i) })} aria-label={`Quitar ${s.label}`} title="Quitar"><Icon name="trash" size={16} /></button>}
          >
            <div className="cfg-grid">
              <Field label="Variable" hint="Nombre en los modelos"><input value={s.key} onChange={(e) => set(i, { key: cleanKey(e.target.value) })} spellCheck={false} /></Field>
              <Field label="Tipo">
                <select value={s.driver} onChange={(e) => set(i, { driver: e.target.value as SensorDriver })}>
                  {sensorDrivers.map((x) => <option key={x.driver} value={x.driver}>{x.label}</option>)}
                </select>
              </Field>
              {d?.needs_pin && <Field label="Pin"><input type="number" value={val(s.pin)} onChange={(e) => set(i, { pin: num(e.target.value) })} /></Field>}
              {(s.driver === 'dht_t' || s.driver === 'dht_h' || s.driver === 'bh1750') && (
                <Field label={s.driver === 'bh1750' ? 'Dirección I2C' : 'Modelo DHT'}><input type="number" value={val(s.param)} onChange={(e) => set(i, { param: num(e.target.value) })} /></Field>
              )}
              <Field label="Unidad"><input value={s.unit} onChange={(e) => set(i, { unit: e.target.value })} /></Field>
            </div>
            <details className="cfg-more">
              <summary>Calibración y rangos ideales</summary>
              <div className="cfg-grid">
                <Field label="Escala" hint="valor × escala"><input type="number" step="any" value={s.scale} onChange={(e) => set(i, { scale: Number(e.target.value) || 0 })} /></Field>
                <Field label="Desplazamiento" hint="+ desplazamiento"><input type="number" step="any" value={s.offset} onChange={(e) => set(i, { offset: Number(e.target.value) || 0 })} /></Field>
                <Field label="Ideal mínimo"><input type="number" step="any" value={val(s.min_ok)} onChange={(e) => set(i, { min_ok: num(e.target.value) })} /></Field>
                <Field label="Ideal máximo"><input type="number" step="any" value={val(s.max_ok)} onChange={(e) => set(i, { max_ok: num(e.target.value) })} /></Field>
                {s.driver === 'simulated' && (
                  <>
                    <Field label="Simulado mín."><input type="number" step="any" value={val(s.sim_min)} onChange={(e) => set(i, { sim_min: num(e.target.value) })} /></Field>
                    <Field label="Simulado máx."><input type="number" step="any" value={val(s.sim_max)} onChange={(e) => set(i, { sim_max: num(e.target.value) })} /></Field>
                  </>
                )}
              </div>
            </details>
            {d && <p className="cfg-help">{d.help}</p>}
          </Card>
        )
      })}
      {!cfg.sensors.length && <Empty text="Aún no hay sensores. Agrega uno con el botón de arriba." />}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Actuadores
export function ActuatorsTab({ cfg, patch, drivers, sensorKeys, apiKey, dirty, onTest, onNeedKey }: Common & { drivers: DriverInfo[]; sensorKeys: string[]; apiKey: string; dirty: boolean; onTest: (key: string) => void; onNeedKey: () => void }) {
  const actuatorDrivers = drivers.filter((d) => d.kind === 'actuator')
  const set = (i: number, p: Partial<ActuatorCfg>) => patch({ actuators: cfg.actuators.map((s, k) => (k === i ? { ...s, ...p } : s)) })

  return (
    <Section
      title="Actuadores"
      sub="Bombas, válvulas y relés. Pueden activarse a mano o con una regla que funciona aunque no haya internet."
      actions={
        <button type="button" className="btn primary sm" onClick={() => {
          const used = new Set(cfg.actuators.map((a) => a.key))
          patch({ actuators: [...cfg.actuators, { key: uniqueKey('actuador', used), label: 'Nuevo actuador', driver: 'relay', pin: 26, active_high: true, max_seconds: 120, auto_variable: null, auto_on_below: null, auto_on_above: null, auto_off_at: null, auto_seconds: 30, cooldown_s: 600, enabled: true }] })
        }}><Icon name="plus" size={15} /> Agregar actuador</button>
      }
    >
      {cfg.actuators.map((a, i) => {
        const rule = a.auto_variable != null
        const below = a.auto_on_below != null
        const summary = [a.pin == null ? 'virtual' : `GPIO ${a.pin}`, rule ? `auto: ${a.auto_variable} ${below ? '<' : '>'} ${below ? a.auto_on_below : a.auto_on_above}` : 'manual', `tope ${a.max_seconds} s`].join(' · ')
        return (
          <Card
            key={i}
            on={a.enabled}
            summary={summary}
            head={
              <>
                <Switch checked={a.enabled} onChange={(v) => set(i, { enabled: v })} label={`Actuador ${a.label} activo`} />
                <input className="cfg-name" value={a.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Nombre del actuador" />
                <code className="cfg-key">{a.key}</code>
              </>
            }
            actions={
              <>
                <button type="button" className="btn sm" onClick={() => (apiKey ? onTest(a.key) : onNeedKey())} disabled={dirty} title={dirty ? 'Guarda los cambios primero' : 'Lo enciende 5 segundos'}>Probar 5 s</button>
                <button type="button" className="icon-btn danger" onClick={() => patch({ actuators: cfg.actuators.filter((_, k) => k !== i) })} aria-label={`Quitar ${a.label}`} title="Quitar"><Icon name="trash" size={16} /></button>
              </>
            }
          >
            <div className="cfg-grid">
              <Field label="Clave"><input value={a.key} onChange={(e) => set(i, { key: cleanKey(e.target.value) })} spellCheck={false} /></Field>
              <Field label="Tipo">
                <select value={a.driver} onChange={(e) => set(i, { driver: e.target.value as ActuatorCfg['driver'] })}>
                  {actuatorDrivers.map((x) => <option key={x.driver} value={x.driver}>{x.label}</option>)}
                </select>
              </Field>
              <Field label="Pin" hint="Vacío = virtual"><input type="number" placeholder="virtual" value={val(a.pin)} onChange={(e) => set(i, { pin: num(e.target.value) })} /></Field>
              <Field label="Tope (s)" hint="Nunca más de esto seguido"><input type="number" value={a.max_seconds} onChange={(e) => set(i, { max_seconds: Number(e.target.value) || 1 })} /></Field>
              <label className="fld inline"><span>Se activa en alto</span><Switch checked={a.active_high} onChange={(v) => set(i, { active_high: v })} label="Activo en alto" /></label>
            </div>

            <div className="rule">
              <label className="rule-h">
                <Switch
                  checked={rule}
                  onChange={(v) => set(i, v ? { auto_variable: sensorKeys[0] ?? null, auto_on_below: 0, auto_on_above: null } : { auto_variable: null, auto_on_below: null, auto_on_above: null, auto_off_at: null })}
                  label="Acción automática"
                />
                <span><b>Acción automática</b><small>Funciona aunque no haya nube</small></span>
              </label>
              {rule && (
                <div className="rule-b">
                  <div className="rule-sentence">
                    <span>Cuando</span>
                    <select value={a.auto_variable ?? ''} onChange={(e) => set(i, { auto_variable: e.target.value })} aria-label="Variable">{sensorKeys.map((k) => <option key={k}>{k}</option>)}</select>
                    <span>esté</span>
                    <select value={below ? 'below' : 'above'} onChange={(e) => set(i, e.target.value === 'below' ? { auto_on_below: a.auto_on_above ?? 0, auto_on_above: null } : { auto_on_above: a.auto_on_below ?? 0, auto_on_below: null })} aria-label="Comparación">
                      <option value="below">debajo de</option>
                      <option value="above">encima de</option>
                    </select>
                    <input type="number" step="any" value={val(below ? a.auto_on_below : a.auto_on_above)} onChange={(e) => set(i, below ? { auto_on_below: num(e.target.value) } : { auto_on_above: num(e.target.value) })} aria-label="Valor" />
                    <span>→ encender</span>
                    <input type="number" value={a.auto_seconds} onChange={(e) => set(i, { auto_seconds: Number(e.target.value) || 1 })} aria-label="Duración en segundos" />
                    <span>s</span>
                  </div>
                  <div className="cfg-grid">
                    <Field label="Cortar antes si llega a" hint="Opcional"><input type="number" step="any" value={val(a.auto_off_at)} onChange={(e) => set(i, { auto_off_at: num(e.target.value) })} /></Field>
                    <Field label="Esperar entre acciones (s)"><input type="number" value={a.cooldown_s} onChange={(e) => set(i, { cooldown_s: Number(e.target.value) || 0 })} /></Field>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )
      })}
      {!cfg.actuators.length && <Empty text="Aún no hay actuadores." />}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Indicadores
export function IndicatorsTab({ cfg, patch, allVars, sensorKeys }: Common & { allVars: string[]; sensorKeys: string[] }) {
  const set = (i: number, p: Partial<IndicatorCfg>) => patch({ indicators: cfg.indicators.map((s, k) => (k === i ? { ...s, ...p } : s)) })
  return (
    <Section
      title="Indicadores"
      sub={'Una fórmula sobre tus variables, calculada en el servidor con cada lectura. Funciones: min, max, abs, round, sqrt, exp, log, pow. Ej.: air_t - soil_t'}
      actions={
        <button type="button" className="btn primary sm" onClick={() => {
          const used = new Set([...cfg.sensors.map((s) => s.key), ...cfg.indicators.map((n) => n.key)])
          patch({ indicators: [...cfg.indicators, { key: uniqueKey('indicador', used), label: 'Nuevo indicador', formula: sensorKeys[0] ?? '1', unit: '', min_ok: null, max_ok: null, enabled: true }] })
        }}><Icon name="plus" size={15} /> Agregar indicador</button>
      }
    >
      {cfg.indicators.map((n, i) => (
        <Card
          key={i}
          on={n.enabled}
          startOpen
          summary={`= ${n.formula || '…'}${n.unit ? ' ' + n.unit : ''}`}
          head={
            <>
              <Switch checked={n.enabled} onChange={(v) => set(i, { enabled: v })} label={`Indicador ${n.label} activo`} />
              <input className="cfg-name" value={n.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Nombre del indicador" />
              <code className="cfg-key">{n.key}</code>
            </>
          }
          actions={<button type="button" className="icon-btn danger" onClick={() => patch({ indicators: cfg.indicators.filter((_, k) => k !== i) })} aria-label={`Quitar ${n.label}`} title="Quitar"><Icon name="trash" size={16} /></button>}
        >
          <Field label="Fórmula" className="wide"><input className="mono" value={n.formula} onChange={(e) => set(i, { formula: e.target.value })} spellCheck={false} /></Field>
          <div className="chip-row" aria-label="Insertar variable">
            {allVars.filter((v) => v !== n.key).map((v) => (
              <button key={v} type="button" className="chip-btn" onClick={() => set(i, { formula: (n.formula + ' ' + v).trim() })}>{v}</button>
            ))}
          </div>
          <div className="cfg-grid">
            <Field label="Clave"><input value={n.key} onChange={(e) => set(i, { key: cleanKey(e.target.value) })} spellCheck={false} /></Field>
            <Field label="Unidad"><input value={n.unit} onChange={(e) => set(i, { unit: e.target.value })} /></Field>
            <Field label="Ideal mínimo"><input type="number" step="any" value={val(n.min_ok)} onChange={(e) => set(i, { min_ok: num(e.target.value) })} /></Field>
            <Field label="Ideal máximo"><input type="number" step="any" value={val(n.max_ok)} onChange={(e) => set(i, { max_ok: num(e.target.value) })} /></Field>
          </div>
        </Card>
      ))}
      {!cfg.indicators.length && <Empty text="Aún no hay indicadores." />}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------ Dispositivo
export function DeviceTab({ cfg, patch, version }: Common & { version: number }) {
  const [copied, setCopied] = useState(false)
  const wiring = useMemo(() => {
    const rows: { pin: string; who: string; kind: string }[] = []
    cfg.sensors.filter((s) => s.enabled).forEach((s) => {
      if (s.driver === 'bh1750') rows.push({ pin: 'GPIO 21/22 (I2C)', who: s.label, kind: 'BH1750' })
      else if (s.driver !== 'simulated') rows.push({ pin: s.pin == null ? '—' : `GPIO ${s.pin}`, who: s.label, kind: s.driver })
    })
    cfg.actuators.filter((a) => a.enabled).forEach((a) => rows.push({ pin: a.pin == null ? 'virtual' : `GPIO ${a.pin}`, who: a.label, kind: a.driver }))
    return rows
  }, [cfg])

  /** Lo que recibirá el ESP32 (solo lo activo; los indicadores los calcula el servidor). */
  const json = useMemo(
    () => JSON.stringify({ version, report_interval_s: cfg.report_interval_s, sensors: cfg.sensors.filter((s) => s.enabled), actuators: cfg.actuators.filter((a) => a.enabled) }, null, 1),
    [cfg, version],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* sin portapapeles */ }
  }

  return (
    <Section title="ESP32 y cableado" sub="Cómo se comunica el dispositivo y a qué pin va cada cosa.">
      <div className="cfg-card static">
        <div className="cfg-grid">
          <Field label="Enviar datos cada (s)" hint="Mínimo 2 s"><input type="number" min={2} value={cfg.report_interval_s} onChange={(e) => patch({ report_interval_s: Math.max(2, Number(e.target.value) || 2) })} /></Field>
          <div className="stat-mini"><span>Versión de la configuración</span><b>{version}</b></div>
        </div>
        <p className="cfg-help">El ESP32 consulta cada 30 s; si hay una versión nueva la aplica y la guarda en su memoria (funciona también sin internet).</p>
      </div>

      <h3 className="sec-h3">Cableado</h3>
      <div className="adm-scroll">
        <table className="adm-table">
          <thead><tr><th>Pin</th><th>Qué es</th><th>Tipo</th></tr></thead>
          <tbody>
            {wiring.map((w, i) => <tr key={i}><td><code>{w.pin}</code></td><td>{w.who}</td><td>{w.kind}</td></tr>)}
            {!wiring.length && <tr><td colSpan={3} className="muted">Nada activo todavía.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="json-h">
        <h3 className="sec-h3">Lo que recibe el ESP32</h3>
        <button type="button" className="btn sm" onClick={() => void copy()}>{copied ? 'Copiado' : 'Copiar JSON'}</button>
      </div>
      <pre className="adm-json">{json}</pre>
    </Section>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="adm-empty compact"><p>{text}</p></div>
}
