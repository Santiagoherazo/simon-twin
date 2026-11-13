import { useMemo, useState, type ReactNode } from 'react'
import type { ActuatorCfg, DeviceConfigFull, DriverInfo, IndicatorCfg, SensorCfg, SensorDriver } from '../../types'
import { cleanKey, Field, Icon, num, Section, Switch, uniqueKey, val } from './ui'

export type Cfg = Pick<DeviceConfigFull, 'report_interval_s' | 'sensors' | 'actuators' | 'indicators' | 'display'>

const mkSensor = (p: Partial<SensorCfg> & Pick<SensorCfg, 'key' | 'label' | 'driver'>): SensorCfg => ({
  pin: null, param: null, unit: '', scale: 1, offset: 0, sim_min: null, sim_max: null, min_ok: null, max_ok: null, enabled: true, ...p,
})
const mkInd = (p: Partial<IndicatorCfg> & Pick<IndicatorCfg, 'key' | 'label' | 'formula'>): IndicatorCfg => ({
  unit: '', min_ok: null, max_ok: null, enabled: true, ...p,
})
const mkAct = (p: Partial<ActuatorCfg> & Pick<ActuatorCfg, 'key' | 'label'>): ActuatorCfg => ({
  driver: 'relay', pin: null, active_high: true, angle_on: 90, angle_off: 0, max_seconds: 120,
  auto_variable: null, auto_on_below: null, auto_on_above: null, auto_off_at: null, auto_seconds: 30, cooldown_s: 600, enabled: true, ...p,
})
const ldr = (key: string, label: string, pin: number) =>
  mkSensor({ key, label, driver: 'analog', pin, unit: '%', scale: 100 / 4095, min_ok: 15 })

interface Preset<T> { id: string; label: string; hint: string; make: () => T }
interface SensorPreset { sensors: SensorCfg[]; indicators?: IndicatorCfg[] }

/** Los únicos sensores del equipo. Cada plantilla trae los pines del montaje y, si hace falta, sus indicadores. */
const SENSOR_PRESETS: Preset<SensorPreset>[] = [
  { id: 'dht11', label: 'Temperatura y humedad del aire', hint: 'DHT11 · crea 2 variables · pin 4', make: () => ({ sensors: [
    mkSensor({ key: 'air_t', label: 'Temp. aire', driver: 'dht_t', pin: 4, param: 11, unit: '°C', min_ok: 15, max_ok: 32 }),
    mkSensor({ key: 'air_rh', label: 'Humedad aire', driver: 'dht_h', pin: 4, param: 11, unit: '%', min_ok: 40, max_ok: 85 }),
  ] }) },
  { id: 'soil', label: 'Humedad del suelo', hint: 'Capacitivo · entrada analógica · pin 36', make: () => ({ sensors: [
    mkSensor({ key: 'vwc_raw', label: 'Humedad suelo (ADC)', driver: 'analog', pin: 36 }),
  ] }) },
  { id: 'ds18b20', label: 'Temperatura del suelo', hint: 'DS18B20 enterrado · pin 18', make: () => ({ sensors: [
    mkSensor({ key: 'soil_t', label: 'Temp. suelo', driver: 'ds18b20', pin: 18, unit: '°C', min_ok: 15, max_ok: 28 }),
  ] }) },
  { id: 'ldr4', label: 'Luz: 4 LDR en las esquinas', hint: 'Pines 32 · 33 · 34 · 35 · crea 4 variables y la luz media', make: () => ({
    sensors: [ldr('ldr_nw', 'Luz esquina NO', 32), ldr('ldr_ne', 'Luz esquina NE', 33), ldr('ldr_sw', 'Luz esquina SO', 34), ldr('ldr_se', 'Luz esquina SE', 35)],
    indicators: [
      mkInd({ key: 'luz_media', label: 'Luz media (4 LDR)', formula: '(ldr_nw + ldr_ne + ldr_sw + ldr_se) / 4', unit: '%' }),
      mkInd({ key: 'luz_desbalance', label: 'Diferencia de luz entre esquinas', formula: 'max(ldr_nw, ldr_ne, ldr_sw, ldr_se) - min(ldr_nw, ldr_ne, ldr_sw, ldr_se)', unit: '%', min_ok: 0, max_ok: 35 }),
    ],
  }) },
  { id: 'tank', label: 'Nivel del tanque', hint: 'Ultrasonido HC-SR04 · TRIG 23 · ECHO 19 · calcula el %', make: () => ({
    sensors: [mkSensor({ key: 'tank_cm', label: 'Distancia al agua', driver: 'hcsr04', pin: 23, param: 19, unit: 'cm' })],
    indicators: [mkInd({ key: 'tank_pct', label: 'Nivel del tanque', formula: 'max(0, min(100, (15 - tank_cm) / (15 - 3) * 100))', unit: '%', min_ok: 15 })],
  }) },
  { id: 'sim', label: 'Simulado (pruebas)', hint: 'Sin hardware, valores aleatorios', make: () => ({ sensors: [mkSensor({ key: 'simulada', label: 'Simulada', driver: 'simulated', sim_min: 0, sim_max: 100 })] }) },
]

const ACTUATOR_PRESETS: Preset<ActuatorCfg>[] = [
  { id: 'pump', label: 'Mini bomba', hint: 'Relé · pin 26 · tope 120 s', make: () => mkAct({ key: 'pump', label: 'Mini bomba', pin: 26, max_seconds: 120 }) },
  { id: 'light', label: 'Luz externa', hint: 'Relé · pin 27 · tope 1 h', make: () => mkAct({ key: 'light', label: 'Luz externa', pin: 27, max_seconds: 3600 }) },
  { id: 'servo', label: 'Luz indirecta (servo)', hint: 'Postigo · pin 13 · abre a 90° y se queda abierto', make: () => mkAct({ key: 'servo', label: 'Luz indirecta', driver: 'servo', pin: 13, angle_on: 90, angle_off: 0, max_seconds: 30 }) },
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
    const preset = SENSOR_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const made = preset.make()
    const used = new Set([...cfg.sensors.map((s) => s.key), ...cfg.indicators.map((i) => i.key)])
    const sensors = made.sensors.map((x) => {
      const key = uniqueKey(x.key, used)
      used.add(key)
      return { ...x, key }
    })
    // Los indicadores de la plantilla se agregan solo si no existen ya (así no se duplican al volver a agregarla)
    const have = new Set(cfg.indicators.map((i) => i.key))
    const indicators = (made.indicators ?? []).filter((i) => !have.has(i.key))
    patch({ sensors: [...cfg.sensors, ...sensors], indicators: [...cfg.indicators, ...indicators] })
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
                  {SENSOR_PRESETS.map((p) => (
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
        const where = s.driver === 'simulated' ? 'simulado' : s.driver === 'hcsr04' ? `TRIG ${s.pin ?? '?'} · ECHO ${s.param ?? '?'}` : s.pin != null ? `GPIO ${s.pin}` : 'sin pin'
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
              {d?.needs_pin && <Field label={s.driver === 'hcsr04' ? 'Pin TRIG' : 'Pin'}><input type="number" value={val(s.pin)} onChange={(e) => set(i, { pin: num(e.target.value) })} /></Field>}
              {s.driver === 'hcsr04' && <Field label="Pin ECHO" hint="Con divisor a 3,3 V"><input type="number" value={val(s.param)} onChange={(e) => set(i, { param: num(e.target.value) })} /></Field>}
              {(s.driver === 'dht_t' || s.driver === 'dht_h') && (
                <Field label="Modelo DHT" hint="11 = DHT11"><input type="number" value={val(s.param)} onChange={(e) => set(i, { param: num(e.target.value) })} /></Field>
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
export function ActuatorsTab({ cfg, patch, drivers, sensorKeys, apiKey, dirty, onTest, onNeedKey }: Common & { drivers: DriverInfo[]; sensorKeys: string[]; apiKey: string; dirty: boolean; onTest: (key: string, seconds: number) => void; onNeedKey: () => void }) {
  const [menu, setMenu] = useState(false)
  const actuatorDrivers = drivers.filter((d) => d.kind === 'actuator')
  const set = (i: number, p: Partial<ActuatorCfg>) => patch({ actuators: cfg.actuators.map((s, k) => (k === i ? { ...s, ...p } : s)) })
  const add = (id: string) => {
    const preset = ACTUATOR_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const made = preset.make()
    const used = new Set(cfg.actuators.map((x) => x.key))
    patch({ actuators: [...cfg.actuators, { ...made, key: uniqueKey(made.key, used) }] })
    setMenu(false)
  }

  return (
    <Section
      title="Actuadores"
      sub="Mini bomba, luz externa y el servo de la luz indirecta. Pueden activarse a mano o con una regla que funciona aunque no haya internet."
      actions={
        <div className="pop-wrap">
          <button type="button" className="btn primary sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}><Icon name="plus" size={15} /> Agregar actuador</button>
          {menu && (
            <>
              <button type="button" className="pop-backdrop" aria-label="Cerrar menú" onClick={() => setMenu(false)} />
              <div className="pop right wide" role="menu">
                {ACTUATOR_PRESETS.map((p) => (
                  <button key={p.id} type="button" role="menuitem" onClick={() => add(p.id)}>
                    <b>{p.label}</b>
                    <small>{p.hint}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      }
    >
      {cfg.actuators.map((a, i) => {
        const rule = a.auto_variable != null
        const below = a.auto_on_below != null
        const summary = [a.pin == null ? 'virtual' : `GPIO ${a.pin}`, a.driver === 'servo' ? `cerrada ${a.angle_off}° · abierta ${a.angle_on}°` : null, rule ? `auto: ${a.auto_variable} ${below ? '<' : '>'} ${below ? a.auto_on_below : a.auto_on_above}` : 'manual', `tope ${a.max_seconds} s`].filter(Boolean).join(' · ')
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
                {a.driver === 'servo' ? (
                  <>
                    <button type="button" className="btn sm" onClick={() => (apiKey ? onTest(a.key, 1) : onNeedKey())} disabled={dirty} title={dirty ? 'Guarda los cambios primero' : 'Lo lleva al ángulo abierto'}>Abrir</button>
                    <button type="button" className="btn sm" onClick={() => (apiKey ? onTest(a.key, 0) : onNeedKey())} disabled={dirty} title={dirty ? 'Guarda los cambios primero' : 'Lo lleva al ángulo cerrado'}>Cerrar</button>
                  </>
                ) : (
                  <button type="button" className="btn sm" onClick={() => (apiKey ? onTest(a.key, 5) : onNeedKey())} disabled={dirty} title={dirty ? 'Guarda los cambios primero' : 'Lo enciende 5 segundos'}>Probar 5 s</button>
                )}
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
              {a.driver !== 'servo' && <Field label="Tope (s)" hint="Nunca más de esto seguido"><input type="number" value={a.max_seconds} onChange={(e) => set(i, { max_seconds: Number(e.target.value) || 1 })} /></Field>}
              {a.driver === 'servo' ? (
                <>
                  <Field label="Ángulo abierto" hint="0 a 180°"><input type="number" min={0} max={180} value={a.angle_on} onChange={(e) => set(i, { angle_on: Math.min(180, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
                  <Field label="Ángulo cerrado" hint="Posición de reposo"><input type="number" min={0} max={180} value={a.angle_off} onChange={(e) => set(i, { angle_off: Math.min(180, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
                </>
              ) : (
                <label className="fld inline"><span>Se activa en alto</span><Switch checked={a.active_high} onChange={(v) => set(i, { active_high: v })} label="Activo en alto" /></label>
              )}
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
                    {a.driver === 'servo' ? (
                      <span>→ abrir</span>
                    ) : (
                      <>
                        <span>→ encender</span>
                        <input type="number" value={a.auto_seconds} onChange={(e) => set(i, { auto_seconds: Number(e.target.value) || 1 })} aria-label="Duración en segundos" />
                        <span>s</span>
                      </>
                    )}
                  </div>
                  <div className="cfg-grid">
                    <Field label={a.driver === 'servo' ? 'Cerrar cuando llegue a' : 'Cortar antes si llega a'} hint={a.driver === 'servo' ? 'Sin esto queda abierto hasta que lo cierres' : 'Opcional'}><input type="number" step="any" value={val(a.auto_off_at)} onChange={(e) => set(i, { auto_off_at: num(e.target.value) })} /></Field>
                    <Field label="Esperar entre acciones (s)"><input type="number" value={a.cooldown_s} onChange={(e) => set(i, { cooldown_s: Number(e.target.value) || 0 })} /></Field>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )
      })}
      {!cfg.actuators.length && <Empty text="Aún no hay actuadores. Agrega la mini bomba, la luz externa o el servo." />}
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
    cfg.sensors.filter((s) => s.enabled && s.driver !== 'simulated').forEach((s) => {
      if (s.driver === 'hcsr04') {
        rows.push({ pin: s.pin == null ? '—' : `GPIO ${s.pin}`, who: `${s.label} (TRIG)`, kind: 'HC-SR04' })
        rows.push({ pin: s.param == null ? '—' : `GPIO ${s.param}`, who: `${s.label} (ECHO, con divisor a 3,3 V)`, kind: 'HC-SR04' })
      } else rows.push({ pin: s.pin == null ? '—' : `GPIO ${s.pin}`, who: s.label, kind: s.driver })
    })
    cfg.actuators.filter((a) => a.enabled).forEach((a) => rows.push({ pin: a.pin == null ? 'virtual' : `GPIO ${a.pin}`, who: a.label, kind: a.driver }))
    if (cfg.display.enabled) {
      rows.push({ pin: 'GPIO 21', who: 'Pantalla OLED (SDA)', kind: 'SSD1306' })
      rows.push({ pin: 'GPIO 22', who: 'Pantalla OLED (SCL)', kind: 'SSD1306' })
    }
    return rows
  }, [cfg])

  const d = cfg.display
  const setDisplay = (p: Partial<typeof d>) => patch({ display: { ...d, ...p } })
  /** Variables que el ESP32 conoce: sensores y actuadores activos (los indicadores se calculan en el servidor). */
  const showable = [...cfg.sensors.filter((s) => s.enabled).map((s) => ({ key: s.key, label: s.label })), ...cfg.actuators.filter((a) => a.enabled).map((a) => ({ key: a.key, label: a.label }))]
  const toggleShow = (k: string) => setDisplay({ show: d.show.includes(k) ? d.show.filter((x) => x !== k) : [...d.show, k].slice(0, 8) })

  /** Lo que recibirá el ESP32 (solo lo activo; los indicadores los calcula el servidor). */
  const json = useMemo(
    () => JSON.stringify({ version, report_interval_s: cfg.report_interval_s, sensors: cfg.sensors.filter((s) => s.enabled), actuators: cfg.actuators.filter((a) => a.enabled), display: cfg.display }, null, 1),
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

      <h3 className="sec-h3">Pantalla OLED</h3>
      <div className="cfg-card static">
        <label className="rule-h">
          <Switch checked={d.enabled} onChange={(v) => setDisplay({ enabled: v })} label="Pantalla OLED activa" />
          <span><b>Pantalla OLED 0,91″ (128×32)</b><small>I2C: SDA en GPIO 21 y SCL en GPIO 22. Muestra 3 variables por página.</small></span>
        </label>
        {d.enabled && (
          <>
            <div className="cfg-grid" style={{ marginTop: 12 }}>
              <Field label="Dirección I2C" hint="60 = 0x3C (lo normal)"><input type="number" min={8} max={119} value={d.address} onChange={(e) => setDisplay({ address: Math.min(119, Math.max(8, Number(e.target.value) || 60)) })} /></Field>
              <Field label="Cambiar de página cada (s)"><input type="number" min={2} max={60} value={d.rotate_s} onChange={(e) => setDisplay({ rotate_s: Math.min(60, Math.max(2, Number(e.target.value) || 4)) })} /></Field>
            </div>
            <p className="cfg-help" style={{ margin: '12px 0 6px' }}>Qué mostrar (máx. 8, en este orden de selección; si no eliges ninguno, muestra todos):</p>
            <div className="chip-row" role="group" aria-label="Variables en la pantalla">
              {showable.map((v) => (
                <button key={v.key} type="button" className={'chip-btn' + (d.show.includes(v.key) ? ' on' : '')} aria-pressed={d.show.includes(v.key)} onClick={() => toggleShow(v.key)}>
                  {d.show.includes(v.key) ? `${d.show.indexOf(v.key) + 1}. ` : ''}{v.label}
                </button>
              ))}
            </div>
          </>
        )}
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
