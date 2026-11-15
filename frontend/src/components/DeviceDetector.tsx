import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { detectDevice, type DeviceProfile } from '../device'

const Ctx = createContext<DeviceProfile | null>(null)

const same = (a: DeviceProfile, b: DeviceProfile) => a.kind === b.kind && a.suggested === b.suggested && a.touch === b.touch

/**
 * Detecta qué tipo de equipo es (PC, tableta o celular) y se lo ofrece al resto de la app con `useDevice()`.
 * También deja `data-device="desktop|tablet|phone"` en <html> por si algún estilo lo necesita.
 * Vuelve a medir si cambia el puntero (p. ej. se conecta un ratón a una tableta) o se gira la pantalla.
 */
export function DeviceDetector({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<DeviceProfile>(() => detectDevice())

  useEffect(() => {
    document.documentElement.dataset.device = profile.kind
  }, [profile.kind])

  useEffect(() => {
    const refresh = () => setProfile((p) => {
      const n = detectDevice()
      return same(p, n) ? p : n
    })
    const queries = ['(pointer: coarse)', '(hover: none)'].map((q) => (typeof matchMedia !== 'undefined' ? matchMedia(q) : null))
    queries.forEach((m) => m?.addEventListener?.('change', refresh))
    window.addEventListener('orientationchange', refresh)
    return () => {
      queries.forEach((m) => m?.removeEventListener?.('change', refresh))
      window.removeEventListener('orientationchange', refresh)
    }
  }, [])

  return <Ctx.Provider value={profile}>{children}</Ctx.Provider>
}

export function useDevice(): DeviceProfile {
  const p = useContext(Ctx)
  if (!p) throw new Error('useDevice debe usarse dentro de <DeviceDetector>')
  return p
}
