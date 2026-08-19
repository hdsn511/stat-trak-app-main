import type { StatDef } from '@/config/playerStats'
import type { DefenseSplit, GameRow, PlayerFilters, UpcomingGame } from './types'

export interface HitRate {
  over: number
  under: number
  push: number
  total: number
  /** Share of decided (non-push) games that went over. Null if none decided. */
  pct: number | null
}

export interface Split {
  key: string
  label: string
  season: number | null
  versus: number | null
  delta: number | null
}

export type SignalBucket = 'GREAT' | 'GOOD' | 'NEUTRAL' | 'TOUGH' | 'BRUTAL'

export interface Signal {
  rank: number
  allowed: number
  positionGroup: string | null
  bucket: SignalBucket
  asOf: string
}

export interface MatchupTarget {
  team: string
  source: 'schedule' | 'filter'
  /** Only populated when the target is the next scheduled game. */
  upcoming: UpcomingGame | null
}

/**
 * Window first, then opponent and venue. Order matters: "last 10 vs BOS" means
 * BOS games within the last 10 played, not the last 10 BOS games.
 */
export function filterGames(games: GameRow[], filters: PlayerFilters): GameRow[] {
  const windowed = filters.window > 0 ? games.slice(0, filters.window) : games
  return windowed.filter((g) => {
    if (filters.vsTeam && g.opponent !== filters.vsTeam) return false
    if (filters.homeAway === 'home' && g.isHome !== true) return false
    if (filters.homeAway === 'away' && g.isHome !== false) return false
    return true
  })
}

export function averageOf(games: GameRow[], def: StatDef): number | null {
  let total = 0
  let n = 0
  for (const g of games) {
    const v = def.get(g)
    if (v == null) continue
    total += v
    n += 1
  }
  return n === 0 ? null : total / n
}

/** The filtered average, rounded to the nearest half — a natural prop line. */
export function defaultLine(games: GameRow[], def: StatDef): number {
  const avg = averageOf(games, def)
  return avg == null ? 0 : Math.round(avg * 2) / 2
}

export function hitRate(games: GameRow[], def: StatDef, line: number): HitRate {
  let over = 0
  let under = 0
  let push = 0
  for (const g of games) {
    const v = def.get(g)
    if (v == null) continue
    if (v > line) over += 1
    else if (v < line) under += 1
    else push += 1
  }
  const decided = over + under
  return {
    over,
    under,
    push,
    total: over + under + push,
    pct: decided === 0 ? null : Math.round((over / decided) * 100),
  }
}

export function opponentsOf(games: GameRow[]): string[] {
  const seen = new Set<string>()
  for (const g of games) {
    if (typeof g.opponent === 'string' && g.opponent) seen.add(g.opponent)
  }
  return [...seen].sort()
}

export function gamesVersus(games: GameRow[], team: string): GameRow[] {
  return games.filter((g) => g.opponent === team)
}

/**
 * Season average and versus-opponent average as separate figures. They are
 * never blended — the point is to compare them.
 */
export function splitsFor(all: GameRow[], vs: GameRow[], defs: StatDef[]): Split[] {
  return defs.map((d) => {
    const season = averageOf(all, d)
    const versus = averageOf(vs, d)
    return {
      key: d.key,
      label: d.label,
      season,
      versus,
      delta: season == null || versus == null ? null : versus - season,
    }
  })
}

/**
 * Translate an opponent's defensive rank into a favorability bucket. A HIGH rank
 * in "allowed per game" means the defense gives up a lot, which is GOOD for the
 * player. Buckets split the league into fifths.
 */
export function matchupSignal(d: DefenseSplit | null, teamCount: number): Signal | null {
  if (!d || d.leagueRank == null) return null
  const pct = d.leagueRank / teamCount
  const bucket: SignalBucket =
    pct > 0.8 ? 'GREAT' : pct > 0.6 ? 'GOOD' : pct > 0.4 ? 'NEUTRAL' : pct > 0.2 ? 'TOUGH' : 'BRUTAL'
  return {
    rank: d.leagueRank,
    allowed: d.allowedPerGame,
    positionGroup: d.positionGroup,
    bucket,
    asOf: d.asOf,
  }
}

/**
 * Which opponent the matchup section describes. An explicit filter selection
 * wins over the schedule, because a user asking about MIA should see MIA even
 * if the next game is BOS — unless they picked the scheduled opponent anyway,
 * in which case the game context is still worth keeping. Most leagues are out
 * of season most of the year, so the filter path is the common one.
 */
export function resolveMatchupOpponent(
  upcoming: UpcomingGame | null,
  vsTeam: string | null
): MatchupTarget | null {
  if (vsTeam) {
    return upcoming && upcoming.opponent === vsTeam
      ? { team: vsTeam, source: 'schedule', upcoming }
      : { team: vsTeam, source: 'filter', upcoming: null }
  }
  if (upcoming) return { team: upcoming.opponent, source: 'schedule', upcoming }
  return null
}
