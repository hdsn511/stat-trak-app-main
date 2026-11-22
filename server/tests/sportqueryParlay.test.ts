import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/config/supabaseAdmin', () => ({ supabaseAdmin: {} }))

import { americanOdds, parseParlayRequest, priceParlay, type Leg } from '../src/services/sportqueryParlay'

const leg = (prob: number, implied: number | null, gameId: number): Leg => ({
  label: 'P', stat: 'PTS', line: 10.5, side: 'over', prob, implied, gameId, source: 'pick',
})

describe('parlay math', () => {
  it('multiplies chances and flags same-game legs', () => {
    const r = priceParlay([leg(0.7, 0.65, 1), leg(0.6, 0.6, 1), leg(0.5, 0.5, 2)])
    expect(r.combinedProb).toBeCloseTo(0.21, 5)
    expect(r.combinedImplied).toBeCloseTo(0.195, 5)
    expect(r.sameGameGroups).toEqual([[0, 1]])
    expect(r.notes.join(' ')).toMatch(/same game/)
  })

  it('skips the market comparison when a leg has no price', () => {
    const r = priceParlay([leg(0.7, null, 1), leg(0.6, 0.6, 2)])
    expect(r.combinedImplied).toBeNull()
    expect(r.edgePts).toBeNull()
  })

  it('converts to american odds and parses requests', () => {
    expect(americanOdds(0.5)).toBe(-100)
    expect(americanOdds(0.25)).toBe(300)
    expect(parseParlayRequest('parlay the top 4 NBA streaks')).toEqual({ n: 4, kind: 'streak', leagueId: 1 })
  })
})
