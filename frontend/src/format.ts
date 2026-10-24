export const fmt = (x: number | null | undefined, d = 1, unit = ''): string =>
  typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d).replace('.', ',') + unit : '—'

export function fmtHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '—'
  if (h < 1) return 'menos de 1 h'
  if (h < 48) return `~${Math.round(h)} h`
  return `~${(h / 24).toFixed(1).replace('.', ',')} días`
}

export function fmtAge(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1).replace('.', ',')} h`
}
