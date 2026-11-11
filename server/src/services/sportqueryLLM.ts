import {
  llm,
  SPORTQUERY_MODEL,
  SQL_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
} from '../config/cerebras'
import { SPORTQUERY_SYSTEM_PROMPT } from '../prompts/sportquery-system'
import { FEW_SHOT_EXAMPLES } from '../prompts/sportquery-examples'

// Mirrors client/src/ember/sportquery/suggestions.ts UNSUPPORTED_TERMS: things
// the data does not contain. A follow-up chip mentioning one is dropped rather
// than offered as a question we cannot answer.
const UNSUPPORTED_RE = new RegExp(
  [
    'hard(est)?.? ?hit', 'exit velocity', 'launch angle', 'statcast', 'barrel', 'xwoba', 'clutch',
    'route', 'red.?zone', 'power.?play unit', 'pace (matchup|offense)', 'fastest pace',
    'tracking', 'play.?by.?play', '\\blive\\b', 'salary', 'contract', 'injur(y|ies) history',
    'weather', 'predict', '\\bWAR\\b', 'spin rate', 'time of possession',
    '\\bpicks?\\b', '\\blines?\\b', 'odds', 'props?\\b', 'kalshi', 'spread', 'cover(ing)?\\b', '\\bbet', 'parlay',
  ].join('|'),
  'i'
)

export type Envelope = {
  sql: string | null
  narrative: string
  disambiguation?: { candidates: string[]; prompt: string }
  follow_up_suggestions?: string[]
}

export type EnvelopeParseResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; reason: string }

export function parseEnvelope(raw: string): EnvelopeParseResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let obj: any
  try {
    obj = JSON.parse(cleaned)
  } catch (err: any) {
    return { ok: false, reason: `invalid JSON: ${err.message}` }
  }

  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, reason: 'not an object' }
  }
  if (!('sql' in obj) || (obj.sql !== null && typeof obj.sql !== 'string')) {
    return { ok: false, reason: 'missing or invalid sql field' }
  }
  if (typeof obj.narrative !== 'string') {
    return { ok: false, reason: 'missing or invalid narrative field' }
  }

  const env: Envelope = {
    sql: obj.sql,
    narrative: obj.narrative,
  }
  if (obj.disambiguation && typeof obj.disambiguation === 'object') {
    env.disambiguation = {
      candidates: Array.isArray(obj.disambiguation.candidates)
        ? obj.disambiguation.candidates.map(String)
        : [],
      prompt: String(obj.disambiguation.prompt ?? ''),
    }
  }
  if (Array.isArray(obj.follow_up_suggestions)) {
    env.follow_up_suggestions = obj.follow_up_suggestions
      .map(String)
      .filter((q: string) => !UNSUPPORTED_RE.test(q))
  }

  return { ok: true, envelope: env }
}

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

export type HistoryEntry ={ role: 'user' | 'assistant'; content: string }

// With SQL present the narrative is written AFTER the query runs (see narrate),
// so few-shot examples must not teach the model to describe results it hasn't seen.
function exampleAssistant(raw: string): string {
  try {
    const obj = JSON.parse(raw)
    if (obj && obj.sql) obj.narrative = ''
    return JSON.stringify(obj)
  } catch {
    return raw
  }
}

const NARRATE_SYSTEM = `You are a sharp sports analyst answering a fan's question using ONLY the verified result rows provided.
- Line 1: the direct answer in one short sentence, bolding key names and numbers (**LeBron James**, **38 pts**).
- Then 2-3 bullets starting with "- " that give the WHY: cite the strongest evidence columns from the rows (e.g. "over 14.5 in **8 of his last 10**, averaging **17.4**", "opponent allows **15.3** 3PM per game"). If the question has several parts, answer each part. Mention a runner-up or two when the rows make it useful.
- Never explain how you interpreted the question, never describe the query, never mention "rows", "columns" or "sample size of 1". Just answer like an analyst would.
- Use only values that appear in the rows. Never invent numbers, never write placeholders like "x" or "y" or "{team}". implied_prob 0.54 = 54%.
- Opponent/defense rank columns (opp_*rank*, opp_def_rank_position): 1 = TOUGHEST defense (bad matchup), 30 = SOFTEST (good matchup). Higher "allowed" numbers = softer defense.
- If the row for a named player has no line (line/implied null), lead with "No <stat> line is posted for <player> tonight", then give his recent numbers if present. Never give a bet verdict without a line, and never pad with columns that don't bear on the question.
- If there are no rows, say plainly that nothing matched for what was asked (player, team, stat, period) and suggest one concrete rephrase.
- Plain text with the light markdown above. No headings.`

export async function narrate(
  question: string,
  rows: Record<string, unknown>[],
  totalRows: number,
  note?: string | null
): Promise<string> {
  const noLine = rows.length > 0 && rows.every((r) => 'line' in r && r.line == null)
  // With no line, "over 10/10" style columns were computed against null/0 and are
  // meaningless; prompting alone did not stop the model citing them.
  const LINE_DERIVED = /(^|_)over(_|$)|vs_line|cover|hit_rate/i
  const compact = rows.slice(0, 20).map((r) =>
    Object.fromEntries(
      Object.entries(r).filter(
        ([k, v]) => v !== null && v !== undefined && !(noLine && LINE_DERIVED.test(k))
      )
    )
  )
  const data = JSON.stringify(compact).slice(0, 6000)
  const completion = await llm.chat.completions.create({
    model: SPORTQUERY_MODEL,
    temperature: 0.3,
    // gpt-oss is a reasoning model: reasoning tokens count against max_tokens,
    // and at 500 they often consumed it all, leaving an empty answer.
    max_tokens: 2000,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: NARRATE_SYSTEM },
      {
        role: 'user',
        content:
          `TODAY (US Eastern): ${todayET()}\nQUESTION: ${question}\n` +
          `ROWS RETURNED: ${totalRows} (showing ${compact.length})\n` +
          (note ? `NOTE: ${note}\n` : '') +
          // Stated outright: the model otherwise gives an over/under verdict with no line.
          (noLine ? 'NOTE: NO BETTING LINE IS POSTED for this tonight — say so first; give no over/under verdict and ignore every column computed against the line (over_*, *_vs_line).\n' : '') +
          `ROWS: ${data}`,
      },
    ],
  })
  const text = (completion.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('empty narrative')
  return text
}

export async function callLLM(
  history: HistoryEntry[],
  userMessage: string,
  hints = ''
): Promise<Envelope> {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] =
    [{ role: 'system', content: `${SPORTQUERY_SYSTEM_PROMPT}\n\nTODAY (US Eastern): ${todayET()}. Resolve "today"/"yesterday"/"last night" against this date.` }]

  for (const ex of FEW_SHOT_EXAMPLES) {
    messages.push({ role: 'user', content: ex.user })
    messages.push({ role: 'assistant', content: exampleAssistant(ex.assistant) })
  }

  for (const h of history.slice(-20)) {
    messages.push({ role: h.role, content: h.content })
  }

  // Hints ride in the user turn: some Cerebras models (qwen) reject a second system message.
  messages.push({ role: 'user', content: hints ? `${userMessage}\n\n[${hints}]` : userMessage })

  const completion = await llm.chat.completions.create({
    model: SPORTQUERY_MODEL,
    temperature: SQL_TEMPERATURE,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices?.[0]?.message?.content ?? ''
  let result = parseEnvelope(raw)

  if (!result.ok) {
    messages.push({
      role: 'user',
      content:
        'Your previous output was not valid JSON matching the required envelope. Respond with exactly one JSON object: {"sql": string|null, "narrative": string}. No code fences.',
    })
    const retry = await llm.chat.completions.create({
      model: SPORTQUERY_MODEL,
      temperature: SQL_TEMPERATURE,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages,
      response_format: { type: 'json_object' },
    })
    const retryRaw = retry.choices?.[0]?.message?.content ?? ''
    result = parseEnvelope(retryRaw)
  }

  if (result.ok === false) {
    throw new Error(`LLM returned unparsable envelope: ${result.reason}`)
  }
  return result.envelope
}
