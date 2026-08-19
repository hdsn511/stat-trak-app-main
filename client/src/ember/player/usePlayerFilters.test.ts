import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePlayerFilters } from './usePlayerFilters'
import { getPlayerStatConfig, allStatsFor } from '@/config/playerStats'
import type { GameRow, PlayerFilters } from './types'

const statDefs = allStatsFor(getPlayerStatConfig('nba'), 'player')
const games: GameRow[] = [
  { opponent: 'BOS', isHome: true, points: 30 },
  { opponent: 'LAL', isHome: false, points: 20 },
  { opponent: 'BOS', isHome: false, points: 10 },
]

const setup = (initial?: Partial<PlayerFilters>) =>
  renderHook(() => usePlayerFilters({ games, statDefs, initial }))

describe('usePlayerFilters', () => {
  it('defaults the line to the average of the unfiltered log', () => {
    const { result } = setup()
    expect(result.current.filters.line).toBe(20)
    expect(result.current.filters.lineTouched).toBe(false)
  })

  it('seeds from initial filters', () => {
    const { result } = setup({ window: 10, vsTeam: 'BOS', stat: 'rebounds' })
    expect(result.current.filters.window).toBe(10)
    expect(result.current.filters.vsTeam).toBe('BOS')
    expect(result.current.filters.stat).toBe('rebounds')
  })

  it('recomputes the line when the opponent filter changes', () => {
    const { result } = setup()
    act(() => result.current.setVsTeam('BOS'))
    // BOS games are 30 and 10 → average 20
    expect(result.current.filters.line).toBe(20)
    act(() => result.current.setVsTeam('LAL'))
    expect(result.current.filters.line).toBe(20)
  })

  it('preserves a manually set line across filter changes', () => {
    const { result } = setup()
    act(() => result.current.setLine(27.5))
    expect(result.current.filters.lineTouched).toBe(true)
    act(() => result.current.setVsTeam('BOS'))
    expect(result.current.filters.line).toBe(27.5)
  })

  it('resetLine restores the computed average and clears the touched flag', () => {
    const { result } = setup()
    act(() => result.current.setLine(99))
    act(() => result.current.resetLine())
    expect(result.current.filters.line).toBe(20)
    expect(result.current.filters.lineTouched).toBe(false)
  })

  it('recomputes the line when the stat changes even if touched', () => {
    // A line of 27.5 points is meaningless once the stat becomes rebounds.
    const { result } = setup()
    act(() => result.current.setLine(27.5))
    act(() => result.current.setStat('rebounds'))
    expect(result.current.filters.lineTouched).toBe(false)
  })

  it('ignores an unknown stat key', () => {
    const { result } = setup()
    act(() => result.current.setStat('not_a_stat'))
    expect(result.current.filters.stat).toBe('points')
  })

  it('treats an initial line as user-set so it is not overwritten', () => {
    const { result } = setup({ line: 24.5 })
    expect(result.current.filters.line).toBe(24.5)
    expect(result.current.filters.lineTouched).toBe(true)
  })

  it('sets the venue filter', () => {
    const { result } = setup()
    act(() => result.current.setHomeAway('away'))
    expect(result.current.filters.homeAway).toBe('away')
  })
})
