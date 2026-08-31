import Groq from 'groq-sdk'

const apiKey = process.env.GROQ_API_KEY
if (!apiKey) {
  console.warn('SportQuery: GROQ_API_KEY not set. LLM calls will fail.')
}

export const groq = new Groq({ apiKey: apiKey ?? 'missing' })

// gpt-oss-120b shares gpt-oss-20b's free-tier limits on Groq exactly (30 RPM,
// 1K RPD, 8K TPM, 200K TPD as of 2026-08), so this is a strictly stronger
// model at no quota cost — worth it for multi-sport text-to-SQL accuracy.
export const SPORTQUERY_MODEL = 'openai/gpt-oss-120b'
export const SQL_TEMPERATURE = 0.1
export const NARRATIVE_TEMPERATURE = 0.5
export const MAX_INPUT_TOKENS = 8000
// Multi-sport docs pushed the system prompt close to Groq's 8K TPM ceiling
// (which counts prompt + this reservation together), so this was trimmed
// from 2000 — observed JSON envelopes (sql + narrative) run well under 1000.
export const MAX_OUTPUT_TOKENS = 1000
