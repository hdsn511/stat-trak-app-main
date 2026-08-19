import { describe, it, expect } from 'vitest'
import { parseQueryFilters, sanitizeQueryFilters } from './queryFilters'

const STATS = ['points', 'rebounds', 'assists', 'threes', 'pra']

describe('parseQueryFilters', () => {
  it('reads a game window', () => {
    expect(parseQueryFilters('last 10 games', STATS).window).toBe(10)
    expect(parseQueryFilters('over his last 5', STATS).window).toBe(5)
  })

  it('reads an opponent', () => {
    expect(parseQueryFilters('luka vs BOS this year', STATS).vsTeam).toBe('BOS')
    expect(parseQueryFilters('against LAL', STATS).vsTeam).toBe('LAL')
  })

  it('reads a line', () => {
    expect(parseQueryFilters('over 27.5 points', STATS).line).toBe(27.5)
  })

  it('reads a venue', () => {
    expect(parseQueryFilters('at home', STATS).homeAway).toBe('home')
    expect(parseQueryFilters('on the road', STATS).homeAway).toBe('away')
  })

  it('maps stat words to config keys', () => {
    expect(parseQueryFilters('points', STATS).stat).toBe('points')
    expect(parseQueryFilters('who rebounds best', STATS).stat).toBe('rebounds')
    expect(parseQueryFilters('pra leaders', STATS).stat).toBe('pra')
  })

  it('returns an empty object when nothing matches', () => {
    expect(parseQueryFilters('tell me something interesting', STATS)).toEqual({})
  })

  it('does not invent a team from a lowercase word', () => {
    expect(parseQueryFilters('vs the best defenses', STATS).vsTeam).toBeUndefined()
  })

  it('ignores a stat the league config does not have', () => {
    expect(parseQueryFilters('rebounds', ['points']).stat).toBeUndefined()
  })

  it('combines everything in one query', () => {
    expect(parseQueryFilters('luka over 27.5 points vs BOS in his last 10 at home', STATS)).toEqual({
      window: 10,
      vsTeam: 'BOS',
      line: 27.5,
      homeAway: 'home',
      stat: 'points',
    })
  })
})

describe('sanitizeQueryFilters', () => {
  it('passes through a valid object', () => {
    expect(sanitizeQueryFilters({ window: 10, vsTeam: 'BOS', stat: 'points' }, STATS)).toEqual({
      window: 10,
      vsTeam: 'BOS',
      stat: 'points',
    })
  })

  it('drops an unknown stat', () => {
    expect(sanitizeQueryFilters({ stat: 'touchdowns' }, STATS)).toEqual({})
  })

  it('drops a negative or absurd window', () => {
    expect(sanitizeQueryFilters({ window: -3 }, STATS)).toEqual({})
    expect(sanitizeQueryFilters({ window: 9999 }, STATS)).toEqual({})
  })

  it('drops a malformed team', () => {
    expect(sanitizeQueryFilters({ vsTeam: 42 }, STATS)).toEqual({})
    expect(sanitizeQueryFilters({ vsTeam: 'NOT A TEAM' }, STATS)).toEqual({})
  })

  it('drops a non-numeric line', () => {
    expect(sanitizeQueryFilters({ line: 'high' }, STATS)).toEqual({})
  })

  it('tolerates null and non-object input', () => {
    expect(sanitizeQueryFilters(null, STATS)).toEqual({})
    expect(sanitizeQueryFilters('nope', STATS)).toEqual({})
  })

  it('accepts a valid venue and rejects an invalid one', () => {
    expect(sanitizeQueryFilters({ homeAway: 'away' }, STATS)).toEqual({ homeAway: 'away' })
    expect(sanitizeQueryFilters({ homeAway: 'moon' }, STATS)).toEqual({})
  })
})
