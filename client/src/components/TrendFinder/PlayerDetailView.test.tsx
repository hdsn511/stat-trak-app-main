import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PlayerDetailView from './PlayerDetailView'

vi.mock('@/services/api', () => ({
  nbaApi: { getPlayerProfile: vi.fn() }
}))

import { nbaApi } from '@/services/api'

const mockProfile = {
  player: { id: 1, name: 'LeBron James', team: 'LAL', position: 'SF' },
  games: [
    { gameId: 1, date: '2024-01-15', points: 28, rebounds: 7, assists: 8, threes: 1, fouls: 2, minutes: 36 },
    { gameId: 2, date: '2024-01-17', points: 31, rebounds: 5, assists: 10, threes: 2, fouls: 1, minutes: 38 },
  ],
  zScores: { points: 1.8, rebounds: 0.5, assists: 1.2, threes: 0.9 },
  rollingAvgs: { points: 27.4, rebounds: 7.1, assists: 8.2, threes: 1.5 },
}

const renderWithRoute = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/player/${id}`]}>
      <Routes>
        <Route path="/player/:id" element={<PlayerDetailView />} />
      </Routes>
    </MemoryRouter>
  )

describe('PlayerDetailView', () => {
  beforeEach(() => {
    vi.mocked(nbaApi.getPlayerProfile).mockResolvedValue(mockProfile)
  })

  it('renders player name after load', async () => {
    renderWithRoute('1')
    expect(await screen.findByText('LeBron James')).toBeInTheDocument()
  })

  it('renders team and position', async () => {
    renderWithRoute('1')
    expect(await screen.findByText(/LAL/)).toBeInTheDocument()
    expect(await screen.findByText(/SF/)).toBeInTheDocument()
  })

  it('renders z-score strip with stat labels', async () => {
    renderWithRoute('1')
    expect(await screen.findByText('PTS')).toBeInTheDocument()
    expect(await screen.findByText('REB')).toBeInTheDocument()
    expect(await screen.findByText('AST')).toBeInTheDocument()
    expect(await screen.findByText('3PM')).toBeInTheDocument()
  })
})
