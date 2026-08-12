import { describe, it, expect } from 'vitest'
import type { PlayerStreakRow, TodaysGame, TrendingPlayer } from '@/services/api'
import {
  rankStreaks,
  rankTrending,
  statLabel,
  toStreakRows,
  toTickerGames,
  toTrendingRows,
} from './adapters'

const trending = (over: Partial<TrendingPlayer> = {}): TrendingPlayer => ({
  playerId: 1,
  playerName: 'Player One',
  team: 'LAL',
  position: 'SF',
  stat: 'points',
  statId: 0,
  zScore: 1.5,
  rollingAvg: 27.44,
  windowSize: 10,
  seasonAvg: 24.11,
  ...over,
})

const streak = (over: Partial<PlayerStreakRow> = {}): PlayerStreakRow => ({
  player_id: 1,
  player_name: 'Player One',
  team: 'LAL',
  position: 'SF',
  line_100: 20.5,
  line_90: 22.5,
  line_80: 24.5,
  line_70: 26.5,
  rolling_avg: 25.55,
  games_used: 10,
  opponent: null,
  ...over,
})

describe('statLabel', () => {
  it('maps spelled-out stats to tickers', () => {
    expect(statLabel('points')).toBe('PTS')
    expect(statLabel('total_bases')).toBe('TB')
  })

  it('covers the other leagues too', () => {
    expect(statLabel('shots_on_goal')).toBe('SOG')
    expect(statLabel('receiving_yards')).toBe('REC YDS')
  })

  it('falls back to uppercase for anything unmapped', () => {
    expect(statLabel('faceoff_wins')).toBe('FACEOFF_WINS')
  })
})

describe('toTrendingRows', () => {
  it('rounds and signs the delta against the season average', () => {
    const [row] = toTrendingRows('nba', [trending()])
    expect(row!.seasonVal).toBe(24.1)
    expect(row!.l10Val).toBe(27.4)
    expect(row!.delta).toBe('+3.3')
  })

  it('signs a negative delta', () => {
    const [row] = toTrendingRows('nba', [trending({ rollingAvg: 20, seasonAvg: 24 })])
    expect(row!.delta).toBe('-4.0')
  })

  it('carries league and id so the row can link out', () => {
    const [row] = toTrendingRows('mlb', [trending({ playerId: 99 })])
    expect(row!.league).toBe('mlb')
    expect(row!.leagueLabel).toBe('MLB')
    expect(row!.playerId).toBe(99)
  })

  it('treats a missing season average as zero rather than NaN', () => {
    const [row] = toTrendingRows('nba', [trending({ seasonAvg: null })])
    expect(row!.seasonVal).toBe(0)
    expect(row!.delta).toBe('+27.4')
  })
})

describe('toStreakRows', () => {
  it('uses the tier ladder when no active run is reported', () => {
    const [row] = toStreakRows('nba', [streak()], 'PTS')
    expect(row!.detail.kind).toBe('tiers')
    if (row!.detail.kind === 'tiers') {
      expect(row!.detail.tiers.map((t) => t.pct)).toEqual([100, 90, 80, 70])
      expect(row!.detail.tiers[0]!.line).toBe(20.5)
    }
  })

  it('uses the run model when the API reports a streak count', () => {
    const [row] = toStreakRows(
      'mlb',
      [streak({ streak_count: 7, streak_line: 1, line_100: 0, line_90: 0, line_80: 0, line_70: 0 })],
      'H'
    )
    expect(row!.detail).toEqual({ kind: 'run', games: 7, line: 1 })
  })

  it('defaults a run with no reported level to 1+', () => {
    const [row] = toStreakRows('mlb', [streak({ streak_count: 4, streak_line: undefined })], 'H')
    if (row!.detail.kind === 'run') expect(row!.detail.line).toBe(1)
  })

  it('rounds the rolling average for display', () => {
    const [row] = toStreakRows('nba', [streak()], 'PTS')
    expect(row!.rollingAvg).toBe(25.6)
  })
})

describe('toTickerGames', () => {
  const game = (over: Partial<TodaysGame> = {}): TodaysGame => ({
    gameId: 'ext-1',
    dbId: 500,
    date: '2026-08-11',
    time: null,
    status: 'Final',
    live: false,
    home: { team: 'DET', score: '4' },
    away: { team: 'CLE', score: '2' },
    ...over,
  })

  it('carries the ids needed to link to the game page', () => {
    const [g] = toTickerGames('mlb', [game()])
    expect(g!.dbId).toBe(500)
    expect(g!.slug).toBe('mlb')
    expect(g!.league).toBe('MLB')
  })

  it('leaves scores undefined when the slate has none', () => {
    const [g] = toTickerGames('nba', [game({ home: { team: 'A', score: '' }, away: { team: 'B', score: '' } })])
    expect(g!.homeScore).toBeUndefined()
    expect(g!.awayScore).toBeUndefined()
  })

  it('namespaces the key by league so two sports cannot collide', () => {
    const [a] = toTickerGames('nba', [game({ gameId: '1' })])
    const [b] = toTickerGames('nhl', [game({ gameId: '1' })])
    expect(a!.id).not.toBe(b!.id)
  })
})

describe('ranking', () => {
  it('orders trending by z-score and numbers the rows', () => {
    const rows = toTrendingRows('nba', [
      trending({ playerId: 1, zScore: 0.4 }),
      trending({ playerId: 2, zScore: 2.9 }),
      trending({ playerId: 3, zScore: 1.2 }),
    ])
    expect(rankTrending(rows, 3).map((r) => [r.rank, r.playerId])).toEqual([
      [1, 2],
      [2, 3],
      [3, 1],
    ])
  })

  it('honours the limit', () => {
    const rows = toTrendingRows('nba', [trending({ playerId: 1 }), trending({ playerId: 2 })])
    expect(rankTrending(rows, 1)).toHaveLength(1)
  })

  it('groups active runs ahead of tier lines rather than comparing the units', () => {
    const rows = [
      ...toStreakRows('nba', [streak({ player_id: 1, line_100: 12.5 })], 'PTS'),
      ...toStreakRows('mlb', [streak({ player_id: 2, streak_count: 9, streak_line: 1 })], 'H'),
      ...toStreakRows('nba', [streak({ player_id: 3, line_100: 30.5 })], 'PTS'),
    ]
    // Runs first, then tiers by guaranteed line — a 30.5 points line must not
    // outrank a nine-game hitting streak just because 30.5 > 9.
    expect(rankStreaks(rows, 3).map((r) => r.playerId)).toEqual([2, 3, 1])
  })

  it('orders several active runs by length', () => {
    const rows = [
      ...toStreakRows('mlb', [streak({ player_id: 1, streak_count: 4, streak_line: 1 })], 'H'),
      ...toStreakRows('mlb', [streak({ player_id: 2, streak_count: 11, streak_line: 1 })], 'H'),
    ]
    expect(rankStreaks(rows, 2).map((r) => r.playerId)).toEqual([2, 1])
  })
})
