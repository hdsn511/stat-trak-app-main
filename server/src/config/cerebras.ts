import OpenAI from 'openai'

const apiKey = process.env.CEREBRAS_API_KEY
if (!apiKey) {
  console.warn('SportQuery: CEREBRAS_API_KEY not set. LLM calls will fail.')
}

// Cerebras exposes an OpenAI-compatible API, so the openai SDK (already a
// dependency) talks to it with only a different baseURL.
export const llm = new OpenAI({
  apiKey: apiKey ?? 'missing',
  baseURL: 'https://api.cerebras.ai/v1',
})

// qwen-3.8-27b answered 8/8 of a betting-style eval vs 6/8 for gpt-oss-120b
// (2026-11-11), at ~2.5x the per-question cost.
export const SPORTQUERY_MODEL = process.env.SPORTQUERY_MODEL ?? 'qwen-3.8-27b'
export const SQL_TEMPERATURE = 0.1
export const NARRATIVE_TEMPERATURE = 0.5
export const MAX_INPUT_TOKENS = 8000
// Groq's 8K TPM ceiling forced this down to 1600; Cerebras has no such cap, so
// gaps-and-islands streak queries are no longer at risk of being cut off.
// gpt-oss counts its reasoning tokens against this too; multi-CTE answers were
// being cut off mid-JSON at 3000.
export const MAX_OUTPUT_TOKENS = 8000
