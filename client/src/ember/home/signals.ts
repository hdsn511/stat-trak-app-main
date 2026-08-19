import type { TickerGame } from '@/ember/components/LiveTicker'
import type { StreakRow } from '@/ember/components/StreakWatch'
import type { TrendingRow } from '@/ember/components/TrendingPlayers'
import { gamePath, playerPath } from '@/lib/paths'

export interface StatSignal {
  id: string
  /** The headline number, rendered large. */
  stat: string
  league: string
  name: string
  context: string
  to: string
}

/**
 * Three headline cards derived from data already on the page — the strongest
 * trend, the most reliable streak line, and a live game. Anything without
 * backing data is dropped rather than filled with a placeholder.
 */
export function buildStatSignals(
  trending: TrendingRow[],
  streaks: StreakRow[],
  ticker: TickerGame[]
): StatSignal[] {
  const signals: StatSignal[] = []

  const hot = trending[0]
  if (hot) {
    signals.push({
      id: `trend-${hot.league}-${hot.playerId}`,
      stat: `${hot.l10Val}`,
      league: hot.leagueLabel,
      name: hot.name,
      context: `${hot.stat} over the last 10 — ${hot.delta} vs a ${hot.seasonVal} season average.`,
      to: playerPath(hot.league, hot.playerId),
    })
  }

  const streak = streaks[0]
  if (streak) {
    const { detail } = streak
    const run = detail.kind === 'run'
    const line = run ? detail.line : detail.tiers[0]?.line
    if (line != null && (run || line > 0)) {
      signals.push({
        id: `streak-${streak.league}-${streak.playerId}`,
        stat: `${line}+`,
        league: streak.leagueLabel,
        name: streak.name,
        context: run
          ? `${detail.games} straight games with ${line}+ ${streak.label}.`
          : `Cleared ${line}+ ${streak.label} in all 10 of their last 10.`,
        to: playerPath(streak.league, streak.playerId),
      })
    }
  }

  const game = ticker.find((g) => g.live && g.dbId) ?? ticker.find((g) => g.dbId)
  if (game?.dbId && game.slug) {
    const scored = game.awayScore !== undefined && game.homeScore !== undefined
    signals.push({
      id: `game-${game.id}`,
      stat: scored ? `${game.awayScore}–${game.homeScore}` : 'VS',
      league: game.league ?? game.slug.toUpperCase(),
      name: `${game.away} @ ${game.home}`,
      context: game.live ? `Live — ${game.status}.` : `${game.status}.`,
      to: gamePath(game.slug, game.dbId),
    })
  }

  return signals
}
