import { describe, it, expect } from 'vitest'
import { buildLeagueSignals, inSeasonLeagues, isNearToday } from './signals'
import type { TickerGame } from '@/ember/components/LiveTicker'
import type { StreakRow } from '@/ember/components/StreakWatch'
import type { TrendingRow } from '@/ember/components/TrendingPlayers'

const TODAY = '2026-10-13'

const trend = (league: string, id: number, over: Partial<TrendingRow> = {}): TrendingRow => ({
  rank: 1,
  playerId: id,
  league,
  leagueLabel: league.toUpperCase(),
  name: `Player ${id}`,
  team: 'AAA',
  stat: 'PTS',
  chips: [],
  seasonVal: 20,
  l10Val: 27.5,
  delta: '+7.5',
  zScore: 1.5,
  ...over,
})

const game = (league: string, id: number, over: Partial<TickerGame> = {}): TickerGame => ({
  id: `${league}-${id}`,
  dbId: id,
  slug: league,
  league: league.toUpperCase(),
  date: TODAY,
  away: 'AWY',
  home: 'HOM',
  status: 'Final',
  ...over,
})

const streak = (league: string, id: number): StreakRow => ({
  playerId: id,
  league,
  leagueLabel: league.toUpperCase(),
  name: `Streaker ${id}`,
  team: 'BBB',
  label: 'H',
  rollingAvg: 2,
  opponent: null,
  detail: { kind: 'run', games: 9, line: 1 },
})

describe('inSeasonLeagues', () => {
  it('keeps leagues with a game inside the window and drops dated-away slates', () => {
    const ticker = [
      game('mlb', 1),
      game('mlb', 2),
      game('nhl', 3, { date: '2026-10-11' }),
      game('nba', 4, { date: '2026-06-19' }), // off-season fallback slate
    ]
    expect(inSeasonLeagues(ticker, TODAY, ['nba', 'mlb', 'nfl', 'nhl'])).toEqual(['mlb', 'nhl'])
  })

  it('orders by busiest slate, then registry order', () => {
    const ticker = [game('nfl', 1), game('nhl', 2), game('nhl', 3)]
    expect(inSeasonLeagues(ticker, TODAY, ['nba', 'mlb', 'nfl', 'nhl'])).toEqual(['nhl', 'nfl'])
  })

  it('treats a missing date as not near', () => {
    expect(isNearToday(null, TODAY)).toBe(false)
    expect(isNearToday('2026-10-16', TODAY)).toBe(true)
    expect(isNearToday('2026-10-17', TODAY)).toBe(false)
  })
})

describe('buildLeagueSignals', () => {
  it('returns hot trend, streak and a game for a league with all three', () => {
    const out = buildLeagueSignals(
      'mlb',
      [trend('mlb', 1), trend('mlb', 2)],
      [streak('mlb', 9)],
      [game('mlb', 5, { awayScore: 3, homeScore: 2 })],
      TODAY
    )
    expect(out.signals.map((s) => s.kind)).toEqual(['hot', 'streak', 'final'])
    expect(out.signals[1]!.stat).toBe('1+')
  })

  it('falls back to a second player trend when the league has no streaks', () => {
    const out = buildLeagueSignals(
      'nhl',
      [trend('nhl', 1), trend('nhl', 2)],
      [],
      [game('nhl', 5)],
      TODAY
    )
    expect(out.signals.map((s) => s.kind)).toEqual(['hot', 'rising', 'next'])
    expect(out.signals[0]!.name).not.toBe(out.signals[1]!.name)
  })

  it('prefers a live game and ignores other leagues', () => {
    const out = buildLeagueSignals(
      'nfl',
      [trend('nfl', 1), trend('nba', 2)],
      [],
      [
        game('nfl', 1, { awayScore: 10, homeScore: 9 }),
        game('nfl', 2, { live: true, awayScore: 0, homeScore: 3, status: 'Q2' }),
        game('nba', 3),
      ],
      TODAY
    )
    const g = out.signals.find((s) => s.kind === 'live')
    expect(g?.stat).toBe('0–3')
    expect(out.gamesCount).toBe(2)
    expect(out.liveCount).toBe(1)
    expect(out.signals.every((s) => !s.to.includes('/nba/'))).toBe(true)
  })

  it('returns no signals rather than placeholders when there is no data', () => {
    expect(buildLeagueSignals('nba', [], [], [], TODAY).signals).toEqual([])
  })
})
