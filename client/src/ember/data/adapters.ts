import type { LeagueSlug } from '@/config/leagues'
import type { PlayerStreakRow, TodaysGame, TrendingPlayer } from '@/services/api'
import type { TickerGame } from '@/ember/components/LiveTicker'
import type { StreakRow } from '@/ember/components/StreakWatch'
import type { TrendingRow } from '@/ember/components/TrendingPlayers'

// Pure mappings from API payloads to the shapes the Ember modules render.
// Kept separate from the fetching hook so the reshaping is testable without
// mocking the network.

/**
 * Stat names arrive spelled out from each league's trends table; the UI wants
 * tickers. Keys mirror `trendStatNames` in the server league registry.
 */
const STAT_LABEL: Record<string, string> = {
  // NBA
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  threes: '3PM',
  // MLB
  hits: 'H',
  total_bases: 'TB',
  rbi: 'RBI',
  runs: 'R',
  home_runs: 'HR',
  // NHL — `points` and `assists` are shared with the NBA above.
  goals: 'G',
  shots_on_goal: 'SOG',
  blocks: 'BLK',
  // NFL
  passing_yards: 'PASS YDS',
  passing_tds: 'PASS TD',
  rushing_yards: 'RUSH YDS',
  rushing_tds: 'RUSH TD',
  receiving_yards: 'REC YDS',
  receptions: 'REC',
  receiving_tds: 'REC TD',
  tackles: 'TKL',
}

export function statLabel(stat: string): string {
  return STAT_LABEL[stat] ?? stat.toUpperCase()
}

const round1 = (v: number) => Math.round(v * 10) / 10

export function toTrendingRows(
  league: LeagueSlug,
  players: TrendingPlayer[]
): Omit<TrendingRow, 'rank'>[] {
  return players.map((p) => {
    const season = round1(p.seasonAvg ?? 0)
    const recent = round1(p.rollingAvg)
    const diff = round1(recent - season)
    return {
      playerId: p.playerId,
      league,
      leagueLabel: league.toUpperCase(),
      name: p.playerName,
      team: p.team,
      stat: statLabel(p.stat),
      chips: p.trendDrivers ?? [],
      seasonVal: season,
      l10Val: recent,
      delta: `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`,
      zScore: p.zScore,
    }
  })
}

/**
 * The API serves two streak models and says which by populating different
 * fields. MLB rows carry an active run (`streak_count`) with all tier lines
 * zeroed; NBA rows carry the tiered lines a player cleared in 10, 9, 8 and 7
 * of their last 10 games. Rendering a tier ladder for an MLB row would print
 * four zeroes, so the shape has to distinguish them.
 */
export function toStreakRows(
  league: LeagueSlug,
  rows: PlayerStreakRow[],
  label: string
): StreakRow[] {
  return rows.map((r) => ({
    playerId: r.player_id,
    league,
    leagueLabel: league.toUpperCase(),
    name: r.player_name,
    team: r.team,
    label,
    rollingAvg: round1(r.rolling_avg),
    opponent: r.opponent?.team ?? null,
    detail:
      r.streak_count != null && r.streak_count > 0
        ? { kind: 'run' as const, games: r.streak_count, line: r.streak_line ?? 1 }
        : {
            kind: 'tiers' as const,
            tiers: [
              { pct: 100, line: r.line_100 },
              { pct: 90, line: r.line_90 },
              { pct: 80, line: r.line_80 },
              { pct: 70, line: r.line_70 },
            ],
          },
  }))
}

export function toTickerGames(league: LeagueSlug, games: TodaysGame[]): TickerGame[] {
  return games.map((g) => ({
    id: `${league}-${g.gameId}`,
    dbId: g.dbId ?? null,
    slug: league,
    league: league.toUpperCase(),
    date: g.date ?? null,
    away: g.away.team,
    home: g.home.team,
    awayScore: g.away.score === '' ? undefined : Number(g.away.score),
    homeScore: g.home.score === '' ? undefined : Number(g.home.score),
    status: g.status,
    live: g.live ?? false,
  }))
}

/** Strongest trends first, then numbered for display. */
export function rankTrending(
  rows: Omit<TrendingRow, 'rank'>[],
  limit: number
): TrendingRow[] {
  return [...rows]
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/**
 * Most notable streak first.
 *
 * A run length (9 straight games) and a tier line (30.5 points cleared in all
 * 10) are different units — comparing them numerically would rank a points
 * line above a nine-game hitting streak for no reason. So the two models are
 * grouped rather than interleaved: active runs lead, because an uncapped
 * consecutive-game streak is the headline this module exists to show, then
 * tiered lines by the value guaranteed across all ten games. Ties in either
 * group break on the L10 average.
 */
function streakWeight(row: StreakRow): number {
  return row.detail.kind === 'run' ? row.detail.games : (row.detail.tiers[0]?.line ?? 0)
}

export function rankStreaks(rows: StreakRow[], limit: number): StreakRow[] {
  const rank = (r: StreakRow) => (r.detail.kind === 'run' ? 0 : 1)
  return [...rows]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        streakWeight(b) - streakWeight(a) ||
        b.rollingAvg - a.rollingAvg
    )
    .slice(0, limit)
}
