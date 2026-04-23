export type Shape = 'player_trends' | 'player_games' | 'picks' | 'lines' | 'generic'

const STAT_ID_TO_LABEL: Record<number, string> = {
  0: 'PTS', 1: 'REB', 2: 'AST', 3: '3PM', 4: 'FOULS', 5: 'MIN',
}
const STAT_STR_TO_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', threes: '3PM',
  points: 'PTS', rebounds: 'REB', assists: 'AST', three_points_made: '3PM',
}

export function detectShape(rows: unknown[]): Shape {
  if (!Array.isArray(rows) || rows.length === 0) return 'generic'
  const r = rows[0] as Record<string, unknown>
  if (!r || typeof r !== 'object') return 'generic'

  const has = (k: string) => Object.prototype.hasOwnProperty.call(r, k)

  if (has('trend_val') && has('window_size')) return 'player_trends'
  if (has('prop_type') && (has('pick_type') || has('confidence_score'))) return 'picks'
  if (has('kalshi_price') || (has('implied_prob') && has('line'))) return 'lines'
  if (has('game_id') && has('player_id') && (has('pts') || has('points') || has('reb') || has('rebounds'))) {
    return 'player_games'
  }
  return 'generic'
}

function statLabel(stat: unknown): string {
  if (typeof stat === 'number') return STAT_ID_TO_LABEL[stat] ?? String(stat)
  if (typeof stat === 'string') return STAT_STR_TO_LABEL[stat.toLowerCase()] ?? stat.toUpperCase()
  return ''
}

function zScoreBucket(z: number): 'hot' | 'warm' | 'cold' {
  if (z >= 1.5) return 'hot'
  if (z >= 0.5) return 'warm'
  return 'cold'
}

function confidenceBucket(c: number): 'low' | 'mid' | 'high' {
  if (c >= 80) return 'high'
  if (c >= 65) return 'mid'
  return 'low'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function enrich(shape: Shape, rows: any[]): any[] {
  if (shape === 'generic') return rows

  return rows.map((row) => {
    switch (shape) {
      case 'player_trends':
        return {
          ...row,
          statLabel: statLabel(row.stat),
          zScoreBucket: zScoreBucket(Number(row.trend_val ?? 0)),
          seasonAvg: row.season_avg ?? null,
        }
      case 'player_games':
        // Pure module: opponent/hit/home enrichment requires schedule join
        // which the caller performs separately. Keep pure here.
        return { ...row }
      case 'picks':
        return {
          ...row,
          statLabel: statLabel(row.stat),
          confidenceBucket: confidenceBucket(Number(row.confidence_score ?? 0)),
          edgePct: row.edge != null ? Math.round(Number(row.edge) * 100) : null,
          directionLabel: row.recommended_line != null ? 'OVER' : null,
        }
      case 'lines':
        return {
          ...row,
          impliedProbPct: row.implied_prob != null ? Math.round(Number(row.implied_prob) * 100) : null,
          bookLabel: 'Kalshi',
        }
      default:
        return row
    }
  })
}
