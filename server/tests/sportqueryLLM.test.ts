import { describe, it, expect } from 'vitest'
import { parseEnvelope } from '../src/services/sportqueryLLM'

describe('parseEnvelope', () => {
  it('parses a valid envelope with sql + narrative', () => {
    const raw = JSON.stringify({
      sql: 'SELECT 1',
      narrative: 'hi',
    })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.envelope.sql).toBe('SELECT 1')
      expect(r.envelope.narrative).toBe('hi')
    }
  })

  it('parses envelope with null sql', () => {
    const raw = JSON.stringify({ sql: null, narrative: 'hello' })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
  })

  it('strips code fences if model emits them', () => {
    const raw = '```json\n{"sql": null, "narrative": "hi"}\n```'
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
  })

  it('rejects non-JSON', () => {
    const r = parseEnvelope('this is not json at all')
    expect(r.ok).toBe(false)
  })

  it('rejects when narrative is missing', () => {
    const raw = JSON.stringify({ sql: 'SELECT 1' })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(false)
  })

  it('accepts optional disambiguation field', () => {
    const raw = JSON.stringify({
      sql: null,
      narrative: 'pick one',
      disambiguation: {
        candidates: ['A', 'B'],
        prompt: 'which?',
      },
    })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.envelope.disambiguation?.candidates).toHaveLength(2)
    }
  })
})
