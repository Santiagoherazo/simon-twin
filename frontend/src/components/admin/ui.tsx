import type { ReactNode } from 'react'

export const num = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v))
export const val = (v: number | null | undefined) => (v == null ? '' : String(v))
export const cleanKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9_]/g, '_')

export function uniqueKey(base: string, used: Set<string>) {
  let k = base
  for (let i = 2; used.has(k); i++) k = `${base}_${i}`
  return k
}

/** Interruptor accesible (checkbox con aspecto de switch). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="sw-wrap" title={label}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="sw-track" aria-hidden="true"><i /></span>
    </label>
  )
}

export function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={'fld ' + className}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Section({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <header className="sec-h">
        <div>
          <h2>{title}</h2>
          {sub && <p className="muted">{sub}</p>}
        </div>
        {actions && <div className="sec-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  sensor: 'M12 3a4 4 0 014 4v5.5a5 5 0 11-8 0V7a4 4 0 014-4zM12 9v6',
  actuator: 'M12 3c3 4 6 6.5 6 10a6 6 0 11-12 0c0-3.5 3-6 6-10z',
  formula: 'M5 5h14M8 5l4 7-4 7h11M5 19h3',
  chip: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  lab: 'M9 3h6M10 3v6l-5.5 9.5A2 2 0 006.2 21h11.6a2 2 0 001.7-2.5L14 9V3M7.5 15h9',
  key: 'M14.5 9.5a4 4 0 11-2.6 3.8L4 21v-3l-1-1 1-2 2-1 6.4-6.4A4 4 0 0114.5 9.5zM16 8h.01',
  back: 'M15 5l-7 7 7 7',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  chevron: 'M6 9l6 6 6-6',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
}

export function Icon({ name, size = 18 }: { name: keyof typeof P; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}
