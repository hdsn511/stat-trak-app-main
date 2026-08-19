import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from './Sidebar'

// Sidebar navigates on game click, so it needs a router in the tree.
const renderSidebar = () => render(<MemoryRouter><Sidebar /></MemoryRouter>)

vi.mock('@/services/api', () => ({
  nbaApi: {
    getTodaysGames: vi.fn().mockResolvedValue([
      {
        gameId: '1',
        status: '7:30 PM ET',
        home: { team: 'LAL', score: '' },
        away: { team: 'GSW', score: '' },
      }
    ])
  }
}))

describe('Sidebar', () => {
  it('renders Today\'s Games heading', () => {
    renderSidebar()
    expect(screen.getByText("Today's Games")).toBeInTheDocument()
  })

  it('renders game matchup after load', async () => {
    renderSidebar()
    expect(await screen.findByText('LAL')).toBeInTheDocument()
    expect(await screen.findByText('GSW')).toBeInTheDocument()
  })

  it('renders game status', async () => {
    renderSidebar()
    expect(await screen.findByText('7:30 PM ET')).toBeInTheDocument()
  })
})
