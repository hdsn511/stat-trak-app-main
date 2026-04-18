import Groq from 'groq-sdk'

const apiKey = process.env.GROQ_API_KEY
if (!apiKey) {
  console.warn('SportQuery: GROQ_API_KEY not set. LLM calls will fail.')
}

export const groq = new Groq({ apiKey: apiKey ?? 'missing' })

export const SPORTQUERY_MODEL = 'moonshotai/kimi-k2-instruct'
export const SQL_TEMPERATURE = 0.1
export const NARRATIVE_TEMPERATURE = 0.5
export const MAX_INPUT_TOKENS = 8000
export const MAX_OUTPUT_TOKENS = 2000
