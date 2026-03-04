import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TopTrending from './TopTrending'
import { nbaApi } from '@/services/api'

const mockPlayers = [
  { playerId: 1, playerName: 'Player One', team: 'LAL', position: 'SF', stat: 'points', statId: 0, zScore: 2.1, rollingAvg: 27.4, windowSize: 10 },
  { playerId: 2, playerName: 'Player Two', team: 'GSW', position: 'PG', stat: 'assists', statId: 2, zScore: 1.8, rollingAvg: 9.2, windowSize: 10 },
]

vi.mock('@/services/api', () => ({
  nbaApi: { getTopTrending: vi.fn() }
}))

beforeEach(() => {
  vi.mocked(nbaApi.getTopTrending).mockResolvedValue(mockPlayers)
})

describe('TopTrending', () => {
  it('renders heading', async () => {
    render(<MemoryRouter><TopTrending /></MemoryRouter>)
    expect(screen.getByText('Top Trending')).toBeInTheDocument()
  })

  it('renders player 2 (skips player 1)', async () => {
    render(<MemoryRouter><TopTrending /></MemoryRouter>)
    expect(await screen.findByText('Player Two')).toBeInTheDocument()
  })

  it('does not render player 1 (used in PickOfTheDay)', async () => {
    render(<MemoryRouter><TopTrending /></MemoryRouter>)
    await screen.findByText('Player Two')
    expect(screen.queryByText('Player One')).not.toBeInTheDocument()
  })
})
