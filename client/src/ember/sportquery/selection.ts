import type { LeagueSlug } from '@/config/leagues'

/**
 * What the detail pane is showing. SportQuery covers all four sports, so a
 * selection carries a database id, the league hint read off the result row (if
 * any), and the question that produced it — the pane seeds its filters from
 * that query text.
 */
export type Selection = {
  kind: 'player'
  playerId: number
  /** League read from the row's league/league_id column; the pane verifies it. */
  league?: LeagueSlug
  name: string
  /** The user question this row answered, shown as context. */
  query: string
  /** Which assistant turn the row came from, so only that card highlights. */
  turnId: string
}
