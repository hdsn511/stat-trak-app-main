import type { DefenseSplit, PlayerLogResponse } from '@/ember/player/types'

// Relative by default so the deployed SPA calls its own origin, where a
// Cloudflare Pages Function proxies /api/* to the API. In dev, Vite's proxy
// (vite.config.ts) forwards the same relative path to localhost:3000.
const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

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
  seasonAvg?: number | null
  /**
   * Driver chips explaining WHY the player is trending — derived from
   * daily_conditions (usage spike, minutes bump, pace) + player_availability
   * (teammate out → injury boost). Empty array when no drivers fire.
   */
  trendDrivers?: string[]
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
  seasonAvgs: Record<string, number>
  gamesPlayed: number
}

// MLB per-game batting line. Distinct from the NBA-shaped GameStat above —
// the /api/mlb/players/:id/games endpoint returns these columns.
export interface MLBGameStat {
  gameId: number
  date: string
  opponent?: string
  isHome?: boolean
  // Batting line (present for position players).
  hits?: number
  totalBases?: number
  rbi?: number
  runs?: number
  homeRuns?: number
  strikeouts?: number
  plateAppearances?: number
  // Pitching line (present when the player is a pitcher).
  strikeoutsPitched?: number
  outsPitched?: number
  earnedRuns?: number
  hitsAllowed?: number
  walksAllowed?: number
  homeRunsAllowed?: number
  battersFaced?: number
}

export interface MLBPlayerProfile {
  player: PlayerSearchResult
  teamId?: number | null
  /** True when the player is a pitcher — games carry the pitching line. */
  isPitcher?: boolean
  games: MLBGameStat[]
  zScores: Record<string, number>
  rollingAvgs: Record<string, number>
  seasonAvgs: Record<string, number>
  gamesPlayed: number
}

export interface TodaysGame {
  gameId: string
  dbId?: number | null
  /**
   * The slate's actual date. Usually today, but the server falls back to the
   * next scheduled date on an off day — so callers must label it rather than
   * assume "tonight".
   */
  date?: string
  time: string | null
  status: string
  live?: boolean
  home: { team: string; score: string }
  away: { team: string; score: string }
}

export interface Pick {
  pickId: number
  date: string            // YYYY-MM-DD game date
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
  did_hit: boolean | null
  actual_result: number | null
}

export interface TopPickGame {
  game_id: number
  prop_type: 'winner' | 'spread' | 'total'
  home_team: string | null
  away_team: string | null
  pick_type: 'safe' | 'value'
  line: number | null
  spread_team: string | null
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

export interface PotdConditionBreakdown {
  usg_pct: 'active' | 'dropped'
  pace: 'active' | 'dropped'
  home_away: 'active' | 'dropped'
  matchup_rank: 'active' | 'dropped'
  rest: 'active' | 'dropped'
}

export interface PotdResponse {
  game_date: string
  prop_type: 'player' | 'winner' | 'spread' | 'total'
  player_id: number | null
  player_name: string | null
  team: string | null
  position: string | null
  opponent: { team: string | null; team_name: string | null } | null
  stat: string | null
  stat_label: string | null
  line: number
  direction: 'over' | 'under'
  hit_rate: number
  confidence: number
  edge: number
  implied_prob: number
  sample_size: number
  conditions_matched: number
  total_conditions: number
  condition_breakdown: PotdConditionBreakdown | null
  bullets: [string, string, string]
}

export interface PlayerStreakRow {
  player_id: number
  player_name: string
  team: string
  position: string
  /**
   * Tiered Kalshi-style lines computed from the player's last 10 game values
   * sorted ascending: line_100 = v0 (10/10 cleared), line_90 = v1 (9/10), etc.
   * All lines snapped down to the nearest 0.5.
   */
  line_100: number
  line_90: number
  line_80: number
  line_70: number
  /** MLB: current active streak (consecutive games with 1+ of the stat), uncapped. */
  streak_count?: number
  /** MLB: the streak's guaranteed level — min stat value across the run (1+, 2+, …). */
  streak_line?: number
  /** MLB: opposing-starter matchup flag (good = weak arm, tough = ace). */
  matchup?: { tier: 'good' | 'tough'; label: string } | null
  rolling_avg: number       // average over the 10-game window
  games_used: number        // NBA: always 10; MLB: games available in window
  /** For MLB, league_rank is the opposing starter's quality_rank (1=best). */
  opponent: { team: string; league_rank: number | null } | null
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

/** One column of a league's box score, as declared by the server registry. */
export interface BoxColumn {
  key: string
  label: string
  /** Seconds rendered as m:ss (NHL time on ice). */
  format?: 'mmss'
}

export interface BoxRow {
  player_id: number
  team_id: number
  name: string | null
  position: string | null
  values: Record<string, number | null>
}

/**
 * A box score section. Leagues declare their own: NBA has one, MLB splits
 * batting from pitching, NFL splits five ways. Groups with no qualifying
 * players are omitted by the server.
 */
export interface BoxGroup {
  id: string
  label: string
  columns: BoxColumn[]
  rows: BoxRow[]
}

export interface PreviewPlayer {
  player_id: number
  name: string
  position: string
  /** Averages vs this opponent when h2h games exist, else season averages. */
  values: Record<string, number | null>
  season_values: Record<string, number | null>
  vs_opp_games: number
  games_played: number
}

export interface GamePreview {
  label: string
  columns: BoxColumn[]
  home: PreviewPlayer[]
  away: PreviewPlayer[]
  /** e.g. "vs opp avg (3G)" or "season avg" — describes what `values` holds. */
  stat_context: string
}

export interface GameInjury {
  player_id: number
  status: 'out' | 'gtd' | 'questionable'
  name: string | null
  team: string | null
  position: string | null
}

export interface GameH2HEntry {
  game_id: number
  game_date: string
  home_team: { id: number; abbreviation: string; name: string }
  away_team: { id: number; abbreviation: string; name: string }
  home_score: number
  away_score: number
  winner_team_id: number
}

export interface TeamRef {
  id: number
  abbreviation: string
  name: string
}

export interface GameProp {
  market_ticker: string
  line: number | null
  implied_prob: number | null
  prop_type: string
  entity_id: number | null
  team_id: number | null
  stat: string | null
  player_name: string | null
}

export interface GamePick {
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
}

export interface GameDetail {
  league: string
  game: {
    id: number
    game_date: string
    game_time: string | null
    game_type: string | null
    home_team: TeamRef
    away_team: TeamRef
    home_score: number | null
    away_score: number | null
    is_completed: boolean
  }
  box_score: { available: boolean; groups: BoxGroup[] }
  props: GameProp[]
  picks: GamePick[]
  /** False for NHL and NFL, which have no lines or picks pipeline. */
  has_markets: boolean
  injury_report: GameInjury[]
  head_to_head: GameH2HEntry[]
  rest: { home_days: number | null; away_days: number | null }
  /** Null once the game is complete — the box score replaces it. */
  preview: GamePreview | null
}

export interface TeamGameEntry {
  id: number
  game_date: string
  game_time: string | null
  home_team: TeamRef
  away_team: TeamRef
  home_score: number | null
  away_score: number | null
  is_home: boolean
  team_score: number | null
  opp_score: number | null
  /** Null for games not yet played. Ties happen in the NFL. */
  result: 'W' | 'L' | 'T' | null
}

/** Wins, losses and — where the sport allows them — ties. */
export interface TeamRecord {
  w: number
  l: number
  t: number
}

export interface TeamDetail {
  league: string
  team: { id: number; abbreviation: string; name: string; city: string | null }
  games: TeamGameEntry[]
  roster: Array<{ id: number; name: string; position: string }>
  record: {
    overall: TeamRecord
    home: TeamRecord
    away: TeamRecord
    last10: TeamRecord
  }
}

export interface Standing {
  team_id: number
  abbreviation: string
  name: string
  w: number
  l: number
  t: number
  /** Overtime/shootout losses. Zero for leagues that don't have them. */
  otl: number
  pct: number
  last10: { w: number; l: number; t: number }
  /** Signed run of identical results: 3 for W3, -2 for L2, 0 for none. */
  streak: number
  /** Null when derived from games — that path has no conference data. */
  conference: string | null
  division: string | null
}

export interface StandingsResponse {
  league: string
  /**
   * 'table' = the analytics pipeline's precomputed standings (has conference
   * and division). 'derived' = computed from the games table on the fly.
   */
  source: 'table' | 'derived'
  season_start: string
  standings: Standing[]
}

// ── Cross-league search ────────────────────────────────────────────────────

export interface PlayerHit {
  kind: 'player'
  id: number
  name: string
  team: string | null
  position: string | null
  league: string
}

export interface TeamHit {
  kind: 'team'
  id: number
  name: string
  abbreviation: string | null
  city: string | null
  league: string
}

export interface SearchResults {
  players: PlayerHit[]
  teams: TeamHit[]
}

// ── Performance tracking ───────────────────────────────────────────────────

export interface BucketStats {
  bucket: number
  label: string
  total: number
  settled: number
  hits: number
  misses: number
  pending: number
  hitRate: number | null
  expectedRate: number
  edgeVsMarket: number | null
}

export interface PickOutcome {
  id: number
  game_date: string
  player_id: number | null
  player_name: string | null
  team: string | null
  stat: string | null
  stat_label: string | null
  prop_type: string
  pick_type: string
  line: number | null
  implied_prob: number | null
  hit_rate: number | null
  edge: number | null
  confidence: number | null
  did_hit: boolean | null
  actual_result: number | null
  bucket: number
  is_potd: boolean
}

export interface SegmentStats {
  total: number
  settled: number
  hits: number
  misses: number
  pending: number
  hitRate: number | null
}

export interface PerformanceSummary {
  period: { days: number; from: string; to: string }
  overall: SegmentStats
  buckets: BucketStats[]
  playerProps: SegmentStats
  gameProps: SegmentStats
  potd: SegmentStats
  recentPicks: PickOutcome[]
}

export interface StreakOutcomeRow {
  player_id: number
  player_name: string | null
  team: string | null
  stat: string
  stat_label: string
  game_date: string
  line_100: number
  line_90: number
  line_80: number
  line_70: number
  actual: number | null
  hit_100: boolean | null
  hit_90: boolean | null
  hit_80: boolean | null
  hit_70: boolean | null
  /** true=hit 10/10, false=missed 10/10, null=pending */
  did_hit: boolean | null
}

export interface StreakOutcomeSummary {
  period: { days: number; from: string; to: string }
  rows: StreakOutcomeRow[]
}

export interface StreakTierStats {
  tier: '10/10' | '9/10' | '8/10' | '7/10'
  hits: number
  misses: number
  total: number
  hitRate: number | null
}

export interface StreakPerformanceSummary {
  period: { days: number; from: string; to: string }
  stat: string
  tiers: StreakTierStats[]
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Request failed')
  return json.data as T
}

// Per-league API client factory. Every endpoint is mounted at /api/{league}/*
// on the server, so the same method set works for any sport.
export function createLeagueApi(slug: string) {
  return {
    slug,

    getTopTrending: (): Promise<TrendingPlayer[]> =>
      get(`${BASE}/${slug}/trends/top`),

    getTrends: (params: { stat?: string; window?: number; threshold?: number }): Promise<TrendingPlayer[]> => {
      const q = new URLSearchParams()
      if (params.stat) q.set('stat', params.stat)
      if (params.window) q.set('window', String(params.window))
      if (params.threshold !== undefined && params.threshold > 0) q.set('threshold', String(params.threshold))
      return get(`${BASE}/${slug}/trends?${q}`)
    },

    searchPlayers: (query: string): Promise<PlayerSearchResult[]> =>
      get(`${BASE}/${slug}/players/search?q=${encodeURIComponent(query)}`),

    getPlayerProfile: (id: number): Promise<PlayerProfile> =>
      get(`${BASE}/${slug}/players/${id}/games`),

    /** Full season game log plus the next scheduled game. */
    getPlayerLog: (id: number, window: 'all' | number = 'all'): Promise<PlayerLogResponse> =>
      get(`${BASE}/${slug}/players/${id}/games?window=${window}`),

    /** Opponent defensive split; null for leagues with no defense table. */
    getTeamDefense: (
      teamId: number,
      stat: string,
      position?: string | null
    ): Promise<DefenseSplit | null> => {
      const q = new URLSearchParams({ stat })
      if (position) q.set('position', position)
      return get(`${BASE}/${slug}/teams/${teamId}/defense?${q}`)
    },

    getTodaysGames: (): Promise<TodaysGame[]> =>
      get(`${BASE}/${slug}/games/today`),

    getTodaysPicks: (): Promise<TodaysPicks> =>
      get(`${BASE}/${slug}/picks/today`),

    getPlayerPicks: (playerId: number): Promise<Pick[]> =>
      get(`${BASE}/${slug}/picks/player/${playerId}`),

    getTopPicks: (limit: number = 5): Promise<TopPicksResponse> =>
      get(`${BASE}/${slug}/picks/top?limit=${limit}`),

    getPotd: (): Promise<PotdResponse | null> =>
      get(`${BASE}/${slug}/picks/potd`),

    getPlayerStreaks: (
      stat: string
    ): Promise<PerfectStreaksResponse<PlayerStreakRow>> =>
      get(`${BASE}/${slug}/streaks/perfect?type=player&stat=${stat}`),

    getGameStreaks: (
      stat: 'cover_spread' | 'over_total' | 'winner',
      window: 3 | 5 | 10
    ): Promise<PerfectStreaksResponse<GameStreakRow>> =>
      get(`${BASE}/${slug}/streaks/perfect?type=game&stat=${stat}&window=${window}`),

    getGame: (id: number): Promise<GameDetail> =>
      get(`${BASE}/${slug}/games/${id}`),

    getTeam: (id: number): Promise<TeamDetail> =>
      get(`${BASE}/${slug}/teams/${id}`),

    getStandings: (): Promise<StandingsResponse> =>
      get(`${BASE}/${slug}/standings`),
  }
}

export type LeagueApi = ReturnType<typeof createLeagueApi>

export const nbaApi = createLeagueApi('nba')
export const mlbApi = createLeagueApi('mlb')

// MLB player profile, typed to the baseball game shape. The generic factory's
// getPlayerProfile is typed to the NBA GameStat; the MLB player view needs the
// batting columns, so it has its own typed getter against the same endpoint.
export const getMLBPlayerProfile = (id: number): Promise<MLBPlayerProfile> =>
  get(`${BASE}/mlb/players/${id}/games`)

// Performance API. NBA keeps the legacy /api/performance prefix; other leagues
// use /api/{league}/performance.
function createPerformanceApi(prefix: string) {
  return {
    getSummary: (days: number = 30): Promise<PerformanceSummary> =>
      get(`${BASE}/${prefix}/summary?days=${days}`),

    getStreakPerformance: (days: number, stat: string): Promise<StreakPerformanceSummary> =>
      get(`${BASE}/${prefix}/streaks?days=${days}&stat=${stat}`),

    getStreakOutcomes: (days: number): Promise<StreakOutcomeSummary> =>
      get(`${BASE}/${prefix}/streak-outcomes?days=${days}`),
  }
}

export type PerformanceApi = ReturnType<typeof createPerformanceApi>
export const performanceApi = createPerformanceApi('performance')
export const mlbPerformanceApi = createPerformanceApi('mlb/performance')

/**
 * Cross-league entity search for the nav bar. Not part of the per-league
 * factory: one call covers every sport and each hit reports its own league.
 */
export function searchEntities(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {}
): Promise<SearchResults> {
  const q = new URLSearchParams({ q: query })
  if (opts.limit) q.set('limit', String(opts.limit))
  return getSignal(`${BASE}/search?${q}`, opts.signal)
}

async function getSignal<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Request failed')
  return json.data as T
}
