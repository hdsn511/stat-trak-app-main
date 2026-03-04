import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TrendFinder from './TrendFinder'

vi.mock('@/services/api', () => ({
  nbaApi: { getTrends: vi.fn() }
}))

import { nbaApi } from '@/services/api'

beforeEach(() => {
  vi.mocked(nbaApi.getTrends).mockResolvedValue([])
})

describe('TrendFinder', () => {
  it('renders all 4 stat filter buttons', () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    expect(screen.getByText('PTS')).toBeInTheDocument()
    expect(screen.getByText('REB')).toBeInTheDocument()
    expect(screen.getByText('AST')).toBeInTheDocument()
    expect(screen.getByText('3PM')).toBeInTheDocument()
  })

  it('renders game window buttons', () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    expect(screen.getByText('L5')).toBeInTheDocument()
    expect(screen.getByText('L10')).toBeInTheDocument()
    expect(screen.getByText('L15')).toBeInTheDocument()
    expect(screen.getByText('L20')).toBeInTheDocument()
  })

  it('renders threshold input', () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    expect(screen.getByPlaceholderText('e.g. 20')).toBeInTheDocument()
  })

  it('calls getTrends when stat is selected', async () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    fireEvent.click(screen.getByText('REB'))
    expect(vi.mocked(nbaApi.getTrends)).toHaveBeenCalled()
  })
})
