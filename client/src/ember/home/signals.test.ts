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
    // A game with nothing to quantify produces no signal, not a placeholder.
    expect(out.signals.map((s) => s.kind)).toEqual(['hot', 'rising'])
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

  it('quantifies an upcoming game as a scoring edge, never a time or a bare VS', () => {
    const upcoming = game('nba', 7, {
      status: '10/28 - 7:00 PM EDT',
      time: '2026-10-28T23:00Z',
      awayForm: { record: '2–2', ppg: 109.2, oppg: 111.0, last5: 'LWLW', gp: 4 },
      homeForm: { record: '3–1', ppg: 118.5, oppg: 105.3, last5: 'WWLW', gp: 4 },
    })
    const out = buildLeagueSignals('nba', [], [], [upcoming], TODAY)
    const sig = out.signals.find((x) => x.kind === 'next')!
    expect(sig.stat).toBe('+15.0')
    expect(sig.stat).not.toMatch(/PM|AM|:/)
    expect(sig.statLabel).toBe('HOM NET EDGE')
    expect(sig.viz).toEqual({
      kind: 'form',
      rows: [
        { team: 'AWY', results: 'LWLW' },
        { team: 'HOM', results: 'WWLW' },
      ],
    })
  })

  it('drops an upcoming game that has no season numbers behind it', () => {
    const bare = game('nba', 8, { status: '10/28 - 7:00 PM EDT', time: '2026-10-28T23:00Z' })
    expect(buildLeagueSignals('nba', [], [], [bare], TODAY).signals).toEqual([])
  })

  it('shows a final game as its margin', () => {
    const done = game('nba', 9, { awayScore: 98, homeScore: 112 })
    const sig = buildLeagueSignals('nba', [], [], [done], TODAY).signals[0]!
    expect(sig.kind).toBe('final')
    expect(sig.stat).toBe('+14')
    expect(sig.context).toBe('HOM won 112–98')
  })
})
