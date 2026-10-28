import type { TickerGame } from '@/ember/components/LiveTicker'
import type { StreakRow } from '@/ember/components/StreakWatch'
import type { TrendingRow } from '@/ember/components/TrendingPlayers'
import type { LeagueSlug } from '@/config/leagues'
import { gamePath, playerPath } from '@/lib/paths'

export type SignalKind = 'hot' | 'rising' | 'streak' | 'live' | 'final' | 'next'

/** A small picture of the number's evidence, drawn beside the headline. */
export type SignalViz =
  | { kind: 'trend'; season: number; recent: number; unit: string }
  | { kind: 'pips'; filled: number; total: number }
  | { kind: 'form'; rows: { team: string; results: string }[] }

export interface StatSignal {
  id: string
  kind: SignalKind
  league: LeagueSlug
  /** The headline number; always a stat (average, margin, edge, score), never a time. */
  stat: string
  /** What the headline number measures, e.g. "PTS · L10". */
  statLabel: string
  name: string
  context: string
  to: string
  viz?: SignalViz
}

export interface LeagueSignals {
  league: LeagueSlug
  label: string
  /** Games on the current slate window, for the lane header. */
  gamesCount: number
  liveCount: number
  signals: StatSignal[]
}

/** A league counts as in season when it has a game this close to today. */
export const IN_SEASON_WINDOW_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS

export function isNearToday(date: string | null | undefined, today: string): boolean {
  if (!date) return false
  return Math.abs(dayNumber(date) - dayNumber(today)) <= IN_SEASON_WINDOW_DAYS
}

/**
 * Leagues with a game inside the window, busiest first. The slate endpoint
 * falls back to the latest/next slate when nothing is on today, so an
 * off-season league still returns games — dated months away — and is excluded
 * by the date, not by being empty.
 */
export function inSeasonLeagues(
  ticker: TickerGame[],
  today: string,
  order: LeagueSlug[]
): LeagueSlug[] {
  const counts = new Map<string, number>()
  for (const g of ticker) {
    if (g.slug && isNearToday(g.date, today)) counts.set(g.slug, (counts.get(g.slug) ?? 0) + 1)
  }
  return order
    .filter((l) => counts.has(l))
    .sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b)
    )
}

const SIGN = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`

function hotSignal(row: TrendingRow, kind: 'hot' | 'rising'): StatSignal {
  const diff = row.l10Val - row.seasonVal
  return {
    id: `${kind}-${row.league}-${row.playerId}-${row.stat}`,
    kind,
    league: row.league as LeagueSlug,
    stat: SIGN(diff),
    statLabel: `${row.stat} VS SZN`,
    name: row.name,
    context: `${row.team} · ${row.l10Val} recent vs ${row.seasonVal} season`,
    to: playerPath(row.league, row.playerId),
    viz: { kind: 'trend', season: row.seasonVal, recent: row.l10Val, unit: row.stat },
  }
}

function streakSignal(row: StreakRow): StatSignal | null {
  const { detail } = row
  const run = detail.kind === 'run'
  const line = run ? detail.line : detail.tiers[0]?.line
  if (line == null || (!run && line <= 0)) return null
  const top = !run ? detail.tiers[0] : undefined
  const games = run ? detail.games : (top?.of ?? 0)
  return {
    id: `streak-${row.league}-${row.playerId}-${row.label}`,
    kind: 'streak',
    league: row.league as LeagueSlug,
    stat: `${line}+`,
    statLabel: row.label,
    name: row.name,
    context: run
      ? `${row.team} · ${detail.games} straight games`
      : `${row.team} · cleared in ${top?.cleared ?? games} of last ${games}`,
    to: playerPath(row.league, row.playerId),
    viz: {
      kind: 'pips',
      filled: Math.min(run ? detail.games : (top?.cleared ?? games), 12),
      total: Math.min(Math.max(games, run ? detail.games : 0), 12),
    },
  }
}

const UNIT: Record<string, string> = { nba: 'pts', nfl: 'pts', nhl: 'goals', mlb: 'runs' }

interface GameSignalResult {
  signal: StatSignal
  /** Higher = more worth showing. */
  weight: number
}

/**
 * A game earns a signal only when there is a number behind it: the live score,
 * a final margin, or a pre-game scoring edge computed from both teams' season
 * numbers. A start time is information, not a stat, so a game with nothing to
 * quantify produces no signal at all.
 */
function gameSignal(g: TickerGame): GameSignalResult | null {
  if (!g.dbId || !g.slug) return null
  const to = gamePath(g.slug, g.dbId)
  const name = `${g.away} @ ${g.home}`
  const base = { id: `game-${g.id}`, league: g.slug as LeagueSlug, name, to }
  const scored = g.awayScore !== undefined && g.homeScore !== undefined
  const a = g.awayForm
  const h = g.homeForm
  const form =
    a && h && (a.last5 || h.last5)
      ? {
          kind: 'form' as const,
          rows: [
            { team: g.away, results: a.last5 },
            { team: g.home, results: h.last5 },
          ],
        }
      : undefined

  if (g.live && scored) {
    return {
      weight: 1000,
      signal: {
        ...base,
        kind: 'live',
        stat: `${g.awayScore}–${g.homeScore}`,
        statLabel: 'LIVE SCORE',
        context: g.status,
        viz: form,
      },
    }
  }

  if (scored) {
    const diff = Math.abs(g.awayScore! - g.homeScore!)
    const winner = g.homeScore! > g.awayScore! ? g.home : g.away
    return {
      weight: 100 - diff,
      signal: {
        ...base,
        kind: 'final',
        stat: `+${diff}`,
        statLabel: 'FINAL MARGIN',
        context: `${winner} won ${Math.max(g.awayScore!, g.homeScore!)}–${Math.min(g.awayScore!, g.homeScore!)}`,
        viz: form,
      },
    }
  }

  // Pre-game: scoring edge = home net rating minus visitor net rating.
  if (
    a &&
    h &&
    a.gp > 1 &&
    h.gp > 1 &&
    a.ppg != null &&
    a.oppg != null &&
    h.ppg != null &&
    h.oppg != null
  ) {
    const homeNet = h.ppg - h.oppg
    const awayNet = a.ppg - a.oppg
    const edge = homeNet - awayNet
    const fav = edge >= 0 ? g.home : g.away
    const unit = UNIT[g.slug] ?? 'pts'
    return {
      weight: 500 + Math.abs(edge),
      signal: {
        ...base,
        kind: 'next',
        stat: SIGN(Math.abs(edge)),
        statLabel: `${fav} NET EDGE`,
        context: `${g.home} ${SIGN(homeNet)} ${unit}/g · ${g.away} ${SIGN(awayNet)} ${unit}/g`,
        viz: form,
      },
    }
  }
  return null
}

/**
 * Up to three signals for one league, from data already on the page: the
 * strongest trend, the most reliable streak (or the next-best trend for
 * leagues with no streak pipeline), and the slate's headline game. Anything
 * without backing data is dropped rather than filled with a placeholder.
 */
export function buildLeagueSignals(
  league: LeagueSlug,
  trending: TrendingRow[],
  streaks: StreakRow[],
  ticker: TickerGame[],
  today: string
): LeagueSignals {
  const trends = trending.filter((r) => r.league === league)
  const streakRows = streaks.filter((r) => r.league === league)
  const games = ticker.filter((g) => g.slug === league && isNearToday(g.date, today))

  const signals: StatSignal[] = []
  const hot = trends[0]
  if (hot) signals.push(hotSignal(hot, 'hot'))

  const streak = streakRows.map(streakSignal).find((s): s is StatSignal => s !== null)
  if (streak) {
    signals.push(streak)
  } else {
    // No streak model for this league: surface a different player's trend.
    const next = trends.find((r) => r.playerId !== hot?.playerId)
    if (next) signals.push(hotSignal(next, 'rising'))
  }

  const best = games
    .map(gameSignal)
    .filter((r): r is GameSignalResult => r !== null)
    .sort((x, y) => y.weight - x.weight)[0]
  if (best) signals.push(best.signal)

  return {
    league,
    label: league.toUpperCase(),
    gamesCount: games.length,
    liveCount: games.filter((g) => g.live).length,
    signals,
  }
}
