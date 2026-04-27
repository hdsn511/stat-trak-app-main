const BASE = 'http://localhost:3000/api'

export interface TrendingPlayer {
  playerId: number
  playerName: string
  team: string
  position: string
  stat: string
  statId: number
  zScore: number
  rollingAvg: number
  windowSize: number
  seasonAvg?: number
}

export interface PlayerSearchResult {
  id: number
  name: string
  team: string
  position: string
}

export interface GameStat {
  gameId: number
  date: string
  opponent?: string
  points: number
  rebounds: number
  assists: number
  threes: number
  fouls: number
  minutes: number
}

export interface PlayerProfile {
  player: PlayerSearchResult
  teamId?: number | null
  games: GameStat[]
  zScores: Record<string, number>
  rollingAvgs: Record<string, number>
}

export interface TodaysGame {
  gameId: string
  dbId?: number | null
  time: string
  status: string
  home: { team: string; score: string }
  away: { team: string; score: string }
}

export interface Pick {
  pickId: number
  playerId: number
  playerName: string
  team: string
  position: string
  stat: string
  statLabel: string       // "PTS" | "REB" | "AST" | "3PM"
  pickType: 'safe' | 'value'
  recommendedLine: number
  confidence: number      // 0-100
  edge: number            // e.g. 0.12 = 12% edge over market
  hitRate: number         // historical hit rate e.g. 0.87
  impliedProb: number     // Kalshi market implied prob e.g. 0.71
  sampleSize: number
  conditionsMatched: number
  totalConditions: number
}

export interface TodaysPicks {
  gameDate: string | null
  topPick: Pick | null
  allPicks: Pick[]
}

export interface TopPickPlayer {
  player_id: number
  player_name: string | null
  team: string | null
  position: string | null
  stat: string
  stat_label: string
  pick_type: 'safe' | 'value'
  line: number
  direction: 'over' | 'under'
  hit_rate: number
  confidence: number
  edge: number
  sample_size: number
  implied_prob: number
  opponent: { team: string | null; team_name: string | null } | null
}

export interface TopPickGame {
  game_id: number
  prop_type: 'winner' | 'spread' | 'total'
  home_team: string | null
  away_team: string | null
  pick_type: 'safe' | 'value'
  line: number | null
  hit_rate: number
  confidence: number
  edge: number
  implied_prob: number | null
  featured: 'ml' | 'spread' | 'total' | null
}

export interface TopPicksResponse {
  game_date: string
  player: TopPickPlayer[]
  game: TopPickGame[]
}

export interface PlayerStreakRow {
  player_id: number
  player_name: string
  team: string
  position: string
  season_avg: number
  rolling_avg: number
  streak_count: number
  opponent: { team: string; league_rank: number | null } | null
  todays_line: number
  todays_implied_prob: number
}

export interface GameStreakRow {
  team_id: number
  team_abbr: string | null
  team_name: string | null
  streak_count: number
  opponent: { team: string; team_name: string } | null
}

export interface PerfectStreaksResponse<T> {
  stat: string
  window: number
  rows: T[]
}

export interface GameDetail {
  game: {
    id: number
    game_date: string
    home_team: { id: number; abbreviation: string; name: string }
    away_team: { id: number; abbreviation: string; name: string }
    home_score: number | null
    away_score: number | null
    is_completed: boolean
  }
  player_stats: Array<{
    player_id: number
    team_id: number
    game_date: string
    points: number
    rebounds: number
    assists: number
    three_points_made: number
    minutes: number
    players: { name: string; team: string; position: string } | null
  }>
  props: Array<{
    market_ticker: string
    line: number | null
    implied_prob: number | null
    prop_type: string
    entity_id: number | null
    team_id: number | null
    source: string | null
    stat: string | null
    player_name: string | null
  }>
  picks: Array<{
    entity_id: number
    stat: string
    recommended_line: number
    hit_rate: number
    confidence_score: number
    implied_prob: number | null
    edge: number
    actual_result: number | null
    did_hit: boolean | null
    prop_type: string
    player_name: string | null
  }>
}

export interface TeamGameEntry {
  id: number
  game_date: string
  home_team: { id: number; abbreviation: string; name: string }
  away_team: { id: number; abbreviation: string; name: string }
  home_score: number | null
  away_score: number | null
  is_home: boolean
  team_score: number | null
  opp_score: number | null
  result: 'W' | 'L' | null
}

export interface TeamDetail {
  team: { id: number; abbreviation: string; name: string }
  games: TeamGameEntry[]
  roster: Array<{ id: number; name: string; position: string }>
  record: {
    overall: { w: number; l: number }
    home:    { w: number; l: number }
    away:    { w: number; l: number }
    last10:  { w: number; l: number }
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Request failed')
  return json.data as T
}

export const nbaApi = {
  getTopTrending: (): Promise<TrendingPlayer[]> =>
    get(`${BASE}/nba/trends/top`),

  getTrends: (params: { stat?: string; window?: number; threshold?: number }): Promise<TrendingPlayer[]> => {
    const q = new URLSearchParams()
    if (params.stat) q.set('stat', params.stat)
    if (params.window) q.set('window', String(params.window))
    if (params.threshold !== undefined && params.threshold > 0) q.set('threshold', String(params.threshold))
    return get(`${BASE}/nba/trends?${q}`)
  },

  searchPlayers: (query: string): Promise<PlayerSearchResult[]> =>
    get(`${BASE}/nba/players/search?q=${encodeURIComponent(query)}`),

  getPlayerProfile: (id: number): Promise<PlayerProfile> =>
    get(`${BASE}/nba/players/${id}/games`),

  getTodaysGames: (): Promise<TodaysGame[]> =>
    get(`${BASE}/nba/games/today`),

  getTodaysPicks: (): Promise<TodaysPicks> =>
    get(`${BASE}/nba/picks/today`),

  getPlayerPicks: (playerId: number): Promise<Pick[]> =>
    get(`${BASE}/nba/picks/player/${playerId}`),

  getTopPicks: (limit: number = 5): Promise<TopPicksResponse> =>
    get(`${BASE}/nba/picks/top?limit=${limit}`),

  getPlayerStreaks: (
    stat: 'pts' | 'reb' | 'ast' | 'fg3m',
    window: 3 | 5 | 10
  ): Promise<PerfectStreaksResponse<PlayerStreakRow>> =>
    get(`${BASE}/nba/streaks/perfect?type=player&stat=${stat}&window=${window}`),

  getGameStreaks: (
    stat: 'cover_spread' | 'over_total' | 'winner',
    window: 3 | 5 | 10
  ): Promise<PerfectStreaksResponse<GameStreakRow>> =>
    get(`${BASE}/nba/streaks/perfect?type=game&stat=${stat}&window=${window}`),

  getGame: (id: number): Promise<GameDetail> =>
    get(`${BASE}/nba/games/${id}`),

  getTeam: (id: number): Promise<TeamDetail> =>
    get(`${BASE}/nba/teams/${id}`),
}
