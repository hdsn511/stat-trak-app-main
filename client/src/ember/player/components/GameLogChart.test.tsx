import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GameLogChart from './GameLogChart'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { GameRow } from '../types'
import { usageFor } from '../usage'

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

  it('keeps every bar and label for a full season, scrolling instead of cramming', () => {
    // A full NBA season is ~82 bars; each keeps its minimum width and the
    // chart overflows into a horizontal scroller.
    const many = Array.from({ length: 82 }, (_, i) => ({
      opponent: 'BOS',
      points: 10 + (i % 5),
    }))
    const { container } = render(<GameLogChart games={many} def={def} line={12} />)
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(82)
    expect(screen.getAllByTestId('chart-value')).toHaveLength(82)
    expect(screen.getAllByText('BOS')).toHaveLength(82)
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull()
  })

  it('draws the threshold on the same scale as the bars', () => {
    // 37 is the tallest bar (full 120px); a 27 line must sit at 27/37 of that,
    // i.e. BELOW the top of the 37 bar, not above it.
    const g: GameRow[] = [
      { date: '2026-04-10', opponent: 'BOS', points: 37 },
      { date: '2026-04-08', opponent: 'LAL', points: 20 },
    ]
    render(<GameLogChart games={g} def={def} line={27} />)
    const bars = screen.getAllByTestId('chart-bar')
    const tall = bars.find((b) => b.getAttribute('data-value') === '37')!
    const barPx = parseFloat((tall as HTMLElement).style.height)
    const linePx = parseFloat((screen.getByTestId('chart-line') as HTMLElement).style.bottom)
    expect(barPx).toBeCloseTo(120, 5)
    expect(linePx).toBeCloseTo((27 / 37) * 120, 5)
    expect(linePx).toBeLessThan(barPx)
  })

  describe('usage strip', () => {
    const withMin: GameRow[] = games.map((g, i) => ({ ...g, minutes: [36, 30, 18][i] }))
    const min = usageFor('nba', 'player', 'points')

    it('draws one usage bar per main bar, in the same order', () => {
      render(<GameLogChart games={withMin} def={def} line={25} usage={min} />)
      const bars = screen.getAllByTestId('chart-bar')
      const usage = screen.getAllByTestId('usage-bar')
      expect(usage).toHaveLength(bars.length)
      expect(usage.map((b) => b.getAttribute('data-value'))).toEqual(['18', '30', '36'])
    })

    it('labels the strip with the metric and its average', () => {
      render(<GameLogChart games={withMin} def={def} line={25} usage={min} />)
      expect(screen.getByText('MINUTES · AVG 28.0')).toBeInTheDocument()
      expect(screen.getAllByTestId('usage-value').map((v) => v.textContent)).toEqual([
        '18',
        '30',
        '36',
      ])
    })

    it('keeps the usage strip shorter than the main chart', () => {
      render(<GameLogChart games={withMin} def={def} line={25} usage={min} />)
      const tallMain = Math.max(
        ...screen.getAllByTestId('chart-bar').map((b) => parseFloat(b.style.height))
      )
      const tallUsage = Math.max(
        ...screen.getAllByTestId('usage-bar').map((b) => parseFloat(b.style.height))
      )
      expect(tallUsage).toBeLessThan(tallMain)
    })

    it('omits the strip without a metric or without usage data', () => {
      const { unmount } = render(<GameLogChart games={withMin} def={def} line={25} />)
      expect(screen.queryByTestId('usage-strip')).not.toBeInTheDocument()
      unmount()
      render(<GameLogChart games={games} def={def} line={25} usage={min} />)
      expect(screen.queryByTestId('usage-strip')).not.toBeInTheDocument()
    })
  })
})
