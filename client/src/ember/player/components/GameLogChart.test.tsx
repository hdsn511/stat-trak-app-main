import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GameLogChart from './GameLogChart'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { GameRow } from '../types'

const def = getPlayerStatConfig('nba').statsFor('player')[0]
const games: GameRow[] = [
  { date: '2026-04-10', opponent: 'BOS', points: 30 },
  { date: '2026-04-08', opponent: 'LAL', points: 20 },
  { date: '2026-04-06', opponent: 'MIA', points: 10 },
]

describe('GameLogChart', () => {
  it('renders one bar per game, oldest first', () => {
    render(<GameLogChart games={games} def={def} line={25} />)
    const bars = screen.getAllByTestId('chart-bar')
    expect(bars).toHaveLength(3)
    // Chronological left-to-right: the API sends newest first, so it reverses.
    expect(bars[0]).toHaveAttribute('data-value', '10')
    expect(bars[2]).toHaveAttribute('data-value', '30')
  })

  it('marks each bar as a clear, miss, or push against the line', () => {
    render(<GameLogChart games={games} def={def} line={20} />)
    const bars = screen.getAllByTestId('chart-bar')
    expect(bars[0]).toHaveAttribute('data-result', 'under')
    expect(bars[1]).toHaveAttribute('data-result', 'push')
    expect(bars[2]).toHaveAttribute('data-result', 'over')
  })

  it('labels the threshold with its value', () => {
    render(<GameLogChart games={games} def={def} line={25} />)
    expect(screen.getByText(/LINE 25/)).toBeInTheDocument()
  })

  it('renders an empty state rather than an empty chart', () => {
    render(<GameLogChart games={[]} def={def} line={25} />)
    expect(screen.getByText(/NO GAMES MATCH/)).toBeInTheDocument()
    expect(screen.queryAllByTestId('chart-bar')).toHaveLength(0)
  })

  it('skips games with no value for the stat', () => {
    render(<GameLogChart games={[{ points: null }, { points: 12 }]} def={def} line={10} />)
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(1)
  })

  it('labels each bar with its opponent at small game counts', () => {
    render(<GameLogChart games={games} def={def} line={25} />)
    expect(screen.getByText('BOS')).toBeInTheDocument()
    expect(screen.getByText('MIA')).toBeInTheDocument()
  })

  it('drops per-bar labels when there are too many to read', () => {
    // A full NBA season is ~82 bars; three-letter codes become illegible mush.
    const many = Array.from({ length: 40 }, (_, i) => ({
      opponent: 'BOS',
      points: 10 + (i % 5),
    }))
    render(<GameLogChart games={many} def={def} line={12} />)
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(40)
    expect(screen.queryByText('BOS')).not.toBeInTheDocument()
  })

  it('drops the per-bar values too when bars get dense', () => {
    const many = Array.from({ length: 40 }, () => ({ opponent: 'BOS', points: 11 }))
    render(<GameLogChart games={many} def={def} line={12} />)
    expect(screen.queryAllByTestId('chart-value')).toHaveLength(0)
  })
})
