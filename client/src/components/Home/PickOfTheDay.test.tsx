import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PickOfTheDay from './PickOfTheDay'

vi.mock('@/services/api', () => ({
  nbaApi: { getTodaysPicks: vi.fn() },
}))

import { nbaApi } from '@/services/api'

const mockResponse = {
  gameDate: '2026-04-27',
  topPick: {
    pickId: 1,
    date: '2026-04-27',
    playerId: 42,
    playerName: 'LeBron James',
    team: 'LAL',
    position: 'SF',
    stat: 'pts',
    statLabel: 'PTS',
    pickType: 'safe' as const,
    recommendedLine: 25.5,
    confidence: 82,
    edge: 0.12,
    hitRate: 0.87,
    impliedProb: 0.75,
    sampleSize: 18,
    conditionsMatched: 4,
    totalConditions: 5,
  },
  allPicks: [],
}

beforeEach(() => {
  vi.mocked(nbaApi.getTodaysPicks).mockResolvedValue(mockResponse)
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

  it('renders formatted game date', async () => {
    render(<MemoryRouter><PickOfTheDay /></MemoryRouter>)
    expect(await screen.findByText('Apr 27')).toBeInTheDocument()
  })

  it('shows analyzing state when no pick', async () => {
    vi.mocked(nbaApi.getTodaysPicks).mockResolvedValue({ gameDate: null, topPick: null, allPicks: [] })
    render(<MemoryRouter><PickOfTheDay /></MemoryRouter>)
    expect(await screen.findByText(/Analyzing today's slate/i)).toBeInTheDocument()
  })
})
