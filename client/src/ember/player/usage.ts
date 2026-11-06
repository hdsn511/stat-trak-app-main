import type { LeagueSlug } from '@/config/leagues'
import type { StatDef } from '@/config/playerStats'
import type { GameRow } from './types'

/**
 * The opportunity metric behind a stat: minutes for a scorer, targets for a
 * receiver, carries for a rusher. It is chosen per STAT, not per role — an RB's
 * rushing yards ride on carries but his receiving yards ride on targets.
 */
export interface UsageDef extends StatDef {
  /** Long label for the usage strip, e.g. "TARGETS". */
  title: string
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const usage = (
  key: string,
  label: string,
  title: string,
  get: (g: GameRow) => number | null,
  decimals = 0
): UsageDef => ({ key, label, title, get, decimals })

/**
 * NFL box scores leave a count null when the player recorded none (a WR with
 * no carries). On a logged appearance that means zero, not "unknown".
 */
const count = (col: string) => (g: GameRow) => num(g[col]) ?? 0

const MINUTES = usage('minutes', 'MIN', 'MINUTES', (g) => num(g.minutes))
const PA = usage('plateAppearances', 'PA', 'PLATE APPEARANCES', (g) => num(g.plateAppearances))
const OUTS = usage('outsPitched', 'OUTS', 'OUTS RECORDED', (g) => num(g.outsPitched))
/** TOI arrives in seconds; usage reads and filters in whole minutes. */
const toiMinutes = (col: string) =>
  usage('toiMinutes', 'TOI', 'TIME ON ICE (MIN)', (g) => {
    const s = num(g[col])
    return s == null ? null : Math.round((s / 60) * 10) / 10
  })
const SKATER_TOI = toiMinutes('toiSeconds')
const GOALIE_TOI = toiMinutes('goalieToiSeconds')
const TARGETS = usage('targets', 'TGT', 'TARGETS', count('targets'))
const CARRIES = usage('carries', 'CAR', 'CARRIES', count('carries'))
const PASS_ATT = usage('attempts', 'ATT', 'PASS ATTEMPTS', count('attempts'))
const FG_ATT = usage('fgAtt', 'FGA', 'FG ATTEMPTS', count('fgAtt'))
const TOUCHES = usage('opportunities', 'CAR+TGT', 'CARRIES + TARGETS', (g) => {
  const c = num(g.carries)
  const t = num(g.targets)
  return c == null && t == null ? null : (c ?? 0) + (t ?? 0)
})

const NFL_BY_STAT: Record<string, UsageDef> = {
  passingYards: PASS_ATT,
  passingTds: PASS_ATT,
  completions: PASS_ATT,
  interceptions: PASS_ATT,
  rushingYards: CARRIES,
  rushingTds: CARRIES,
  receptions: TARGETS,
  receivingYards: TARGETS,
  receivingTds: TARGETS,
  targets: TARGETS,
  scrimmageYards: TOUCHES,
  fgMade: FG_ATT,
  fgAtt: FG_ATT,
}

/** The usage metric for one stat, or null where the data has none (NFL defense). */
export function usageFor(slug: LeagueSlug, role: string, stat: string): UsageDef | null {
  switch (slug) {
    case 'nba':
      return MINUTES
    case 'mlb':
      return role === 'pitcher' ? OUTS : PA
    case 'nhl':
      return role === 'goalie' ? GOALIE_TOI : SKATER_TOI
    case 'nfl':
      return NFL_BY_STAT[stat] ?? null
    default:
      return null
  }
}
