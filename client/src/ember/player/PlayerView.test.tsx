import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlayerView from './PlayerView'
import type { PlayerLogResponse } from './types'

const DATA: PlayerLogResponse = {
  player: { id: 1, name: 'Test Player', team: 'OKC', position: 'G' },
  teamId: 9,
  games: [
    { date: '2026-04-10', opponent: 'BOS', isHome: true, points: 30, rebounds: 5, assists: 4, threes: 3, minutes: 36 },
    { date: '2026-04-08', opponent: 'LAL', isHome: false, points: 20, rebounds: 7, assists: 6, threes: 2, minutes: 33 },
    { date: '2026-04-06', opponent: 'BOS', isHome: false, points: 10, rebounds: 4, assists: 5, threes: 1, minutes: 31 },
  ],
  seasonAvgs: { points: 20 },
  gamesPlayed: 3,
  upcoming: null,
}

describe('PlayerView', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: null }) })
    )
  )
  afterEach(() => vi.unstubAllGlobals())

  it('renders the player identity', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    expect(screen.getByText('Test Player')).toBeInTheDocument()
  })

  it('offers every opponent the player has faced', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    const select = screen.getByLabelText('Opponent') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['', 'BOS', 'LAL'])
  })

  it('narrows the log when an opponent is chosen', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: 'BOS' } })
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(2)
  })

  it('seeds filters from an initial query filter', () => {
    render(
      <PlayerView slug="nba" data={DATA} mode="full" initialFilters={{ vsTeam: 'BOS', window: 5 }} />
    )
    expect((screen.getByLabelText('Opponent') as HTMLSelectElement).value).toBe('BOS')
    expect(screen.getByRole('button', { name: 'L5' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('drives the matchup panel from the opponent filter when nothing is scheduled', async () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    expect(screen.getByText(/SELECT AN OPPONENT/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: 'BOS' } })
    await waitFor(() => expect(screen.getByText(/MATCHUP: VS BOS/)).toBeInTheDocument())
  })

  it('renders a no-games state for an empty log', () => {
    render(<PlayerView slug="nba" data={{ ...DATA, games: [] }} mode="full" />)
    expect(screen.getByText(/NO GAMES LOGGED/)).toBeInTheDocument()
  })

  it('shows the volume stat column for the league', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    // MIN appears as a stat card and as a game-log column header.
    expect(screen.getAllByText('MIN').length).toBeGreaterThan(0)
  })

  it('recomputes the hit rate when the line moves', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    // Season average of 20 → line 20 → one over (30), one under (10), one push.
    expect(screen.getByText('1/2 OVER')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Raise line' }))
    // Line 20.5 → 30 over; 20 and 10 under.
    expect(screen.getByText('1/3 OVER')).toBeInTheDocument()
  })
})
