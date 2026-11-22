import type { GameInsights, GameTapeRow } from '@/services/api'

export type Side = 'away' | 'home'

/** Which side wins a row: 'away' | 'home' | null for a tie or a missing side. */
export function edge(row: GameTapeRow): Side | null {
  const a = row.away?.value
  const h = row.home?.value
  if (a == null || h == null || a === h) return null
  const awayBetter = row.better === 'higher' ? a > h : a < h
  return awayBetter ? 'away' : 'home'
}

export interface KeyMatchup {
  /** The team with the ball in this lane. */
  offense: Side
  stat: string
  offRank: number
  defRank: number
  /** Rows of league separation, positive = the offense has the better of it. */
  gap: number
  verdict: 'offense' | 'defense' | 'even'
}

/**
 * Pairs each offense row with the other team's defense row for the same stat
 * (POR scoring vs MIN points allowed) and keeps the lanes with the widest rank
 * gap. Rank 1 is best on both tables, so defRank − offRank > 0 favours the offense.
 */
export function keyMatchups(insights: Pick<GameInsights, 'offense' | 'defense' | 'team_count'>, limit = 3): KeyMatchup[] {
  const third = insights.team_count / 3
  const out: KeyMatchup[] = []
  for (const off of insights.offense) {
    const def = insights.defense.find((d) => d.key === off.key)
    if (!def) continue
    for (const side of ['away', 'home'] as const) {
      const o = off[side]
      const d = def[side === 'away' ? 'home' : 'away']
      if (!o || !d) continue
      const gap = d.rank - o.rank
      out.push({
        offense: side,
        stat: off.label,
        offRank: o.rank,
        defRank: d.rank,
        gap,
        verdict: gap >= third ? 'offense' : gap <= -third ? 'defense' : 'even',
      })
    }
  }
  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, limit)
}
