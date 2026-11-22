import type { GameInsights, GameDetail, ProjectPick } from '@/services/api'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** The "why" button on a pick row. Lives inside a Link, so it must not navigate. */
export function WhyToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? 'Hide the reasoning' : 'Show the reasoning'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      className="font-martian text-[10px] tracking-[1px] text-[#A8A09C] hover:text-[#FF6B3D] border border-[#2C2624] hover:border-[#FF6B3D]/50 rounded-[3px] px-[9px] py-[4px] cursor-pointer press"
    >
      WHY <span className={`inline-block transition-transform duration-200 [transition-timing-function:var(--ease-out)] ${open ? 'rotate-180' : ''}`}>▾</span>
    </button>
  )
}

/** Game-level facts the game page already has; lets the reasoning talk about the matchup, not just recent averages. */
export interface WhyContext {
  insights: GameInsights | null
  lines: GameDetail['lines']
  rest: GameDetail['rest']
  home: string
  away: string
}

interface Factor { text: string; tone: 'for' | 'against' | 'neutral' }

const ordinal = (n: number) => `#${n}`

/** Matchup-first factors for a prop, each marked as supporting or cutting against the pick. */
function propFactors(p: ProjectPick, w?: WhyContext): Factor[] {
  const c = p.context
  const under = p.side === 'under'
  const side = under ? 'under' : 'over'
  const out: Factor[] = []
  const isHome = w ? p.team === w.home : null
  const opp = w && isHome != null ? (isHome ? w.away : w.home) : null

  // 1. Opponent defense for this exact stat.
  if (w?.insights && opp && p.stat_label) {
    const row = w.insights.defense.find((r) => r.label.toUpperCase().startsWith(p.stat_label!.toUpperCase()))
    const d = row ? (isHome ? row.away : row.home) : null
    if (row && d && d.rank) {
      const n = w.insights.team_count
      const soft = d.rank > (n * 2) / 3
      const tough = d.rank <= n / 3
      const pctVs = Math.round(d.vs_league * 100)
      const supports = under ? tough : soft
      const against = under ? soft : tough
      out.push({
        tone: supports ? 'for' : against ? 'against' : 'neutral',
        text: `${opp} allow ${d.value} ${p.stat_label} a game (${ordinal(d.rank)} of ${n} defenses, ${pctVs >= 0 ? '+' : ''}${pctVs}% vs league). ${
          supports ? `That ${under ? 'is a tough' : 'is a soft'} matchup for the ${side}.` : against ? `That ${under ? 'is a soft' : 'is a tough'} matchup, which cuts against the ${side}.` : 'A middling matchup, so it adds little either way.'
        }`,
      })
    }
  }

  // 2. Game script from the market: a lopsided spread shortens starters' minutes.
  // shortcut: NBA-scale thresholds (9-pt spread, 215/230 total); revisit before using for other leagues.
  const sp = w?.lines?.spread_home
  if (w && sp != null && Math.abs(sp) >= 9 && p.stat_label && ['PTS', 'REB', 'AST', '3PM'].includes(p.stat_label)) {
    const fav = sp < 0 ? w.home : w.away
    out.push({
      tone: under ? 'for' : 'against',
      text: `${fav} are favored by ${Math.abs(sp)}. Blowouts tend to trim starters' minutes late, which ${under ? 'helps' : 'hurts'} the ${side}.`,
    })
  }
  const tot = w?.lines?.total
  if (tot != null && (tot >= 230 || tot <= 215)) {
    const fast = tot >= 230
    out.push({
      tone: fast === !under ? 'for' : 'against',
      text: `The game total is ${tot}, ${fast ? 'a high-scoring' : 'a slow, low-scoring'} projection, which ${fast === !under ? 'supports' : 'works against'} the ${side}.`,
    })
  }

  // 3. Rest.
  if (c.b2b) out.push({ tone: under ? 'for' : 'against', text: `Second night of a back-to-back: fatigue usually ${under ? 'helps' : 'hurts'} the ${side}.` })
  else if (w && isHome != null) {
    const days = isHome ? w.rest.home_days : w.rest.away_days
    if (days != null && days >= 3) out.push({ tone: under ? 'against' : 'for', text: `${days} days of rest going in, so no fatigue edge for the under.` })
  }

  // 4. Form, with the line it is measured against.
  if (c.hit10 != null) {
    const n = Math.round(c.hit10 * 10)
    out.push({
      tone: n >= 6 ? 'for' : n <= 4 ? 'against' : 'neutral',
      text: `Went ${side} ${p.line} in ${n} of the last 10${c.avg5 != null ? `; averaging ${c.avg5} over the last 5` : ''}${c.avg20 != null ? ` and ${c.avg20} over 20` : ''}.`,
    })
  }
  return out
}

function moneylineFactors(p: ProjectPick): Factor[] {
  const c = p.context
  return [
    p.book_prob != null ? { tone: 'neutral' as const, text: `Sportsbooks make ${p.name} a ${pct(p.book_prob)} favorite.` } : null,
    c.elo_prob != null
      ? { tone: c.elo_agrees ? ('for' as const) : ('against' as const), text: `The ratings model (Elo, built from this season's results) gives ${pct(c.elo_prob)}, so it ${c.elo_agrees ? 'agrees' : 'disagrees'}.` }
      : null,
  ].filter((f): f is Factor => f != null)
}

/** One plain-English verdict line: how many factors back the pick, and how thin the edge is. */
function headline(p: ProjectPick, factors: Factor[]): string {
  const f = factors.filter((x) => x.tone === 'for').length
  const a = factors.filter((x) => x.tone === 'against').length
  const edge = (p.model_prob - p.implied_prob) * 100
  const thin = Math.abs(edge) < 2 ? ' The edge over the market price is thin, so treat this as close to a coin flip against the price.' : ''
  if (p.kind === 'moneyline') return `Model: ${pct(p.model_prob)} to win.${thin}`
  const what = `${p.side === 'under' ? 'Under' : 'Over'} ${p.line} ${p.stat_label}`
  if (f + a === 0) return `${what}: no matchup factor stands out; this rests on recent form and the price.${thin}`
  return `${what}: ${f} factor${f === 1 ? '' : 's'} ${f === 1 ? 'supports' : 'support'} it${a ? ` and ${a} ${a === 1 ? 'cuts' : 'cut'} against` : ''}.${thin}`
}

const TONE = { for: { c: '#3FBF7F', t: 'SUPPORTS' }, against: { c: '#FF6B5C', t: 'AGAINST' }, neutral: { c: '#A8A09C', t: 'NEUTRAL' } } as const

/**
 * The expanded explanation under a pick: the reasoning, then the model's chance
 * against the market's on one 0–100% track so the gap is visible.
 */
export function PickWhy({ pick, ctx }: { pick: ProjectPick; ctx?: WhyContext }) {
  const factors = pick.kind === 'moneyline' ? moneylineFactors(pick) : propFactors(pick, ctx)
  const edge = (pick.model_prob - pick.implied_prob) * 100
  const tone = edge >= 0 ? '#3FBF7F' : '#FF6B5C'
  return (
    <div className="animate-fade-up mx-[18px] mb-[12px] rounded-md border border-[#2C2624] bg-[#17120F] px-[14px] py-[12px]">
      <p className="font-schibsted font-semibold text-[13px] text-[#EFEBE9] leading-snug mb-[8px]">{headline(pick, factors)}</p>
      <ul className="flex flex-col gap-[7px]">
        {factors.map((f) => (
          <li key={f.text} className="flex gap-[10px] items-baseline font-schibsted text-[13px] text-[#D8D2CE] leading-snug">
            <span className="font-martian text-[9px] tracking-[1px] w-[64px] shrink-0" style={{ color: TONE[f.tone].c }}>{TONE[f.tone].t}</span>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-[12px]">
        <div className="relative h-[10px] rounded-full bg-[#2C2624]">
          <div
            className="absolute inset-y-0 left-0 rounded-full animate-bar-grow-x"
            style={{ width: `${pick.model_prob * 100}%`, background: tone }}
          />
          <div
            className="absolute -top-[4px] -bottom-[4px] w-[2px] bg-[#EFEBE9]"
            style={{ left: `${pick.implied_prob * 100}%` }}
            title={`Kalshi ${pct(pick.implied_prob)}`}
          />
        </div>
        <div className="mt-[6px] flex flex-wrap gap-x-4 gap-y-1 font-martian text-[11px] tabular-nums">
          <span style={{ color: tone }}>■ MODEL {pct(pick.model_prob)}</span>
          <span className="text-[#EFEBE9]">│ KALSHI {pct(pick.implied_prob)}</span>
          <span style={{ color: tone }}>
            EDGE {edge >= 0 ? '+' : ''}
            {edge.toFixed(1)} PTS
          </span>
        </div>
      </div>
      <div className="mt-[8px] font-martian text-[10px] text-[#8A827E] tracking-[0.5px]">
        Graded at game start. Model output, not betting advice.
      </div>
    </div>
  )
}
