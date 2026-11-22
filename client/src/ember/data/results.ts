import type { SuggestionResultSet } from '@/services/api'

/** "6-2" for a card header; null when nothing was graded. */
export function recordLabel(set: SuggestionResultSet | null | undefined): string | null {
  if (!set || set.rows.length === 0) return null
  return `${set.record.w}-${set.record.l}`
}

/** "+4.3U" / "-1.0U": net units on 1-unit straights. */
export function formatUnits(units: number): string {
  const v = Math.round(units * 10) / 10
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}U`
}
