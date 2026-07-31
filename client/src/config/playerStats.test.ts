import { describe, it, expect } from 'vitest'
import { getPlayerStatConfig, allStatsFor, formatVolume } from './playerStats'

describe('nba stat config', () => {
  const cfg = getPlayerStatConfig('nba')

  it('uses game-count windows ending in 0 for all', () => {
    expect(cfg.windows).toEqual([5, 10, 20, 0])
  })

  it('gives every player the same role', () => {
    expect(cfg.roleOf({ position: 'G' })).toBe('player')
    expect(cfg.roleOf({ position: 'C' })).toBe('player')
  })

  it('uses minutes as the volume stat', () => {
    const v = cfg.volumeFor('player')
    expect(v?.key).toBe('minutes')
    expect(v?.label).toBe('MIN')
    expect(v?.get({ minutes: 34 })).toBe(34)
  })

  it('exposes pts, reb, ast, threes', () => {
    expect(cfg.statsFor('player').map((s) => s.key)).toEqual([
      'points',
      'rebounds',
      'assists',
      'threes',
    ])
  })

  it('derives PRA as the sum of points, rebounds, assists', () => {
    const pra = cfg.combosFor('player').find((c) => c.key === 'pra')
    expect(pra?.get({ points: 30, rebounds: 8, assists: 6 })).toBe(44)
  })

  it('returns null for PRA when a component is missing', () => {
    const pra = cfg.combosFor('player').find((c) => c.key === 'pra')
    expect(pra?.get({ points: 30, rebounds: null, assists: 6 })).toBeNull()
  })
})

describe('mlb stat config', () => {
  const cfg = getPlayerStatConfig('mlb')

  it('separates pitchers from batters by position', () => {
    expect(cfg.roleOf({ position: 'SP' })).toBe('pitcher')
    expect(cfg.roleOf({ position: 'RP' })).toBe('pitcher')
    expect(cfg.roleOf({ position: 'CF' })).toBe('batter')
    expect(cfg.roleOf({ position: null })).toBe('batter')
  })

  it('gives batters plate appearances and pitchers outs', () => {
    expect(cfg.volumeFor('batter')?.key).toBe('plateAppearances')
    expect(cfg.volumeFor('pitcher')?.key).toBe('outsPitched')
  })

  it('gives the two roles disjoint stat sets', () => {
    const b = cfg.statsFor('batter').map((s) => s.key)
    const p = cfg.statsFor('pitcher').map((s) => s.key)
    expect(b.some((k) => p.includes(k))).toBe(false)
  })
})

describe('nhl stat config', () => {
  const cfg = getPlayerStatConfig('nhl')

  it('reads the role off the game row position type', () => {
    expect(cfg.roleOf({ position: 'G' }, { positionType: 'goalie' })).toBe('goalie')
    expect(cfg.roleOf({ position: 'C' }, { positionType: 'skater' })).toBe('skater')
  })

  it('defaults to skater with no sample row', () => {
    expect(cfg.roleOf({ position: 'C' })).toBe('skater')
  })

  it('formats time on ice as minutes and seconds', () => {
    const toi = cfg.volumeFor('skater')
    expect(toi?.key).toBe('toiSeconds')
    expect(formatVolume(toi, 1122)).toBe('18:42')
    expect(formatVolume(toi, 605)).toBe('10:05')
  })

  it('gives goalies saves rather than goals', () => {
    const keys = cfg.statsFor('goalie').map((s) => s.key)
    expect(keys).toContain('saves')
    expect(keys).not.toContain('goals')
  })
})

describe('nfl stat config', () => {
  const cfg = getPlayerStatConfig('nfl')

  it('uses a 17-game season shaped window set', () => {
    expect(cfg.windows).toEqual([3, 6, 17, 0])
  })

  it('buckets positions into roles', () => {
    expect(cfg.roleOf({ position: 'QB' })).toBe('qb')
    expect(cfg.roleOf({ position: 'RB' })).toBe('rb')
    expect(cfg.roleOf({ position: 'FB' })).toBe('rb')
    expect(cfg.roleOf({ position: 'WR' })).toBe('receiver')
    expect(cfg.roleOf({ position: 'TE' })).toBe('receiver')
    expect(cfg.roleOf({ position: 'LB' })).toBe('defense')
    expect(cfg.roleOf({ position: 'PK' })).toBe('kicker')
    expect(cfg.roleOf({ position: null })).toBe('defense')
  })

  it('varies the volume stat by role', () => {
    expect(cfg.volumeFor('qb')?.key).toBe('attempts')
    expect(cfg.volumeFor('rb')?.key).toBe('carries')
    expect(cfg.volumeFor('receiver')?.key).toBe('targets')
    expect(cfg.volumeFor('kicker')).toBeNull()
  })

  it('gives receivers a scrimmage-yards combo', () => {
    const combo = cfg.combosFor('receiver').find((c) => c.key === 'scrimmageYards')
    expect(combo?.get({ receivingYards: 80, rushingYards: 12 })).toBe(92)
  })
})

describe('allStatsFor', () => {
  it('concatenates single stats and combos', () => {
    const cfg = getPlayerStatConfig('nba')
    const keys = allStatsFor(cfg, 'player').map((s) => s.key)
    expect(keys).toContain('points')
    expect(keys).toContain('pra')
  })
})

describe('formatVolume', () => {
  it('renders a dash for a null value', () => {
    expect(formatVolume(getPlayerStatConfig('nba').volumeFor('player'), null)).toBe('—')
  })

  it('renders a plain number when the def has no formatter', () => {
    expect(formatVolume(getPlayerStatConfig('nba').volumeFor('player'), 34)).toBe('34')
  })
})
