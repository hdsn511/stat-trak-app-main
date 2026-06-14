import { describe, it, expect } from 'vitest'
import { LEAGUES, getLeague } from './leagues'

describe('league registry', () => {
  it('exposes nba, mlb, nhl, nfl in order', () => {
    expect(LEAGUES.map((l) => l.slug)).toEqual(['nba', 'mlb', 'nhl', 'nfl'])
  })

  it('marks nba and mlb available with a perfApi and streak stats', () => {
    for (const slug of ['nba', 'mlb'] as const) {
      const def = getLeague(slug)
      expect(def.available).toBe(true)
      expect(def.perfApi).toBeDefined()
      expect(def.streakStats && def.streakStats.length).toBeGreaterThan(0)
    }
  })

  it('points each league perfApi at its own prefix', () => {
    expect(getLeague('nba').perfApi?.getSummary).toBeTypeOf('function')
    // nba uses the legacy /performance prefix, mlb uses /mlb/performance —
    // distinct client instances.
    expect(getLeague('nba').perfApi).not.toBe(getLeague('mlb').perfApi)
  })

  it('marks nhl and nfl as coming-soon with no data wiring', () => {
    for (const slug of ['nhl', 'nfl'] as const) {
      const def = getLeague(slug)
      expect(def.available).toBe(false)
      expect(def.perfApi).toBeUndefined()
      expect(def.streakStats).toBeUndefined()
    }
  })

  it('streak stat keys are lowercase tokens matching backend row.stat', () => {
    for (const slug of ['nba', 'mlb'] as const) {
      for (const s of getLeague(slug).streakStats ?? []) {
        expect(s.key).toMatch(/^[a-z0-9]+$/)
        expect(s.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('getLeague falls back to nba for an unknown slug', () => {
    // @ts-expect-error exercising the runtime fallback path
    expect(getLeague('xyz').slug).toBe('nba')
  })
})
