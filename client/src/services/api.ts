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
  games: GameStat[]
  zScores: Record<string, number>
  rollingAvgs: Record<string, number>
}

export interface TodaysGame {
  gameId: string
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
  topPick: Pick | null
  allPicks: Pick[]
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
}
