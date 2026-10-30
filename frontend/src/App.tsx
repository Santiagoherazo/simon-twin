import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getCrops, getDevices, getSoils, simulate } from './api'
import { Header, type Mode } from './components/Header'
import { LivePanel } from './components/LivePanel'
import { MobileShell } from './components/MobileShell'
import { SimPanel } from './components/SimPanel'
import { DEFAULT_DEVICE, MISCONFIGURED } from './config'
import { useLive } from './live'
import { initialQuality, QUALITY_ORDER, saveQuality, type Quality } from './scene/quality'
import { reducedMotion } from './scene/smooth'
import { Scene } from './scene/Scene'
import type { CropInfo, DeviceInfo, SimRequest, SimResponse, SoilCatalogItem } from './types'
import { EMPTY_VISUAL, setVisual, visualFromLive, visualFromSim } from './visual'

const SIM_PLAY_SECONDS = 20

function useNarrow() {
  const [n, setN] = useState(() => window.matchMedia('(max-width: 900px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const f = () => setN(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return n
}

export default function App() {
  const narrow = useNarrow()
  const [winW, setWinW] = useState(() => window.innerWidth)
  useEffect(() => {
    const f = () => setWinW(window.innerWidth)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const [mode, setMode] = useState<Mode>('live')
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [crops, setCrops] = useState<CropInfo[]>([])
  const [soils, setSoils] = useState<SoilCatalogItem[]>([])
  const [tick, setTick] = useState(0)
  const [quality, setQualityState] = useState<Quality>(initialQuality)
  const setQuality = useCallback((q: Quality) => {
    setQualityState(q)
    saveQuality(q)
  }, [])
  const dropQuality = useCallback(() => {
    setQualityState((q) => {
      const next = QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, QUALITY_ORDER.indexOf(q) + 1)]
      if (next !== q) saveQuality(next)
      return next
    })
  }, [])

  const live = useLive(deviceId)

  // Catálogos y dispositivos
  useEffect(() => {
    const ctrl = new AbortController()
    getDevices(ctrl.signal)
      .then((d) => {
        setDevices(d)
        setDeviceId((cur) => cur ?? (d.find((x) => x.device_id === DEFAULT_DEVICE) ?? d[0])?.device_id ?? null)
      })
      .catch(() => {})
    getCrops(ctrl.signal).then(setCrops).catch(() => {})
    getSoils(ctrl.signal).then(setSoils).catch(() => {})
    return () => ctrl.abort()
  }, [])

  // Reloj de 1 s para la edad del dato
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  void tick

  // ---- Simulación ----
  const [sim, setSim] = useState<SimResponse | null>(null)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [simBusy, setSimBusy] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const runSim = useCallback(
    (req: SimRequest) => {
      if (!deviceId) return
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setSimBusy(true)
      setSimError(null)
      simulate(deviceId, req, ctrl.signal)
        .then((r) => {
          setSim(r)
          setPos(0)
          setPlaying(!reducedMotion())
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError') return
          setSimError(e instanceof ApiError ? e.message : 'No se pudo simular.')
        })
        .finally(() => {
          if (abortRef.current === ctrl) setSimBusy(false)
        })
    },
    [deviceId],
  )

  // Cambiar de dispositivo invalida la simulación
  useEffect(() => {
    abortRef.current?.abort()
    setSim(null)
    setPlaying(false)
    setSimBusy(false)
    setSimError(null)
  }, [deviceId])

  // Reproductor: avanza `pos` a lo largo de SIM_PLAY_SECONDS
  useEffect(() => {
    if (!playing || !sim) return
    const n = sim.series.length
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      let reachedEnd = false
      setPos((p) => {
        const next = p + (dt * (n - 1)) / SIM_PLAY_SECONDS
        if (next >= n - 1) {
          reachedEnd = true
          return n - 1
        }
        return next
      })
      if (reachedEnd) setPlaying(false)
      else raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, sim])

  // ---- Estado visual que consume la escena ----
  useEffect(() => {
    if (mode === 'sim' && sim) setVisual(visualFromSim(sim, pos))
    else if (mode === 'sim') setVisual({ ...visualFromLive(live.state, live.telemetry), mode: 'sim', rainMm: 0 })
    else setVisual(visualFromLive(live.state, live.telemetry))
  }, [mode, sim, pos, live.state, live.telemetry])
  useEffect(() => () => setVisual(EMPTY_VISUAL), [])

  const ageS = live.state?.ts
    ? Math.max(0, Date.now() / 1000 - live.state.ts + (live.state.age_s ?? 0) * 0)
    : null

  const simProps = {
    deviceId,
    crops,
    soils,
    sim,
    pos,
    playing,
    busy: simBusy,
    error: simError,
    onRun: runSim,
    onPos: setPos,
    onPlay: setPlaying,
  }
  const changeMode = (m: Mode) => {
    setMode(m)
    if (m === 'live') setPlaying(false)
  }

  // Atajos de teclado (escritorio): L en vivo · S simulación · G gráficos · Espacio reproducir · Esc quitar foco
  useEffect(() => {
    if (narrow) return
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'l') changeMode('live')
      else if (k === 's') setMode('sim')
      else if (k === 'g') setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(quality) + 1) % QUALITY_ORDER.length])
      else if (k === ' ' && mode === 'sim' && sim) {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, quality, mode, sim])

  return (
    <div className={'app ' + (narrow ? 'shell-mobile' : 'shell-desktop')}>
      {MISCONFIGURED && (
        <div className="cfg-warn" role="alert">
          {MISCONFIGURED}
        </div>
      )}
      <div className="scene">
        <Scene narrow={narrow} quality={quality} onQualityDrop={dropQuality} shiftPx={narrow ? 0 : Math.min(400, Math.max(0, winW - 1000) * 0.5 + 220)} />
      </div>
      {narrow ? (
        <MobileShell live={live} mode={mode} onMode={changeMode} deviceId={deviceId} sim={simProps} />
      ) : (
        <>
          <Header
            devices={devices}
            deviceId={deviceId}
            onDevice={setDeviceId}
            mode={mode}
            onMode={changeMode}
            quality={quality}
            onQuality={setQuality}
            live={live}
            ageS={live.state?.age_s != null ? live.state.age_s + (live.stateRx ? (performance.now() - live.stateRx) / 1000 : 0) : ageS}
          />
          <aside className="panel" aria-label={mode === 'live' ? 'Estado en vivo' : 'Simulación'}>
            {mode === 'live' ? <LivePanel deviceId={deviceId} live={live} /> : <div className="card sim-card"><SimPanel {...simProps} /></div>}
          </aside>
          <div className="keys" aria-label="Atajos de teclado">
            <kbd>L</kbd> en vivo <kbd>S</kbd> simulación <kbd>G</kbd> gráficos <kbd>␣</kbd> reproducir · clic en la maceta, la planta o el tanque
          </div>
        </>
      )}
    </div>
  )
}
