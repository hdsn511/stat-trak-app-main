import {
  groq,
  SPORTQUERY_MODEL,
  SQL_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
} from '../config/groq'
import { SPORTQUERY_SYSTEM_PROMPT } from '../prompts/sportquery-system'
import { FEW_SHOT_EXAMPLES } from '../prompts/sportquery-examples'

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
    env.follow_up_suggestions = obj.follow_up_suggestions.map(String)
  }

  return { ok: true, envelope: env }
}

export type HistoryEntry = { role: 'user' | 'assistant'; content: string }

export async function callLLM(
  history: HistoryEntry[],
  userMessage: string
): Promise<Envelope> {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] =
    [{ role: 'system', content: SPORTQUERY_SYSTEM_PROMPT }]

  for (const ex of FEW_SHOT_EXAMPLES) {
    messages.push({ role: 'user', content: ex.user })
    messages.push({ role: 'assistant', content: ex.assistant })
  }

  for (const h of history.slice(-20)) {
    messages.push({ role: h.role, content: h.content })
  }

  messages.push({ role: 'user', content: userMessage })

  const completion = await groq.chat.completions.create({
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
      role: 'system',
      content:
        'Your previous output was not valid JSON matching the required envelope. Respond with exactly one JSON object: {"sql": string|null, "narrative": string}. No code fences.',
    })
    const retry = await groq.chat.completions.create({
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
