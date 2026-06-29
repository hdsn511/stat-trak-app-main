import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MLBPlayerView from './MLBPlayerView'

vi.mock('@/services/api', () => ({
  getMLBPlayerProfile: vi.fn(),
  mlbApi: { getPlayerPicks: vi.fn() },
}))

import { getMLBPlayerProfile, mlbApi } from '@/services/api'

const hitterProfile = {
  player: { id: 7, name: 'Juan Soto', team: 'NYY', position: 'RF' },
  teamId: 10,
  games: [
    { gameId: 1, date: '2026-06-10', opponent: 'SEA', isHome: true,  hits: 2, totalBases: 3, rbi: 1, runs: 1, homeRuns: 0, strikeouts: 1, plateAppearances: 4 },
    // A DNP (0 PA) — must be excluded from the chart, never rendered as a "0".
    { gameId: 2, date: '2026-06-11', opponent: 'SEA', isHome: true,  hits: 0, totalBases: 0, rbi: 0, runs: 0, homeRuns: 0, strikeouts: 0, plateAppearances: 0 },
    { gameId: 3, date: '2026-06-13', opponent: 'TB',  isHome: false, hits: 3, totalBases: 5, rbi: 2, runs: 2, homeRuns: 1, strikeouts: 0, plateAppearances: 5 },
  ],
  zScores: { hits: 1.2, total_bases: 0.8, rbi: 0.3, runs: 0.5, home_runs: 0.9 },
  rollingAvgs: { hits: 1.7, total_bases: 2.7, rbi: 1.0, runs: 1.0, home_runs: 0.3 },
  seasonAvgs: { hits: 1.1, total_bases: 1.9, rbi: 0.8, runs: 0.9, home_runs: 0.2 },
  gamesPlayed: 60,
}

const pitcherProfile = {
  player: { id: 99, name: 'Gerrit Cole', team: 'NYY', position: 'P' },
  teamId: 10,
  isPitcher: true,
  games: [
    { gameId: 11, date: '2026-06-08', opponent: 'BOS', isHome: true,  strikeoutsPitched: 8,  outsPitched: 18, earnedRuns: 2, hitsAllowed: 5, walksAllowed: 1, homeRunsAllowed: 1, battersFaced: 24 },
    { gameId: 12, date: '2026-06-13', opponent: 'TB',  isHome: false, strikeoutsPitched: 11, outsPitched: 21, earnedRuns: 1, hitsAllowed: 3, walksAllowed: 0, homeRunsAllowed: 0, battersFaced: 25 },
  ],
  zScores: {}, rollingAvgs: {},
  seasonAvgs: { strikeouts_pitched: 9.5, outs_pitched: 19.5, earned_runs: 1.5, hits_allowed: 4, walks_allowed: 0.5 },
  gamesPlayed: 14,
}

const noGamesProfile = {
  player: { id: 50, name: 'Rookie Reliever', team: 'NYY', position: 'P' },
  teamId: 10, isPitcher: true, games: [],
  zScores: {}, rollingAvgs: {}, seasonAvgs: {}, gamesPlayed: 0,
}

const hitsPick = {
  pickId: 1, playerId: 7, playerName: 'Juan Soto', team: 'NYY', position: 'RF',
  stat: 'hits', statLabel: 'H', pickType: 'value' as const, recommendedLine: 1.5,
  confidence: 78, edge: 0.12, hitRate: 0.64, impliedProb: 0.52, sampleSize: 25,
  conditionsMatched: 3, totalConditions: 5,
}

const renderAt = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/mlb/player/${id}`]}>
      <Routes>
        <Route path="/mlb/player/:id" element={<MLBPlayerView />} />
      </Routes>
    </MemoryRouter>
  )

describe('MLBPlayerView', () => {
  beforeEach(() => {
    vi.mocked(getMLBPlayerProfile).mockResolvedValue(hitterProfile)
    vi.mocked(mlbApi.getPlayerPicks).mockResolvedValue([hitsPick])
  })

  it('renders the player name after load', async () => {
    renderAt('7')
    expect(await screen.findByText('Juan Soto')).toBeInTheDocument()
  })

  it('renders the MLB batting stat tabs', async () => {
    renderAt('7')
    await screen.findByText('Juan Soto')
    // Labels appear in both the tab bar and the season strip, so allow duplicates.
    for (const label of ['TB', 'RBI', 'HR']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('surfaces the actionable bet verdict from today’s pick', async () => {
    renderAt('7')
    expect(await screen.findByText(/BET OVER/)).toBeInTheDocument()
    expect(screen.getAllByText('+12%').length).toBeGreaterThan(0)
  })

  it('charts pitching stats (K tab) for a pitcher', async () => {
    vi.mocked(getMLBPlayerProfile).mockResolvedValue(pitcherProfile)
    vi.mocked(mlbApi.getPlayerPicks).mockResolvedValue([])
    renderAt('99')
    await screen.findByText('Gerrit Cole')
    expect(screen.getAllByText('K').length).toBeGreaterThan(0)   // strikeouts tab
    expect(screen.getAllByText('Outs').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ER').length).toBeGreaterThan(0)
  })

  it('shows an empty state when a player has no logged games', async () => {
    vi.mocked(getMLBPlayerProfile).mockResolvedValue(noGamesProfile)
    vi.mocked(mlbApi.getPlayerPicks).mockResolvedValue([])
    renderAt('50')
    expect(await screen.findByText(/No games logged yet/)).toBeInTheDocument()
  })
})
