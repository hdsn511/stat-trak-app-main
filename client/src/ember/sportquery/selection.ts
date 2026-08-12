/**
 * What the detail pane is showing. SportQuery answers are NBA-scoped (the
 * system prompt documents only the NBA tables), so a selection carries a
 * database id and the question that produced it — the pane seeds its filters
 * from that query text.
 */
export type Selection = {
  kind: 'player'
  playerId: number
  name: string
  /** The user question this row answered, shown as context. */
  query: string
  /** Which assistant turn the row came from, so only that card highlights. */
  turnId: string
}
