import type { ResultRow, ResultShape } from '@/services/sportqueryApi'

// Row interpretation for SportQuery results. The LLM writes its own SELECT, so
// column names vary between answers even within one shape. Everything here
// probes a list of likely keys rather than assuming a fixed schema.

function firstKey(row: ResultRow, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] != null) return row[k]
  }
  return undefined
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

const PLAYER_ID_KEYS = ['player_id', 'playerid', 'entity_id', 'id']
const PLAYER_NAME_KEYS = ['player_name', 'name', 'playername', 'player']
const TEAM_KEYS = ['team', 'team_abbr', 'abbreviation', 'team_abbreviation']
const GAME_ID_KEYS = ['game_id', 'gameid']

/** Never treat these as the row's headline metric. */
const NOT_A_METRIC = new Set([
  ...PLAYER_ID_KEYS,
  ...PLAYER_NAME_KEYS,
  ...TEAM_KEYS,
  ...GAME_ID_KEYS,
  'position',
  'league_id',
  'team_id',
  'season',
  'window_size',
  'game_date',
  'created_at',
])

/** Columns that are almost always a qualifier, not the thing being ranked. */
const COUNT_LIKE = /^(games|games_played|gp|count|n|sample_size|appearances)$/

/**
 * Which column the answer is actually about, inferred across the whole result
 * set rather than one row.
 *
 * The model writes its own aliases (avg_rebounds, ppg, total_points…), so
 * there is no fixed name to look for. But it also writes ORDER BY, which means
 * the ranked column arrives already sorted — that monotonic run is the
 * strongest available signal for which number the user asked about. Picking
 * the first numeric column instead surfaces things like a "games" qualifier.
 */
export function inferMetricKey(rows: ResultRow[]): string | null {
  if (rows.length === 0) return null

  const candidates = new Set<string>()
  for (const row of rows) {
    for (const [key, raw] of Object.entries(row)) {
      if (NOT_A_METRIC.has(key) || /(^|_)id$/.test(key)) continue
      if (asNumber(raw) != null) candidates.add(key)
    }
  }
  if (candidates.size === 0) return null

  const score = (key: string): number => {
    const values = rows.map((r) => asNumber(r[key])).filter((v): v is number => v != null)
    if (values.length < rows.length) return -1

    let points = 0
    // Sorted across the result set → this is what ORDER BY targeted.
    const nonIncreasing = values.every((v, i) => i === 0 || v <= values[i - 1]!)
    const nonDecreasing = values.every((v, i) => i === 0 || v >= values[i - 1]!)
    if (rows.length > 1 && (nonIncreasing || nonDecreasing)) points += 100
    // All-identical columns rank nothing.
    if (new Set(values).size === 1) points -= 50
    if (COUNT_LIKE.test(key)) points -= 40
    // Averages and rates read better as a headline than raw totals.
    if (/^(avg|average)_|_avg$|_pg$|pct|rate/.test(key)) points += 10
    return points
  }

  return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null
}

export interface ParsedRow {
  /** Present when the row identifies a player we can open. */
  playerId: number | null
  playerName: string | null
  gameId: number | null
  team: string | null
  /** The row's headline number and what it measures. */
  value: number | null
  valueLabel: string | null
  secondary: string | null
}

/**
 * Pull a player/game identity and a headline metric out of an arbitrary result
 * row. Anything not recognised comes back null and the caller falls back to a
 * generic table.
 */
export function parseRow(
  row: ResultRow,
  shape: ResultShape,
  metricKey?: string | null
): ParsedRow {
  const playerId = asNumber(firstKey(row, PLAYER_ID_KEYS))
  const playerName = asString(firstKey(row, PLAYER_NAME_KEYS))
  const gameId = asNumber(firstKey(row, GAME_ID_KEYS))
  const team = asString(firstKey(row, TEAM_KEYS))

  let value: number | null = null
  let valueLabel: string | null = null
  let secondary: string | null = null

  switch (shape) {
    case 'player_trends': {
      value = asNumber(row.rolling_avg)
      valueLabel = `${asString(row.statLabel) ?? 'STAT'} · L${asNumber(row.window_size) ?? 10}`
      const season = asNumber(row.season_avg ?? row.seasonAvg)
      const z = asNumber(row.trend_val)
      secondary = [
        season != null ? `season ${season.toFixed(1)}` : null,
        z != null ? `z ${z.toFixed(2)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      break
    }
    case 'picks': {
      value = asNumber(row.recommended_line)
      valueLabel = `${asString(row.statLabel) ?? 'LINE'}${row.directionLabel ? ` ${row.directionLabel}` : ''}`
      const hit = asNumber(row.hit_rate)
      const conf = asNumber(row.confidence_score)
      const edge = asNumber(row.edgePct)
      secondary = [
        hit != null ? `hit ${Math.round(hit * 100)}%` : null,
        conf != null ? `conf ${Math.round(conf)}` : null,
        edge != null ? `edge ${edge}%` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      break
    }
    case 'lines': {
      value = asNumber(row.line)
      valueLabel = asString(row.stat)?.toUpperCase() ?? 'LINE'
      const implied = asNumber(row.impliedProbPct)
      secondary = [
        implied != null ? `implied ${implied}%` : null,
        asString(row.bookLabel),
      ]
        .filter(Boolean)
        .join(' · ')
      break
    }
    case 'player_games': {
      value = asNumber(firstKey(row, ['pts', 'points', 'hits', 'goals', 'receiving_yards']))
      valueLabel = 'GAME'
      secondary = asString(row.game_date)
      break
    }
    default:
      break
  }

  // Shape-specific extraction found nothing usable (the common case: the model
  // wrote its own aggregate and the shape came back 'generic').
  if (value == null && metricKey) {
    const v = asNumber(row[metricKey])
    if (v != null) {
      value = v
      valueLabel ??= humanizeKey(metricKey)
    }
  }

  // A qualifier worth keeping next to the headline number.
  if (secondary == null) {
    const games = asNumber(firstKey(row, ['games', 'games_played', 'gp']))
    if (games != null && metricKey !== 'games') secondary = `${games} games`
  }

  return { playerId, playerName, gameId, team, value, valueLabel, secondary }
}

/** Column order for the generic table: identity-ish keys first. */
const COLUMN_PRIORITY = ['name', 'player_name', 'team', 'position', 'game_date', 'season']

export function genericColumns(rows: ResultRow[], max = 6): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) seen.add(k)
  }
  // Internal ids add nothing to a table the user reads.
  const keys = [...seen].filter((k) => !/^(id|.*_id)$/.test(k))
  keys.sort((a, b) => {
    const ai = COLUMN_PRIORITY.indexOf(a)
    const bi = COLUMN_PRIORITY.indexOf(b)
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    return a.localeCompare(b)
  })
  return keys.slice(0, max)
}

export function formatCell(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function humanizeKey(k: string): string {
  return k.replace(/_/g, ' ').toUpperCase()
}
