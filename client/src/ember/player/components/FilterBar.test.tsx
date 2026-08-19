import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterBar from './FilterBar'
import { getPlayerStatConfig, allStatsFor } from '@/config/playerStats'
import type { PlayerFilters } from '../types'

const statDefs = allStatsFor(getPlayerStatConfig('nba'), 'player')
const filters: PlayerFilters = {
  window: 10,
  vsTeam: null,
  homeAway: 'all',
  stat: 'points',
  line: 25,
  lineTouched: false,
}

const setup = (over: Partial<PlayerFilters> = {}, handlers = {}) => {
  const props = {
    filters: { ...filters, ...over },
    statDefs,
    windows: [5, 10, 20, 0],
    opponents: ['BOS', 'LAL'],
    onWindow: vi.fn(),
    onVsTeam: vi.fn(),
    onHomeAway: vi.fn(),
    onStat: vi.fn(),
    ...handlers,
  }
  render(<FilterBar {...props} />)
  return props
}

describe('FilterBar', () => {
  it('renders a button per window with ALL for 0', () => {
    setup()
    expect(screen.getByRole('button', { name: 'L5' })).toBeInTheDocument()
    // Window "ALL" and venue "ANY" must not share a label, or these queries
    // become ambiguous and throw.
    expect(screen.getByRole('button', { name: 'ALL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ANY' })).toBeInTheDocument()
  })

  it('marks the active window as pressed', () => {
    setup()
    expect(screen.getByRole('button', { name: 'L10' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'L5' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports a window change', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'L5' }))
    expect(p.onWindow).toHaveBeenCalledWith(5)
  })

  it('lists every opponent plus an all-teams option', () => {
    setup()
    const select = screen.getByLabelText('Opponent') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['', 'BOS', 'LAL'])
  })

  it('reports an opponent change as null for all teams', () => {
    const p = setup({ vsTeam: 'BOS' })
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: '' } })
    expect(p.onVsTeam).toHaveBeenCalledWith(null)
  })

  it('reports a stat change', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'REB' }))
    expect(p.onStat).toHaveBeenCalledWith('rebounds')
  })

  it('shows a removable chip for each active filter', () => {
    setup({ vsTeam: 'BOS', homeAway: 'away' })
    // Chips are queried by aria-label; their visible text collides with the
    // filter buttons above.
    expect(screen.getByRole('button', { name: 'Clear VS BOS filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear AWAY filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear LAST 10 filter' })).toBeInTheDocument()
  })

  it('clears a filter when its chip is clicked', () => {
    const p = setup({ vsTeam: 'BOS' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear VS BOS filter' }))
    expect(p.onVsTeam).toHaveBeenCalledWith(null)
  })

  it('shows no chip row when no filter is active', () => {
    setup({ window: 0 })
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument()
  })

  it('offers combo stats alongside single stats', () => {
    setup()
    expect(screen.getByRole('button', { name: 'PRA' })).toBeInTheDocument()
  })
})
