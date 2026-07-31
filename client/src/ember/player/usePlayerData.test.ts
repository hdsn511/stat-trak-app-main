import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlayerData } from './usePlayerData'

const ok = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) })

/** The stubbed global fetch, typed so tests can assert on its calls. */
const mockFetch = () => globalThis.fetch as unknown as MockInstance<typeof fetch>

const PROFILE = {
  player: { id: 1, name: 'Test Player', team: 'OKC', position: 'G' },
  teamId: 9,
  games: [{ opponent: 'BOS', points: 20 }],
  seasonAvgs: { points: 20 },
  gamesPlayed: 1,
  upcoming: null,
}

describe('usePlayerData', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('requests the full season log', async () => {
    mockFetch().mockResolvedValue(ok(PROFILE) as unknown as Response)
    const { result } = renderHook(() => usePlayerData('nba', 1))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(String(mockFetch().mock.calls[0][0])).toContain('/api/nba/players/1/games?window=all')
    expect(result.current.data?.player.name).toBe('Test Player')
    expect(result.current.error).toBeNull()
  })

  it('surfaces a fetch failure as an error, not a crash', async () => {
    mockFetch().mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => usePlayerData('nba', 1))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network down')
    expect(result.current.data).toBeNull()
  })

  it('refetches when the player id changes', async () => {
    mockFetch().mockResolvedValue(ok(PROFILE) as unknown as Response)
    const { result, rerender } = renderHook(({ id }) => usePlayerData('nba', id), {
      initialProps: { id: 1 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ id: 2 })
    await waitFor(() => expect(mockFetch().mock.calls.length).toBe(2))
    expect(String(mockFetch().mock.calls[1][0])).toContain('/players/2/games')
  })

  it('uses the league slug in the request path', async () => {
    mockFetch().mockResolvedValue(ok(PROFILE) as unknown as Response)
    const { result } = renderHook(() => usePlayerData('nhl', 7))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(String(mockFetch().mock.calls[0][0])).toContain('/api/nhl/players/7/games')
  })
})
