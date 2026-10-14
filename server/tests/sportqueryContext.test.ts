import { describe, it, expect } from 'vitest'
import { mergePlayerContext, playerIdOf, type PlayerContext } from '../src/services/sportqueryContext'
import { enrich } from '../src/services/sportqueryEnrich'

const ctx = new Map<number, PlayerContext>([
  [10, { team: 'NYY', league: 'mlb' }],
  [20, { team: 'EDM', league: 'nhl' }],
])

describe('playerIdOf', () => {
  it('reads player_id, and entity_id only on player-prop rows', () => {
    expect(playerIdOf({ player_id: 10 })).toBe(10)
    expect(playerIdOf({ player_id: '10' })).toBe(10)
    expect(playerIdOf({ entity_id: 10, prop_type: 'player' })).toBe(10)
    expect(playerIdOf({ entity_id: 10, prop_type: 'game' })).toBeNull()
    expect(playerIdOf({ name: 'x' })).toBeNull()
  })
})

describe('mergePlayerContext', () => {
  it('adds team and league where the query returned neither', () => {
    const [row] = mergePlayerContext([{ player_id: 10, name: 'Aaron Judge', hr: 5 }], ctx)
    expect(row).toMatchObject({ team: 'NYY', league: 'mlb', name: 'Aaron Judge' })
  })

  it('never overwrites a team column the query already returned', () => {
    const [row] = mergePlayerContext([{ player_id: 10, team_abbr: 'BOS' }], ctx)
    expect(row!.team).toBeUndefined()
    expect(row!.team_abbr).toBe('BOS')
  })

  it('leaves rows without a known player untouched', () => {
    const rows = [{ player_id: 999, name: 'Nobody' }, { game_id: 1 }]
    expect(mergePlayerContext(rows, ctx)).toEqual(rows)
  })
})

describe('league-aware trend labels', () => {
  it('labels the same stat id differently per sport', () => {
    const base = { trend_val: 1, window_size: 10, stat: 0 }
    const [nba] = enrich('player_trends', [{ ...base, league: 'nba' }])
    const [mlb] = enrich('player_trends', [{ ...base, league: 'mlb' }])
    const [nhl] = enrich('player_trends', [{ ...base, league: 'nhl' }])
    expect([nba.statLabel, mlb.statLabel, nhl.statLabel]).toEqual(['PTS', 'H', 'G'])
  })

  it('keeps the NBA labels when no league is known', () => {
    const [r] = enrich('player_trends', [{ trend_val: 1, window_size: 10, stat: 2 }])
    expect(r.statLabel).toBe('AST')
  })
})
