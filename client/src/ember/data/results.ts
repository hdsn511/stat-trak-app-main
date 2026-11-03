import type { SuggestionResultSet } from '@/services/api'

/** "6-2" for a card header; null when nothing was graded. */
export function recordLabel(set: SuggestionResultSet | null | undefined): string | null {
  if (!set || set.rows.length === 0) return null
  return `${set.record.w}-${set.record.l}`
}
