import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PlayerPage from './PlayerPage'

const PROFILE = {
  player: { id: 1, name: 'Test Player', team: 'OKC', position: 'G' },
  teamId: 9,
  games: [
    {
      date: '2026-04-10',
      opponent: 'BOS',
      isHome: true,
      points: 30,
      rebounds: 5,
      assists: 4,
      threes: 3,
      minutes: 36,
    },
  ],
  seasonAvgs: {},
  gamesPlayed: 1,
  upcoming: null,
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/player/:league/:id" element={<PlayerPage />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>
  )

describe('PlayerPage', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: PROFILE }) })
    )
  )
  afterEach(() => vi.unstubAllGlobals())

  it('shows a loading state before data arrives', () => {
    at('/player/nba/1')
    expect(screen.getByText(/LOADING/)).toBeInTheDocument()
  })

  it('renders the player once loaded', async () => {
    at('/player/nba/1')
    await waitFor(() => expect(screen.getByText('Test Player')).toBeInTheDocument())
  })

  it('redirects an unknown league to home', async () => {
    at('/player/cricket/1')
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })

  it('redirects a non-numeric player id to home', async () => {
    at('/player/nba/abc')
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })

  it('shows an error with a retry when the fetch fails', async () => {
    ;(globalThis.fetch as unknown as MockInstance<typeof fetch>).mockRejectedValue(
      new Error('boom')
    )
    at('/player/nba/1')
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /RETRY/ })).toBeInTheDocument()
  })

  it('works for every registered league slug', async () => {
    at('/player/nhl/1')
    await waitFor(() => expect(screen.getByText('Test Player')).toBeInTheDocument())
  })
})
