// Stat abbreviation → display label
export const STAT_LABELS: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM',
}

// Stat abbreviation → nba_player_stats column name
export const STAT_COLUMNS: Record<string, string> = {
  pts: 'points', reb: 'rebounds', ast: 'assists', fg3m: 'three_points_made',
}

// Stat abbreviation → DB column + nba_trends stat integer
export const STAT_CONFIG: Record<string, { col: string; statId: number }> = {
  pts:  { col: 'points',            statId: 0 },
  reb:  { col: 'rebounds',          statId: 1 },
  ast:  { col: 'assists',           statId: 2 },
  fg3m: { col: 'three_points_made', statId: 3 },
}

// nba_trends stat integer → display name used in trend API responses
export const TREND_STAT_NAMES: Record<number, string> = {
  0: 'points', 1: 'rebounds', 2: 'assists', 3: 'threes',
}

export const VALID_STAT_IDS: number[] = Object.values(STAT_CONFIG).map(c => c.statId)
