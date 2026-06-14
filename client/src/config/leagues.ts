import {
  performanceApi,
  mlbPerformanceApi,
  PerformanceApi,
} from '@/services/api'

// Shared frontend league registry. Single source of truth for which leagues
// exist, how to reach their data, and their sport-specific streak stats. The
// Track page consumes this to drive its league toggle; NBA/MLB pages can adopt
// it incrementally. Adding NHL/NFL later = flip `available` and supply a
// perfApi + streakStats.

export type LeagueSlug = 'nba' | 'mlb' | 'nhl' | 'nfl'

export interface StreakStat {
  /** Must match the backend `row.stat` key (e.g. 'pts', 'hits'). */
  key: string
  label: string
}

export interface LeagueDef {
  slug: LeagueSlug
  label: string
  /** false → render a "coming soon" state instead of data. */
  available: boolean
  perfApi?: PerformanceApi
  /**
   * Streak stats for this league. Doubles as (a) the stat-filter chips on the
   * Track streaks table and (b) the list of stats StreakPerformanceCard queries
   * for tier aggregation. Keys must match backend `row.stat`.
   */
  streakStats?: StreakStat[]
}

export const LEAGUES: LeagueDef[] = [
  {
    slug: 'nba',
    label: 'NBA',
    available: true,
    perfApi: performanceApi,
    streakStats: [
      { key: 'pts', label: 'PTS' },
      { key: 'reb', label: 'REB' },
      { key: 'ast', label: 'AST' },
      { key: 'fg3m', label: '3PM' },
    ],
  },
  {
    slug: 'mlb',
    label: 'MLB',
    available: true,
    perfApi: mlbPerformanceApi,
    // HR omitted — a 7+/10-game HR streak effectively never happens.
    streakStats: [
      { key: 'hits', label: 'H' },
      { key: 'tb', label: 'TB' },
      { key: 'rbi', label: 'RBI' },
    ],
  },
  { slug: 'nhl', label: 'NHL', available: false },
  { slug: 'nfl', label: 'NFL', available: false },
]

export function getLeague(slug: LeagueSlug): LeagueDef {
  return LEAGUES.find((l) => l.slug === slug) ?? LEAGUES[0]
}
