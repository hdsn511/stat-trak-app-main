import { describe, it, expect } from 'vitest'
import { detectShape, enrich } from '../src/services/sportqueryEnrich'

describe('detectShape', () => {
  it('detects player_trends when trend_val and window_size present', () => {
    const rows = [{ player_id: 1, name: 'Luka', trend_val: 2.3, window_size: 10 }]
    expect(detectShape(rows)).toBe('player_trends')
  })

  it('detects player_games from pts + game_id + player_id columns', () => {
    const rows = [{ game_id: 5, player_id: 1, pts: 30, reb: 8 }]
    expect(detectShape(rows)).toBe('player_games')
  })

  it('detects picks from prop_type + pick_type', () => {
    const rows = [{ prop_type: 'player', pick_type: 'safe', confidence_score: 85 }]
    expect(detectShape(rows)).toBe('picks')
  })

  it('detects lines from kalshi_price', () => {
    const rows = [{ kalshi_price: 0.45, implied_prob: 0.45 }]
    expect(detectShape(rows)).toBe('lines')
  })

  it('falls back to generic for unknown shape', () => {
    const rows = [{ foo: 1, bar: 'x' }]
    expect(detectShape(rows)).toBe('generic')
  })

  it('returns generic for empty rows', () => {
    expect(detectShape([])).toBe('generic')
  })
})

describe('enrich', () => {
  it('enriches player_trends with statLabel + zScoreBucket', () => {
    const out = enrich('player_trends', [
      { player_id: 1, name: 'Luka', stat: 0, trend_val: 2.1, window_size: 10, season_avg: 30 },
    ])
    expect(out[0]).toMatchObject({
      statLabel: expect.any(String),
      zScoreBucket: 'hot',
      seasonAvg: 30,
    })
  })

  it('enriches picks with confidenceBucket + edgePct', () => {
    const out = enrich('picks', [
      { prop_type: 'player', pick_type: 'safe', confidence_score: 85, edge: 0.07, stat: 'pts' },
    ])
    expect(out[0]).toMatchObject({
      confidenceBucket: 'high',
      edgePct: 7,
      statLabel: 'PTS',
    })
  })

  it('enriches lines with impliedProbPct + bookLabel', () => {
    const out = enrich('lines', [{ kalshi_price: 0.45, implied_prob: 0.45, line: 25.5 }])
    expect(out[0]).toMatchObject({
      impliedProbPct: 45,
      bookLabel: 'Kalshi',
    })
  })

  it('passes through generic rows unchanged', () => {
    const rows = [{ foo: 1 }]
    expect(enrich('generic', rows)).toEqual(rows)
  })
})
