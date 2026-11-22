import { supabaseAdmin } from '../config/supabaseAdmin'

/**
 * Deterministic parlay math over the picks and streaks the site already surfaces.
 * The LLM never multiplies probabilities: it only words the numbers computed here.
 */

export interface Leg {
  label: string
  stat: string
  line: number | null
  side: string
  /** Our probability the leg lands (model prob for picks, last-10 hit rate for streaks). */
  prob: number
  /** Market-implied probability (Kalshi), when the leg has a price. */
  implied: number | null
  gameId: number | null
  source: 'pick' | 'streak'
}

export interface ParlayResult {
  legs: Leg[]
  combinedProb: number
  combinedImplied: number | null
  fairAmerican: number
  /** Percentage points, combined prob minus combined implied. */
  edgePts: number | null
  sameGameGroups: number[][]
  notes: string[]
}

const LEAGUE_IDS: Record<string, number> = { nba: 1, mlb: 2, nfl: 3 }

export function parseParlayRequest(message: string): { n: number; kind: 'pick' | 'streak'; leagueId: number } {
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 }
  const m = /\b(\d+|two|three|four|five|six)\b/i.exec(message)
  const raw = m ? (/\d/.test(m[1]!) ? Number(m[1]) : words[m[1]!.toLowerCase()]!) : 3
  const league = (/\b(nba|mlb|nfl)\b/i.exec(message)?.[1] ?? 'nba').toLowerCase()
  return {
    n: Math.min(Math.max(raw, 2), 8),
    kind: /streak/i.test(message) ? 'streak' : 'pick',
    leagueId: LEAGUE_IDS[league] ?? 1,
  }
}

export const isParlayRequest = (message: string) => /\bparlay/i.test(message)

export function americanOdds(p: number): number {
  const c = Math.min(Math.max(p, 0.001), 0.999)
  return Math.round(c >= 0.5 ? -(c / (1 - c)) * 100 : ((1 - c) / c) * 100)
}

/** Independence assumption; same-game legs are flagged, not adjusted. */
export function priceParlay(legs: Leg[]): ParlayResult {
  const combinedProb = legs.reduce((a, l) => a * l.prob, 1)
  const priced = legs.every((l) => l.implied != null)
  const combinedImplied = priced ? legs.reduce((a, l) => a * (l.implied as number), 1) : null
  const byGame = new Map<number, number[]>()
  legs.forEach((l, i) => {
    if (l.gameId != null) byGame.set(l.gameId, [...(byGame.get(l.gameId) ?? []), i])
  })
  const sameGameGroups = [...byGame.values()].filter((g) => g.length > 1)
  const notes = ['Legs are treated as independent, so the combined chance is just the product of each leg.']
  if (sameGameGroups.length) {
    notes.push('Some legs come from the same game. Those outcomes are correlated (pace, blowouts, injuries), so the real combined chance differs from this product.')
  }
  if (!priced) notes.push('Not every leg has a market price, so there is no combined price to compare against.')
  if (legs.some((l) => l.source === 'streak')) {
    notes.push('Streak legs use the last-10 hit rate, which is a thin sample and tends to regress.')
  }
  return {
    legs,
    combinedProb,
    combinedImplied,
    fairAmerican: americanOdds(combinedProb),
    edgePts: combinedImplied == null ? null : (combinedProb - combinedImplied) * 100,
    sameGameGroups,
    notes,
  }
}

/** Candidate legs from the surfaced picks (pick_type project) or streaks (sugg_streak), best first. */
export async function loadLegs(
  kind: 'pick' | 'streak',
  leagueId: number,
  n: number,
  message = ''
): Promise<{ legs: Leg[]; date: string | null }> {
  const pickType = kind === 'pick' ? 'project' : 'sugg_streak'
  const today = new Date().toISOString().slice(0, 10)
  const { data: d } = await supabaseAdmin
    .from('pick_results')
    .select('game_date')
    .eq('pick_type', pickType)
    .eq('league_id', leagueId)
    .gte('game_date', today)
    .order('game_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  const date: string | null = d?.game_date ?? null
  if (!date) return { legs: [], date: null }

  const { data: rows } = await supabaseAdmin
    .from('pick_results')
    .select('entity_id, stat, recommended_line, hit_rate, model_prob, implied_prob, game_id, modifiers')
    .eq('pick_type', pickType)
    .eq('league_id', leagueId)
    .eq('prop_type', 'player')
    .eq('game_date', date)
    .order('hit_rate', { ascending: false })
    .limit(200)

  let pool = (rows ?? []) as any[]
  const ids = [...new Set(pool.map((r) => r.entity_id))]
  const { data: players } = await supabaseAdmin.from('players').select('id, name, team').in('id', ids)
  const info = new Map<number, { name: string; team: string | null }>((players ?? []).map((p: any) => [p.id, { name: p.name, team: p.team }]))

  // "…in the CHA ATL game": keep only legs whose team the user named.
  const teams = new Set([...info.values()].map((i) => (i.team ?? '').toUpperCase()).filter(Boolean))
  const named = (message.toUpperCase().match(/\b[A-Z]{2,4}\b/g) ?? []).filter((w) => teams.has(w))
  if (named.length) pool = pool.filter((r) => named.includes((info.get(r.entity_id)?.team ?? '').toUpperCase()))

  const seen = new Set<number>()
  const legs: Leg[] = []
  for (const r of pool) {
    if (seen.has(r.entity_id)) continue
    seen.add(r.entity_id)
    const prob = Number(r.model_prob ?? r.hit_rate)
    if (!Number.isFinite(prob)) continue
    legs.push({
      label: info.get(r.entity_id)?.name ?? `Player ${r.entity_id}`,
      stat: String(r.stat).toUpperCase(),
      line: r.recommended_line == null ? null : Number(r.recommended_line),
      side: r.modifiers?.side ?? 'over',
      prob,
      implied: r.implied_prob == null ? null : Number(r.implied_prob),
      gameId: r.game_id ?? null,
      source: kind === 'pick' ? 'pick' : 'streak',
    })
    if (legs.length >= n) break
  }
  return { legs, date }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const odds = (a: number) => (a > 0 ? `+${a}` : `${a}`)

/** Plain-language summary of the computed numbers, for the LLM to restate conversationally. */
export function parlayFacts(r: ParlayResult, date: string | null): string {
  const legs = r.legs
    .map((l) => `${l.label} ${l.side === 'under' ? 'under' : 'over'} ${l.line ?? ''} ${l.stat} (${pct(l.prob)}${l.implied != null ? `, market ${pct(l.implied)}` : ''})`)
    .join('; ')
  return [
    `PARLAY (computed in code, do not recompute) for ${date ?? 'the next slate'}: ${legs}.`,
    `Combined chance ${pct(r.combinedProb)} (fair odds ${odds(r.fairAmerican)}).`,
    r.combinedImplied != null ? `Combined market price ${pct(r.combinedImplied)}; difference ${r.edgePts! >= 0 ? '+' : ''}${r.edgePts!.toFixed(1)} pts.` : '',
    ...r.notes,
  ]
    .filter(Boolean)
    .join(' ')
}
