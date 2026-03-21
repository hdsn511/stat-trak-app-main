// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nbaApi } from './api'

const mockFetch = vi.fn()
const global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

const mockOk = (data: unknown) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ success: true, data }),
  } as Response)

describe('nbaApi.getTopTrending', () => {
  it('returns trending players array', async () => {
    mockFetch.mockReturnValueOnce(mockOk([{ playerId: 1, playerName: 'LeBron James' }]))
    const result = await nbaApi.getTopTrending()
    expect(result).toHaveLength(1)
    expect(result[0].playerName).toBe('LeBron James')
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/nba/trends/top')
  })
})

describe('nbaApi.getTrends', () => {
  it('fetches with stat and window params', async () => {
    mockFetch.mockReturnValueOnce(mockOk([]))
    await nbaApi.getTrends({ stat: 'points', window: 10, threshold: 25 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/nba/trends?stat=points&window=10&threshold=25'
    )
  })

  it('fetches without threshold when not provided', async () => {
    mockFetch.mockReturnValueOnce(mockOk([]))
    await nbaApi.getTrends({ stat: 'rebounds', window: 5 })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('stat=rebounds')
    expect(url).toContain('window=5')
    expect(url).not.toContain('threshold')
  })
})

describe('nbaApi.searchPlayers', () => {
  it('fetches with encoded query param', async () => {
    mockFetch.mockReturnValueOnce(mockOk([]))
    await nbaApi.searchPlayers('lebron')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/nba/players/search?q=lebron'
    )
  })
})

describe('nbaApi.getPlayerProfile', () => {
  it('fetches player profile by id', async () => {
    mockFetch.mockReturnValueOnce(mockOk({ player: { id: 1 }, games: [], zScores: {}, rollingAvgs: {} }))
    const result = await nbaApi.getPlayerProfile(1)
    expect(result.player.id).toBe(1)
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/nba/players/1/games')
  })
})

describe('nbaApi.getTodaysGames', () => {
  it('fetches today\'s games', async () => {
    mockFetch.mockReturnValueOnce(mockOk([{ gameId: 'abc' }]))
    const result = await nbaApi.getTodaysGames()
    expect(result[0].gameId).toBe('abc')
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/nba/games/today')
  })
})
