import { describe, it, expect } from 'vitest'
import { genericColumns, inferMetricKey, parseRow } from './resultRows'

describe('inferMetricKey', () => {
  it('picks the column the result set is sorted by', () => {
    const rows = [
      { name: 'A', games: 75, avg_rebounds: 12.6 },
      { name: 'B', games: 90, avg_rebounds: 11.1 },
      { name: 'C', games: 50, avg_rebounds: 10.5 },
    ]
    expect(inferMetricKey(rows)).toBe('avg_rebounds')
  })

  it('does not pick a count column just because it comes first', () => {
    const rows = [
      { games: 75, name: 'A', ppg: 31.4 },
      { games: 90, name: 'B', ppg: 28.2 },
    ]
    expect(inferMetricKey(rows)).toBe('ppg')
  })

  it('ignores identifier columns', () => {
    const rows = [
      { player_id: 1, team_id: 5, total_points: 900 },
      { player_id: 2, team_id: 6, total_points: 800 },
    ]
    expect(inferMetricKey(rows)).toBe('total_points')
  })

  it('skips a column that is the same in every row', () => {
    const rows = [
      { name: 'A', season: 2025, hits: 40 },
      { name: 'B', season: 2025, hits: 31 },
    ]
    expect(inferMetricKey(rows)).toBe('hits')
  })

  it('returns null when nothing numeric is present', () => {
    expect(inferMetricKey([{ name: 'A', team: 'LAL' }])).toBeNull()
    expect(inferMetricKey([])).toBeNull()
  })
})

describe('parseRow', () => {
  it('reads identity out of an arbitrary row', () => {
    const meta = parseRow({ player_id: 42, name: 'Nikola Jokić', team: 'DEN' }, 'generic')
    expect(meta.playerId).toBe(42)
    expect(meta.playerName).toBe('Nikola Jokić')
    expect(meta.team).toBe('DEN')
  })

  it('coerces the numeric strings postgres returns', () => {
    const meta = parseRow({ id: '190', name: 'X', avg: '3.5' }, 'generic', 'avg')
    expect(meta.playerId).toBe(190)
    expect(meta.value).toBe(3.5)
  })

  it('labels the inferred metric from its column name', () => {
    const meta = parseRow({ name: 'X', avg_rebounds: 12.6 }, 'generic', 'avg_rebounds')
    expect(meta.valueLabel).toBe('AVG REBOUNDS')
  })

  it('keeps games as a qualifier rather than the headline', () => {
    const meta = parseRow({ name: 'X', games: 75, avg_rebounds: 12.6 }, 'generic', 'avg_rebounds')
    expect(meta.value).toBe(12.6)
    expect(meta.secondary).toBe('75 games')
  })

  it('reads the trend shape into a headline and a context line', () => {
    const meta = parseRow(
      {
        player_id: 7,
        name: 'Y',
        rolling_avg: 27.4,
        season_avg: 24.1,
        trend_val: 2.05,
        window_size: 10,
        statLabel: 'PTS',
      },
      'player_trends'
    )
    expect(meta.value).toBe(27.4)
    expect(meta.valueLabel).toBe('PTS · L10')
    expect(meta.secondary).toContain('season 24.1')
    expect(meta.secondary).toContain('z 2.05')
  })

  it('reads the picks shape', () => {
    const meta = parseRow(
      {
        entity_id: 9,
        player_name: 'Z',
        recommended_line: 25.5,
        statLabel: 'PTS',
        directionLabel: 'OVER',
        hit_rate: 0.87,
        confidence_score: 82,
        edgePct: 12,
      },
      'picks'
    )
    expect(meta.value).toBe(25.5)
    expect(meta.valueLabel).toBe('PTS OVER')
    expect(meta.secondary).toBe('hit 87% · conf 82 · edge 12%')
  })
})

describe('genericColumns', () => {
  it('drops id columns and puts identity first', () => {
    const cols = genericColumns([{ zzz: 1, team: 'LAL', player_id: 3, name: 'A', id: 9 }])
    expect(cols).not.toContain('player_id')
    expect(cols).not.toContain('id')
    expect(cols.slice(0, 2)).toEqual(['name', 'team'])
  })

  it('unions keys across rows that do not all match', () => {
    const cols = genericColumns([{ a: 1 }, { b: 2 }])
    expect(cols).toEqual(['a', 'b'])
  })
})
