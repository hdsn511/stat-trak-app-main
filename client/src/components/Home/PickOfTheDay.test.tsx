import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PickOfTheDay from './PickOfTheDay'
import { nbaApi } from '@/services/api'

const mockPick = {
  playerId: 1,
  playerName: 'LeBron James',
  team: 'LAL',
  position: 'SF',
  stat: 'points',
  statId: 0,
  zScore: 2.1,
  rollingAvg: 27.4,
  windowSize: 10,
}

vi.mock('@/services/api', () => ({
  nbaApi: { getTopTrending: vi.fn() }
}))

beforeEach(() => {
  vi.mocked(nbaApi.getTopTrending).mockResolvedValue([mockPick])
})

describe('PickOfTheDay', () => {
  it('renders pick of the day label', async () => {
    render(<MemoryRouter><PickOfTheDay /></MemoryRouter>)
    expect(await screen.findByText('Pick of the Day')).toBeInTheDocument()
  })

  it('renders player name', async () => {
    render(<MemoryRouter><PickOfTheDay /></MemoryRouter>)
    expect(await screen.findByText('LeBron James')).toBeInTheDocument()
  })

  it('renders rolling avg', async () => {
    render(<MemoryRouter><PickOfTheDay /></MemoryRouter>)
    expect(await screen.findByText('27.4')).toBeInTheDocument()
  })
})
