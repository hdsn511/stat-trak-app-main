import type { HomeAway, PlayerFilters } from '@/ember/player/types'

// Turns a natural-language query into player-view filters. Two entry points:
// parseQueryFilters for the local regex path, sanitizeQueryFilters for the LLM
// path, which is not a trusted source of well-formed enums.

/** Words a user might use for a stat, mapped to config keys. */
const STAT_WORDS: [RegExp, string][] = [
  [/\bpra\b|points.*rebounds.*assists/i, 'pra'],
  [/\brebound|\bboard|\bglass\b/i, 'rebounds'],
  [/\bassist|\bdime|playmak/i, 'assists'],
  [/\bthree|\b3pm\b|\b3-p|from deep/i, 'threes'],
  [/\bpoint|\bscor|\bppg\b/i, 'points'],
]

const TEAM_RE = /\b(?:vs\.?|against|versus)\s+([A-Z]{2,3})\b/
const WINDOW_RE = /\blast\s+(\d{1,2})\b/i
const LINE_RE = /\b(?:over|under|above|below)\s+(\d{1,3}(?:\.\d)?)\b/i

export function parseQueryFilters(query: string, statKeys: string[]): Partial<PlayerFilters> {
  const out: Partial<PlayerFilters> = {}

  const w = query.match(WINDOW_RE)
  if (w) {
    const n = parseInt(w[1], 10)
    if (n > 0 && n <= 82) out.window = n
  }

  // Team codes are uppercase by convention; matching case-insensitively would
  // turn "vs the league" into a team named THE.
  const t = query.match(TEAM_RE)
  if (t) out.vsTeam = t[1]

  const l = query.match(LINE_RE)
  if (l) out.line = parseFloat(l[1])

  if (/\bat home\b|\bhome games?\b/i.test(query)) out.homeAway = 'home'
  else if (/\bon the road\b|\baway games?\b|\broad games?\b/i.test(query)) out.homeAway = 'away'

  for (const [re, key] of STAT_WORDS) {
    if (re.test(query) && statKeys.includes(key)) {
      out.stat = key
      break
    }
  }

  return out
}

const VENUES: HomeAway[] = ['all', 'home', 'away']

/** Validate an untrusted filters object from the LLM. Unknown values are dropped. */
export function sanitizeQueryFilters(raw: unknown, statKeys: string[]): Partial<PlayerFilters> {
  if (raw == null || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: Partial<PlayerFilters> = {}

  if (typeof r.window === 'number' && Number.isInteger(r.window) && r.window > 0 && r.window <= 82) {
    out.window = r.window
  }
  if (typeof r.vsTeam === 'string' && /^[A-Z]{2,3}$/.test(r.vsTeam)) {
    out.vsTeam = r.vsTeam
  }
  if (typeof r.stat === 'string' && statKeys.includes(r.stat)) {
    out.stat = r.stat
  }
  if (typeof r.line === 'number' && Number.isFinite(r.line) && r.line >= 0) {
    out.line = r.line
  }
  if (typeof r.homeAway === 'string' && VENUES.includes(r.homeAway as HomeAway)) {
    out.homeAway = r.homeAway as HomeAway
  }

  return out
}
