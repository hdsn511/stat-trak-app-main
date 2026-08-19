import type { BoxColumn, TeamRecord } from '@/services/api'

/** Seconds → m:ss, for NHL time on ice. */
export function mmss(v: number): string {
  const m = Math.floor(v / 60)
  const s = Math.round(v % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Render one box-score cell. Whole numbers print bare; fractions (save
 * percentage, an averaged preview value) get one decimal — except SV%, which
 * is conventionally three.
 */
export function formatStat(col: BoxColumn, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (col.format === 'mmss') return mmss(v)
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(col.label === 'SV%' ? 3 : 1)
}

/** "12-4" or "12-4-1" — the tie only shows for sports that have them. */
export function formatRecord(r: TeamRecord): string {
  return r.t > 0 ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
}

/** "SAT, NOV 8" from a bare YYYY-MM-DD, read as local rather than UTC. */
export function formatGameDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-US', DATE_OPTS).toUpperCase()
}

/** "7:30 PM" from an ISO timestamp, or null when tipoff time is unknown. */
export function formatGameTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
