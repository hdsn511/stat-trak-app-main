import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MatchupPanel from './MatchupPanel'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { MatchupTarget, Signal, Split } from '../derive'

const cfg = getPlayerStatConfig('nba')
const statDefs = cfg.statsFor('player')
const volumeDef = cfg.volumeFor('player')

const splits: Split[] = [
  { key: 'points', label: 'PTS', season: 25, versus: 31.7, delta: 6.7 },
  { key: 'rebounds', label: 'REB', season: 5.6, versus: 4, delta: -1.6 },
]
const signal: Signal = {
  rank: 28,
  allowed: 26.4,
  positionGroup: 'G',
  bucket: 'GREAT',
  asOf: '2026-06-15',
}
const scheduleTarget: MatchupTarget = {
  team: 'BOS',
  source: 'schedule',
  upcoming: {
    gameId: 1,
    date: '2026-08-02',
    opponent: 'BOS',
    opponentTeamId: 5,
    isHome: true,
    daysRest: 2,
  },
}
const filterTarget: MatchupTarget = { team: 'MIA', source: 'filter', upcoming: null }

const base = { splits, signal, h2h: [], statDefs, volumeDef }

describe('MatchupPanel', () => {
  it('prompts for an opponent when there is no target', () => {
    render(<MatchupPanel {...base} target={null} />)
    expect(screen.getByText(/SELECT AN OPPONENT/)).toBeInTheDocument()
  })

  it('labels a scheduled matchup as the next game with its date', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText(/NEXT: VS BOS/)).toBeInTheDocument()
    expect(screen.getByText(/2026-08-02/)).toBeInTheDocument()
  })

  it('labels a filter-driven matchup differently from a scheduled one', () => {
    render(<MatchupPanel {...base} target={filterTarget} />)
    expect(screen.getByText(/MATCHUP: VS MIA/)).toBeInTheDocument()
    expect(screen.queryByText(/NEXT:/)).not.toBeInTheDocument()
  })

  it('shows season and versus averages as separate figures', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText('25.0')).toBeInTheDocument()
    expect(screen.getByText('31.7')).toBeInTheDocument()
  })

  it('signs the delta in both directions', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText('+6.7')).toBeInTheDocument()
    expect(screen.getByText('-1.6')).toBeInTheDocument()
  })

  it('shows the number behind the signal, never a bare grade', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText('GREAT')).toBeInTheDocument()
    expect(screen.getByText(/28TH/)).toBeInTheDocument()
    expect(screen.getByText(/26\.4 ALLOWED PER GAME/)).toBeInTheDocument()
  })

  it('omits the signal when defense data is missing', () => {
    render(<MatchupPanel {...base} signal={null} target={scheduleTarget} />)
    expect(screen.queryByText('GREAT')).not.toBeInTheDocument()
    // The rest of the panel still renders.
    expect(screen.getByText('31.7')).toBeInTheDocument()
  })

  it('reports no meetings rather than an empty table', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText(/NO MEETINGS/)).toBeInTheDocument()
  })

  it('flags a thin head-to-head sample', () => {
    const h2h = [{ date: '2026-04-10', opponent: 'BOS', points: 30 }]
    render(<MatchupPanel {...base} h2h={h2h} target={scheduleTarget} />)
    expect(screen.getByText(/SMALL SAMPLE/)).toBeInTheDocument()
  })

  it('does not flag a healthy head-to-head sample', () => {
    const h2h = [
      { date: '2026-04-10', opponent: 'BOS', points: 30 },
      { date: '2026-04-06', opponent: 'BOS', points: 25 },
      { date: '2026-04-02', opponent: 'BOS', points: 40 },
    ]
    render(<MatchupPanel {...base} h2h={h2h} target={scheduleTarget} />)
    expect(screen.queryByText(/SMALL SAMPLE/)).not.toBeInTheDocument()
  })
})
