import { supabaseAdmin } from '../config/supabaseAdmin'

/**
 * Fuzzy player resolution for SportQuery. The model writes `name ILIKE '...'`
 * from whatever the user typed, so "lebrun", "luka doncic" (no accent) or a bare
 * surname used to miss or force a disambiguation. This finds likely players
 * ahead of the model call and hands it ids and canonical names.
 */

const STOP = new Set(
  (
    'the and for who what whose which when where how many much most top best worst last first next ' +
    'night game games season seasons this that with without over under against vs versus his her their ' +
    'from have has had was were are did does points point rebounds assists threes steals blocks goals ' +
    'yards hits runs home away week weeks days day average avg per total leaders leader scored score ' +
    'scoring show list give tell about play played plays players player team teams nba mlb nfl nhl ' +
    'tonight today yesterday trending trend streak streaks recent recently highest lowest more less ' +
    'than then them they year years over under'
  ).split(' ')
)

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]!
}

const sim = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length)

export type PlayerHint = { id: number; name: string; team: string | null; league: string; score: number }

export async function resolvePlayerHints(message: string): Promise<PlayerHint[]> {
  const tokens = [
    ...new Set(
      (fold(message).match(/[a-z][a-z'.-]{2,}/g) ?? [])
        .map((t) => t.replace(/'s$/, '').replace(/[.'-]+$/g, ''))
        .filter((t) => t.length >= 3 && !STOP.has(t))
    ),
  ].slice(0, 6)
  if (tokens.length === 0) return []

  // Cast a wide net with a 3-letter prefix per token, then rank in JS.
  const ors = tokens.map((t) => `name.ilike.%${t.slice(0, 3)}%`).join(',')
  const { data } = await supabaseAdmin
    .from('players')
    .select('id, name, team, league, is_active')
    .or(ors)
    .limit(400)
  if (!data?.length) return []

  const scored: PlayerHint[] = []
  for (const p of data as any[]) {
    const parts = fold(p.name).split(/[\s-]+/).filter(Boolean)
    let score = 0
    let matched = 0
    for (const t of tokens) {
      const best = Math.max(...parts.map((part) => (part.startsWith(t) ? 0.95 : sim(t, part))))
      if (best >= 0.72) {
        score += best
        matched += 1
      }
    }
    if (matched === 0) continue
    // Active players first; a full-name match (2+ tokens) beats a lone surname.
    scored.push({
      id: p.id,
      name: p.name,
      team: p.team,
      league: p.league,
      score: score + (matched > 1 ? 0.5 : 0) + (p.is_active ? 0.1 : 0),
    })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 5)
}

export function formatHints(hints: PlayerHint[]): string {
  if (hints.length === 0) return ''
  const lines = hints.map((h) => `- ${h.name} (${h.team ?? '?'}, ${h.league}) players.id=${h.id}`)
  return (
    'PLAYER HINTS: fuzzy matches for names in the user\'s message, best first. If one clearly fits, ' +
    'use it (filter by players.id) and do NOT ask to disambiguate. Only disambiguate when two ' +
    'different people are genuinely equally likely.\n' +
    lines.join('\n')
  )
}
