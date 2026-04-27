import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TrendFinder from './TrendFinder'

const mockTrending = [
  { playerId: 1, playerName: 'LeBron James', team: 'LAL', position: 'SF',
    stat: 'points', statId: 0, zScore: 2.1, rollingAvg: 27.4, windowSize: 10 },
  { playerId: 2, playerName: 'Stephen Curry', team: 'GSW', position: 'PG',
    stat: 'points', statId: 0, zScore: 1.8, rollingAvg: 29.1, windowSize: 10 },
]

const mockFiltered = [
  { playerId: 3, playerName: 'Nikola Jokic', team: 'DEN', position: 'C',
    stat: 'points', statId: 0, zScore: 1.9, rollingAvg: 26.5, windowSize: 10 },
]

vi.mock('@/services/api', () => ({
  nbaApi: {
    getTopTrending: vi.fn(),
    getTrends: vi.fn(),
  },
}))

import { nbaApi } from '@/services/api'

beforeEach(() => {
  vi.mocked(nbaApi.getTopTrending).mockResolvedValue(mockTrending)
  vi.mocked(nbaApi.getTrends).mockResolvedValue(mockFiltered)
})

describe('TrendFinder', () => {
  it('calls getTopTrending on mount (default mode)', async () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    await waitFor(() => expect(nbaApi.getTopTrending).toHaveBeenCalledOnce())
    expect(nbaApi.getTrends).not.toHaveBeenCalled()
  })

  it('shows trending players in default mode', async () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    expect(await screen.findByText('LeBron James')).toBeInTheDocument()
    expect(screen.getByText('Stephen Curry')).toBeInTheDocument()
  })

  it('calls getTrends and shows Clear button when threshold is entered', async () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    const input = screen.getByPlaceholderText('—')
    fireEvent.change(input, { target: { value: '20' } })
    await waitFor(() => expect(nbaApi.getTrends).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 20 })
    ))
    expect(screen.getByLabelText('Clear filter')).toBeInTheDocument()
  })

  it('returns to trending mode when Clear is clicked', async () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    const input = screen.getByPlaceholderText('—')
    fireEvent.change(input, { target: { value: '20' } })
    await waitFor(() => screen.getByLabelText('Clear filter'))
    fireEvent.click(screen.getByLabelText('Clear filter'))
    await waitFor(() => expect(input).toHaveValue(null))
    expect(screen.queryByLabelText('Clear filter')).not.toBeInTheDocument()
  })

  it('renders all 4 stat tabs', () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    expect(screen.getByText('PTS')).toBeInTheDocument()
    expect(screen.getByText('REB')).toBeInTheDocument()
    expect(screen.getByText('AST')).toBeInTheDocument()
    expect(screen.getByText('3PM')).toBeInTheDocument()
  })
})
