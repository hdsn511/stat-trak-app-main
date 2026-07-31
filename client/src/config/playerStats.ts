import type { LeagueSlug } from './leagues'
import type { GameRow } from '@/ember/player/types'

// Player stat registry. Stats are resolved from a player's ROLE, not from the
// league alone: an NFL quarterback and a receiver share no columns, and NHL
// skaters and goalies share none. Every consumer reads stats from here so no
// UI code names a sport-specific column.

export interface StatDef {
  key: string
  label: string
  get: (g: GameRow) => number | null
  /** Display transform, e.g. TOI seconds → "18:42". */
  format?: (v: number) => string
  /** Decimal places for averages. Defaults to 1. */
  decimals?: number
}

export interface PlayerStatConfig {
  slug: LeagueSlug
  /** Game-count windows offered in the filter bar. 0 means the whole season. */
  windows: number[]
  roleOf: (p: { position?: string | null }, sample?: GameRow) => string
  volumeFor: (role: string) => StatDef | null
  statsFor: (role: string) => StatDef[]
  combosFor: (role: string) => StatDef[]
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** A StatDef reading one numeric field. */
const field = (key: string, label: string, extra: Partial<StatDef> = {}): StatDef => ({
  key,
  label,
  get: (g) => num(g[key]),
  ...extra,
})

/** A StatDef summing several fields; null if any component is missing. */
const sum = (key: string, label: string, parts: string[]): StatDef => ({
  key,
  label,
  get: (g) => {
    let total = 0
    for (const p of parts) {
      const v = num(g[p])
      if (v == null) return null
      total += v
    }
    return total
  },
})

const mmss = (v: number): string => {
  const m = Math.floor(v / 60)
  const s = Math.round(v % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── NBA ───────────────────────────────────────────────────────────────────────
const NBA_STATS = [
  field('points', 'PTS'),
  field('rebounds', 'REB'),
  field('assists', 'AST'),
  field('threes', '3PM'),
]
const NBA_COMBOS = [
  sum('pra', 'PRA', ['points', 'rebounds', 'assists']),
  sum('pr', 'PTS+REB', ['points', 'rebounds']),
  sum('pa', 'PTS+AST', ['points', 'assists']),
  sum('ra', 'REB+AST', ['rebounds', 'assists']),
]
const NBA: PlayerStatConfig = {
  slug: 'nba',
  windows: [5, 10, 20, 0],
  roleOf: () => 'player',
  volumeFor: () => field('minutes', 'MIN'),
  statsFor: () => NBA_STATS,
  combosFor: () => NBA_COMBOS,
}

// ── MLB ───────────────────────────────────────────────────────────────────────
const MLB_BATTER = [
  field('hits', 'H'),
  field('totalBases', 'TB'),
  field('rbi', 'RBI'),
  field('runs', 'R'),
  field('homeRuns', 'HR'),
  field('strikeouts', 'K'),
]
const MLB_PITCHER = [
  field('strikeoutsPitched', 'K'),
  field('earnedRuns', 'ER'),
  field('hitsAllowed', 'H'),
  field('walksAllowed', 'BB'),
]
const MLB: PlayerStatConfig = {
  slug: 'mlb',
  windows: [5, 10, 20, 0],
  roleOf: (p) => (/^(p|sp|rp|lhp|rhp)$/i.test((p.position || '').trim()) ? 'pitcher' : 'batter'),
  volumeFor: (role) =>
    role === 'pitcher' ? field('outsPitched', 'OUTS') : field('plateAppearances', 'PA'),
  statsFor: (role) => (role === 'pitcher' ? MLB_PITCHER : MLB_BATTER),
  combosFor: (role) => (role === 'pitcher' ? [] : [sum('hrr', 'H+R+RBI', ['hits', 'runs', 'rbi'])]),
}

// ── NHL ───────────────────────────────────────────────────────────────────────
const NHL_SKATER = [
  field('goals', 'G'),
  field('assists', 'A'),
  field('points', 'PTS'),
  field('shotsOnGoal', 'SOG'),
  field('blocks', 'BLK'),
  field('hits', 'HITS'),
]
const NHL_GOALIE = [
  field('saves', 'SV'),
  field('shotsAgainst', 'SA'),
  field('goalsAgainst', 'GA'),
  field('savePct', 'SV%', { decimals: 3 }),
]
const NHL: PlayerStatConfig = {
  slug: 'nhl',
  windows: [5, 10, 20, 0],
  // position_type on the stat row is authoritative; the roster position is a
  // fallback for players with no games in the current filter.
  roleOf: (p, sample) => {
    const t = sample?.positionType
    if (t === 'goalie' || t === 'skater') return t
    return (p.position || '').trim().toUpperCase() === 'G' ? 'goalie' : 'skater'
  },
  volumeFor: (role) =>
    role === 'goalie'
      ? field('goalieToiSeconds', 'TOI', { format: mmss })
      : field('toiSeconds', 'TOI', { format: mmss }),
  statsFor: (role) => (role === 'goalie' ? NHL_GOALIE : NHL_SKATER),
  combosFor: (role) => (role === 'goalie' ? [] : [sum('ga', 'G+A', ['goals', 'assists'])]),
}

// ── NFL ───────────────────────────────────────────────────────────────────────
const NFL_QB = [
  field('passingYards', 'PASS YDS'),
  field('passingTds', 'PASS TD'),
  field('completions', 'CMP'),
  field('interceptions', 'INT'),
  field('rushingYards', 'RUSH YDS'),
]
const NFL_RB = [
  field('rushingYards', 'RUSH YDS'),
  field('rushingTds', 'RUSH TD'),
  field('receptions', 'REC'),
  field('receivingYards', 'REC YDS'),
]
const NFL_RECEIVER = [
  field('receptions', 'REC'),
  field('receivingYards', 'REC YDS'),
  field('receivingTds', 'REC TD'),
  field('targets', 'TGT'),
]
const NFL_DEFENSE = [field('tacklesTotal', 'TKL'), field('sacks', 'SACK')]
const NFL_KICKER = [field('fgMade', 'FGM'), field('fgAtt', 'FGA')]

const NFL_ROLE_BY_POSITION: Record<string, string> = {
  QB: 'qb',
  RB: 'rb',
  FB: 'rb',
  WR: 'receiver',
  TE: 'receiver',
  PK: 'kicker',
  K: 'kicker',
}

const NFL: PlayerStatConfig = {
  slug: 'nfl',
  // A 17-game regular season — a 20-game window would exceed it.
  windows: [3, 6, 17, 0],
  roleOf: (p) => NFL_ROLE_BY_POSITION[(p.position || '').trim().toUpperCase()] ?? 'defense',
  volumeFor: (role) => {
    if (role === 'qb') return field('attempts', 'ATT')
    if (role === 'rb') return field('carries', 'CAR')
    if (role === 'receiver') return field('targets', 'TGT')
    return null
  },
  statsFor: (role) => {
    if (role === 'qb') return NFL_QB
    if (role === 'rb') return NFL_RB
    if (role === 'receiver') return NFL_RECEIVER
    if (role === 'kicker') return NFL_KICKER
    return NFL_DEFENSE
  },
  combosFor: (role) =>
    role === 'rb' || role === 'receiver'
      ? [sum('scrimmageYards', 'SCRIM YDS', ['receivingYards', 'rushingYards'])]
      : [],
}

const CONFIGS: Record<LeagueSlug, PlayerStatConfig> = { nba: NBA, mlb: MLB, nhl: NHL, nfl: NFL }

export function getPlayerStatConfig(slug: LeagueSlug): PlayerStatConfig {
  return CONFIGS[slug] ?? NBA
}

/** Single stats followed by derived combos — the order shown in the stat picker. */
export function allStatsFor(cfg: PlayerStatConfig, role: string): StatDef[] {
  return [...cfg.statsFor(role), ...cfg.combosFor(role)]
}

export function formatVolume(def: StatDef | null, v: number | null): string {
  if (def == null || v == null) return '—'
  return def.format ? def.format(v) : String(v)
}
