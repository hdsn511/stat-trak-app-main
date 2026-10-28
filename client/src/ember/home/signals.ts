import type { TickerGame } from '@/ember/components/LiveTicker'
import type { StreakRow } from '@/ember/components/StreakWatch'
import type { TrendingRow } from '@/ember/components/TrendingPlayers'
import type { LeagueSlug } from '@/config/leagues'
import { gamePath, playerPath } from '@/lib/paths'
import { formatGameTime } from '@/ember/game/format'

export type SignalKind = 'hot' | 'rising' | 'streak' | 'live' | 'final' | 'next'

export interface StatSignal {
  id: string
  kind: SignalKind
  /** The headline number, rendered large. */
  stat: string
  /** What the headline number measures, e.g. "PTS · L10". */
  statLabel: string
  name: string
  context: string
  to: string
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
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b))
}

function hotSignal(row: TrendingRow, kind: 'hot' | 'rising'): StatSignal {
  return {
    id: `${kind}-${row.league}-${row.playerId}-${row.stat}`,
    kind,
    stat: `${row.l10Val}`,
    statLabel: `${row.stat} · L10`,
    name: row.name,
    context: `${row.team} · ${row.delta} vs ${row.seasonVal} season avg`,
    to: playerPath(row.league, row.playerId),
  }
}

function streakSignal(row: StreakRow): StatSignal | null {
  const { detail } = row
  const run = detail.kind === 'run'
  const line = run ? detail.line : detail.tiers[0]?.line
  if (line == null || (!run && line <= 0)) return null
  return {
    id: `streak-${row.league}-${row.playerId}-${row.label}`,
    kind: 'streak',
    stat: `${line}+`,
    statLabel: row.label,
    name: row.name,
    context: run
      ? `${row.team} · ${detail.games} straight games`
      : `${row.team} · cleared in all 10 of last 10`,
    to: playerPath(row.league, row.playerId),
  }
}

const START_LABEL: Record<string, string> = {
  nba: 'TIPOFF',
  nfl: 'KICKOFF',
  nhl: 'PUCK DROP',
  mlb: 'FIRST PITCH',
}
const SCORE_UNIT: Record<string, string> = { nba: 'pts', nfl: 'pts', nhl: 'goals', mlb: 'runs' }

/**
 * Why a matchup matters, in numbers: both records with recent form, and the
 * home offense against the visitor's defense. Empty when neither team has a
 * played game yet, so a signal is never just "A @ B".
 */
function matchupContext(g: TickerGame): string {
  const a = g.awayForm
  const h = g.homeForm
  const parts: string[] = []
  if (a && a.gp > 0) parts.push(`${g.away} ${a.record}${a.last5 ? ` (${a.last5})` : ''}`)
  if (h && h.gp > 0) parts.push(`${g.home} ${h.record}${h.last5 ? ` (${h.last5})` : ''}`)
  if (g.slug && h?.ppg != null && a?.oppg != null && h.gp > 1 && a.gp > 1) {
    parts.push(`${g.home} scores ${h.ppg} ${SCORE_UNIT[g.slug] ?? 'pts'}/g vs ${g.away} allowing ${a.oppg}`)
  }
  return parts.join(' · ')
}

function gameSignal(g: TickerGame): StatSignal | null {
  if (!g.dbId || !g.slug) return null
  const scored = g.awayScore !== undefined && g.homeScore !== undefined
  const kind: SignalKind = g.live ? 'live' : scored ? 'final' : 'next'
  const matchup = matchupContext(g)
  const start = formatGameTime(g.time ?? null)
  return {
    id: `game-${g.id}`,
    kind,
    // Never a bare "VS": the headline is the score once there is one, else the
    // start time, else the visitor's and home team's records.
    stat: scored ? `${g.awayScore}–${g.homeScore}` : (start ?? 'TBD'),
    statLabel:
      kind === 'live' ? 'LIVE' : kind === 'final' ? 'FINAL' : (START_LABEL[g.slug] ?? 'START'),
    name: `${g.away} @ ${g.home}`,
    context: matchup || g.status,
    to: gamePath(g.slug, g.dbId),
  }
}

/** Live first, then the closest finished game, then the next one scheduled. */
function pickGame(games: TickerGame[]): TickerGame | undefined {
  const usable = games.filter((g) => g.dbId && g.slug)
  const live = usable.find((g) => g.live)
  if (live) return live
  const margin = (g: TickerGame) =>
    g.awayScore !== undefined && g.homeScore !== undefined
      ? Math.abs(g.awayScore - g.homeScore)
      : Infinity
  const finished = usable.filter((g) => margin(g) !== Infinity).sort((a, b) => margin(a) - margin(b))
  return finished[0] ?? usable[0]
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

  const game = pickGame(games)
  const gs = game ? gameSignal(game) : null
  if (gs) signals.push(gs)

  return {
    league,
    label: league.toUpperCase(),
    gamesCount: games.length,
    liveCount: games.filter((g) => g.live).length,
    signals,
  }
}
