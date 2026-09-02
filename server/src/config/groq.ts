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
// Groq's 8K TPM ceiling counts prompt + this reservation together, which is
// why this isn't 2000 (the original value) — but a gaps-and-islands streak
// query needs more than the 1000 that was tried first, which cut the model
// off mid-JSON on exactly that kind of question. 1600 is the balance point.
export const MAX_OUTPUT_TOKENS = 1600
