import { describe, it, expect } from 'vitest'
import {
  filterGames,
  averageOf,
  defaultLine,
  hitRate,
  opponentsOf,
  splitsFor,
  gamesVersus,
  matchupSignal,
  resolveMatchupOpponent,
} from './derive'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { GameRow, PlayerFilters } from './types'

const pts = getPlayerStatConfig('nba').statsFor('player')[0]

// Most recent first, matching the API's ordering.
const GAMES: GameRow[] = [
  { date: '2026-04-10', opponent: 'BOS', isHome: true, points: 30, rebounds: 5, assists: 4, minutes: 36 },
  { date: '2026-04-08', opponent: 'LAL', isHome: false, points: 20, rebounds: 7, assists: 6, minutes: 33 },
  { date: '2026-04-06', opponent: 'BOS', isHome: false, points: 25, rebounds: 4, assists: 5, minutes: 31 },
  { date: '2026-04-04', opponent: 'MIA', isHome: true, points: 10, rebounds: 9, assists: 2, minutes: 22 },
  { date: '2026-04-02', opponent: 'BOS', isHome: true, points: 40, rebounds: 3, assists: 8, minutes: 38 },
]

const base: PlayerFilters = {
  window: 0,
  vsTeam: null,
  homeAway: 'all',
  stat: 'points',
  line: 25,
  lineTouched: false,
}

describe('filterGames', () => {
  it('returns everything when the window is 0', () => {
    expect(filterGames(GAMES, base)).toHaveLength(5)
  })

  it('slices the most recent N for a window', () => {
    const out = filterGames(GAMES, { ...base, window: 3 })
    expect(out.map((g) => g.date)).toEqual(['2026-04-10', '2026-04-08', '2026-04-06'])
  })

  it('returns the whole log when the window exceeds it', () => {
    expect(filterGames(GAMES, { ...base, window: 50 })).toHaveLength(5)
  })

  it('filters by opponent', () => {
    expect(filterGames(GAMES, { ...base, vsTeam: 'BOS' })).toHaveLength(3)
  })

  it('applies the window before the opponent filter', () => {
    // Last 3 games contain two BOS games, not all three.
    const out = filterGames(GAMES, { ...base, window: 3, vsTeam: 'BOS' })
    expect(out).toHaveLength(2)
  })

  it('filters by home and away', () => {
    expect(filterGames(GAMES, { ...base, homeAway: 'home' })).toHaveLength(3)
    expect(filterGames(GAMES, { ...base, homeAway: 'away' })).toHaveLength(2)
  })

  it('combines opponent and venue filters', () => {
    const out = filterGames(GAMES, { ...base, vsTeam: 'BOS', homeAway: 'away' })
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-04-06')
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterGames(GAMES, { ...base, vsTeam: 'NYK' })).toEqual([])
  })
})

describe('averageOf', () => {
  it('averages the stat across games', () => {
    expect(averageOf(GAMES, pts)).toBe(25)
  })

  it('ignores games missing the stat', () => {
    expect(averageOf([{ points: 10 }, { points: null }], pts)).toBe(10)
  })

  it('returns null with no usable games', () => {
    expect(averageOf([], pts)).toBeNull()
    expect(averageOf([{ points: null }], pts)).toBeNull()
  })
})

describe('defaultLine', () => {
  it('rounds the average to the nearest half', () => {
    expect(defaultLine([{ points: 20 }, { points: 21 }], pts)).toBe(20.5)
    expect(defaultLine([{ points: 20 }, { points: 20 }, { points: 21 }], pts)).toBe(20.5)
  })

  it('returns 0 when there is no data', () => {
    expect(defaultLine([], pts)).toBe(0)
  })
})

describe('hitRate', () => {
  it('counts over, under, and push as three outcomes', () => {
    const r = hitRate(GAMES, pts, 25)
    expect(r).toMatchObject({ over: 2, under: 2, push: 1, total: 5 })
  })

  it('does not fold pushes into overs', () => {
    expect(hitRate([{ points: 25 }], pts, 25)).toMatchObject({ over: 0, push: 1 })
  })

  it('computes percentage over non-push games only', () => {
    // 2 over, 2 under, 1 push → 2/4 = 50%
    expect(hitRate(GAMES, pts, 25).pct).toBe(50)
  })

  it('returns a null percentage when every game pushed', () => {
    expect(hitRate([{ points: 25 }], pts, 25).pct).toBeNull()
  })

  it('handles an empty set', () => {
    expect(hitRate([], pts, 25)).toEqual({ over: 0, under: 0, push: 0, total: 0, pct: null })
  })
})

describe('opponentsOf', () => {
  it('lists unique opponents alphabetically', () => {
    expect(opponentsOf(GAMES)).toEqual(['BOS', 'LAL', 'MIA'])
  })

  it('ignores rows with no opponent', () => {
    expect(opponentsOf([{ opponent: null }, { opponent: 'BOS' }])).toEqual(['BOS'])
  })
})

describe('gamesVersus', () => {
  it('selects only games against the team', () => {
    expect(gamesVersus(GAMES, 'BOS')).toHaveLength(3)
  })
})

describe('splitsFor', () => {
  const defs = getPlayerStatConfig('nba').statsFor('player').slice(0, 2)

  it('reports season and versus averages side by side with a delta', () => {
    const out = splitsFor(GAMES, gamesVersus(GAMES, 'BOS'), defs)
    const p = out.find((s) => s.key === 'points')!
    expect(p.season).toBe(25)
    expect(p.versus).toBeCloseTo(31.67, 1)
    expect(p.delta).toBeCloseTo(6.67, 1)
  })

  it('returns a null versus and delta when there are no meetings', () => {
    const out = splitsFor(GAMES, [], defs)
    expect(out[0].versus).toBeNull()
    expect(out[0].delta).toBeNull()
    expect(out[0].season).not.toBeNull()
  })
})

describe('matchupSignal', () => {
  const split = {
    allowedPerGame: 26.4,
    leagueRank: 28,
    positionGroup: 'G',
    stat: 'pts',
    asOf: '2026-06-15',
  }

  it('grades a high rank as a good matchup for the player', () => {
    // Rank 28 of 30 in points allowed = a soft defense.
    expect(matchupSignal(split, 30)?.bucket).toBe('GREAT')
  })

  it('grades a low rank as a tough matchup', () => {
    expect(matchupSignal({ ...split, leagueRank: 2 }, 30)?.bucket).toBe('BRUTAL')
  })

  it('grades the middle of the league as neutral', () => {
    expect(matchupSignal({ ...split, leagueRank: 15 }, 30)?.bucket).toBe('NEUTRAL')
  })

  it('carries the underlying number through for display', () => {
    const s = matchupSignal(split, 30)!
    expect(s.allowed).toBe(26.4)
    expect(s.rank).toBe(28)
    expect(s.asOf).toBe('2026-06-15')
  })

  it('returns null with no defense data', () => {
    expect(matchupSignal(null, 30)).toBeNull()
  })

  it('returns null when the rank is missing', () => {
    expect(matchupSignal({ ...split, leagueRank: null }, 30)).toBeNull()
  })
})

describe('resolveMatchupOpponent', () => {
  const upcoming = {
    gameId: 1,
    date: '2026-08-02',
    opponent: 'BOS',
    opponentTeamId: 5,
    isHome: true,
    daysRest: 2,
  }

  it('prefers the scheduled opponent', () => {
    expect(resolveMatchupOpponent(upcoming, null)).toEqual({
      team: 'BOS',
      source: 'schedule',
      upcoming,
    })
  })

  it('falls back to the filter selection out of season', () => {
    expect(resolveMatchupOpponent(null, 'MIA')).toEqual({
      team: 'MIA',
      source: 'filter',
      upcoming: null,
    })
  })

  it('lets an explicit filter override the schedule', () => {
    const out = resolveMatchupOpponent(upcoming, 'MIA')
    expect(out).toEqual({ team: 'MIA', source: 'filter', upcoming: null })
  })

  it('keeps the scheduled game when the filter names that same team', () => {
    // Filtering to the upcoming opponent should not discard the game context.
    expect(resolveMatchupOpponent(upcoming, 'BOS')).toEqual({
      team: 'BOS',
      source: 'schedule',
      upcoming,
    })
  })

  it('returns null when there is neither', () => {
    expect(resolveMatchupOpponent(null, null)).toBeNull()
  })
})
