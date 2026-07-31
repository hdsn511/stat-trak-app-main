/** One row from GET /api/{league}/players/{id}/games. Shape varies by league. */
export type GameRow = Record<string, string | number | boolean | null | undefined>

export interface UpcomingGame {
  gameId: number
  date: string
  opponent: string
  opponentTeamId: number
  isHome: boolean
  daysRest: number | null
}

export interface DefenseSplit {
  allowedPerGame: number
  leagueRank: number | null
  positionGroup: string | null
  stat: string
  asOf: string
}

export interface PlayerLogResponse {
  player: { id: number; name: string; team: string; position: string | null }
  teamId: number | null
  games: GameRow[]
  seasonAvgs: Record<string, number>
  gamesPlayed: number
  upcoming: UpcomingGame | null
}

export type HomeAway = 'all' | 'home' | 'away'

export interface PlayerFilters {
  /** Game count; 0 means the whole season. */
  window: number
  /** Opponent abbreviation, or null for all teams. */
  vsTeam: string | null
  homeAway: HomeAway
  /** Stat key from the league config. */
  stat: string
  line: number
  /** True once the user has moved the line off the computed average. */
  lineTouched: boolean
}
