import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GameLogTable from './GameLogTable'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { GameRow } from '../types'

const defs = getPlayerStatConfig('nba').statsFor('player')

const season: GameRow[] = Array.from({ length: 82 }, (_, i) => ({
  date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
  opponent: 'BOS',
  points: 20 + (i % 7),
}))

describe('GameLogTable', () => {
  it('renders every game of a full season inside a vertically scrollable region', () => {
    render(<GameLogTable games={season} statDefs={defs} volumeDef={null} activeStat={defs[0].key} />)
    const scroller = screen.getByTestId('game-log-scroll')
    expect(scroller.className).toContain('overflow-auto')
    expect(scroller.className).toMatch(/max-h-\[\d+px\]/)
    // 82 body rows + the header row.
    expect(scroller.querySelectorAll('tbody tr')).toHaveLength(82)
  })

  it('pins the header row while the body scrolls', () => {
    render(<GameLogTable games={season} statDefs={defs} volumeDef={null} activeStat={defs[0].key} />)
    expect(screen.getByTestId('game-log-scroll').querySelector('thead tr')?.className).toContain(
      'sticky'
    )
  })

  it('shows an empty state with no games', () => {
    render(<GameLogTable games={[]} statDefs={defs} volumeDef={null} activeStat={defs[0].key} />)
    expect(screen.getByText(/NO GAMES MATCH/)).toBeInTheDocument()
  })
})
