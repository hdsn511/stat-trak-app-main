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
  /** players.ext_id, for the headshot. */
  extId?: string | null
  /** The Kalshi rung nearest the recent average (null: no ladder for this stat). */
  suggested?: KalshiSuggestion | null
  /** Kalshi YES price for the suggested rung, 0-1 (null until listed). */
  price?: number | null
  opponent?: string | null
  matchup?: Matchup | null
  /**
   * Driver chips explaining WHY the player is trending — derived from
   * daily_conditions (usage spike, minutes bump, pace) + player_availability
   * (teammate out → injury boost). Empty array when no drivers fire.
   */
  trendDrivers?: string[]
  /** Quantified drill-down behind each driver chip. */
  trendDriverDetails?: { label: string; summary: string; lines: string[] }[]
}

/** How much an opponent allows in a stat vs the league (factor 1.07 = 7% more; rank 1 = most). */
export interface Matchup {
  factor: number
  rank: number
  of: number
}

/** One Streak Watch row: a run at a Kalshi rung (server/src/services/nbaWatch.ts). */
export interface StreakWatchRow {
  player_id: number
  name: string
  team: string
  ext_id: string | null
  opponent: string | null
  stat: string
  rung: number
  depth: number
  margin: number
  l10_avg: number
  /** Last 10 values, oldest first. */
  last10: number[]
  price: number | null
  matchup: Matchup | null
}

/** A Kalshi "X+" market: rung 10 = over 9.5. */
export interface KalshiSuggestion {
  rung: number
  line: number
  side: 'over'
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
  threesAttempted?: number | null
  fgm?: number | null
  fga?: number | null
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
  home: { team: string; score: string; form?: TeamFormSummary | null }
  away: { team: string; score: string; form?: TeamFormSummary | null }
}

/** Season form for a team on the slate, from final games this season. */
export interface TeamFormSummary {
  record: string
  ppg: number | null
  oppg: number | null
  /** Last five results, newest first, e.g. "WWLWL". */
  last5: string
  gp: number
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
  /** players.ext_id, for the headshot. */
  ext_id?: string | null
  /** The highest Kalshi rung the 10/10 floor still clears (null: none does). */
  suggested?: KalshiSuggestion | null
  /** MLB: current active streak (consecutive games with 1+ of the stat), uncapped. */
  streak_count?: number
  /** MLB: the streak's guaranteed level — min stat value across the run (1+, 2+, …). */
  streak_line?: number
  /** MLB: opposing-starter matchup flag (good = weak arm, tough = ace). */
  matchup?: { tier: 'good' | 'tough'; label: string } | null
  rolling_avg: number       // average over the 10-game window
  /** Last 10 played values, oldest first. */
  last10?: number[]
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
  /** Upcoming games: spread and winner lines (absent from older API builds). */
  props?: GameProp[]
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
  /** Season per-game averages for everyone who played for the team. */
  player_stats: {
    columns: { key: string; label: string }[]
    players: {
      id: number
      name: string
      position: string | null
      gp: number
      avgs: Record<string, number>
    }[]
  }
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

export interface ProjectPick {
  id: number
  kind: 'prop' | 'moneyline'
  entity_id: number
  name: string
  team: string | null
  stat: string | null
  stat_label: string | null
  side: 'over' | 'under' | 'win'
  line: number | null
  model_prob: number
  implied_prob: number
  edge: number
  price_source: string | null
  book_prob: number | null
  featured: boolean
  /** Where its game stands; a pick stays on a final card through tip-off. */
  status?: 'upcoming' | 'started' | 'final'
  /** Set when the pick no longer counts (e.g. 'injury' after the card locked). */
  void?: string | null
  /** Why the pick is on the card: recent form for props, the Elo check for winners. */
  context: {
    avg20?: number | null
    avg5?: number | null
    last?: number | null
    hit10?: number | null
    form_supports?: boolean
    b2b?: boolean
    elo_prob?: number | null
    elo_agrees?: boolean | null
  }
  /** players.ext_id for a prop's headshot; null for winners. */
  ext_id: string | null
  game: { id: number; date: string; time: string | null; matchup: string; away: string | null; home: string | null }
}

export interface NewsItem {
  id: string
  kind: 'trade' | 'injury'
  headline: string
  description: string | null
  published: string
  url: string | null
  /** Team abbreviations tagged on the story. */
  teams: string[]
  athlete: { name: string; headshot: string } | null
}

export interface SuggestionResult {
  player_id: number
  name: string
  team: string | null
  ext_id: string | null
  stat: string
  stat_label: string
  rung: number
  actual: number
  did_hit: boolean
}

export interface SuggestionResultSet {
  record: { w: number; l: number }
  rows: SuggestionResult[]
}

/** Yesterday's graded Trending Players / Streak Watch suggestions. */
export interface SuggestionResults {
  date: string | null
  trending: SuggestionResultSet
  streak: SuggestionResultSet
}

export interface ProjectGame {
  game_id: number
  winner: ProjectPick | null
  props: ProjectPick[]
}

export interface UnitsRecord {
  w: number
  l: number
  units: number
}

/** A straight from a graded slate, with its result. */
export interface GradedStraight {
  id: number
  kind: 'prop' | 'moneyline'
  /** Player id for props; game id for winners. */
  entity_id: number
  name: string
  team: string | null
  ext_id: string | null
  stat_label: string | null
  side: string | null
  line: number | null
  /** YES price paid, as a probability. */
  price: number
  actual: number | null
  did_hit: boolean
  units: number
}

export interface ProjectsResponse {
  supported: boolean
  bands: { prop: { min: number; max: number }; moneyline: { min: number; max: number } }
  /** Cumulative record and net units (1u per pick at its Kalshi price) of picks that were on the card. */
  record: UnitsRecord
  /** The latest graded slate before today, for the card's dropdown. */
  yesterday: { date: string; record: UnitsRecord; rows: GradedStraight[] } | null
  props: ProjectPick[]
  moneyline: ProjectPick | null
  /**
   * NBA: the card is final an hour before the date's first tip and is served as
   * stored. Null for leagues without the lock.
   */
  card?: {
    date: string | null
    locks_at: string | null
    locked: boolean
    changes: { at: string; kind: 'out' | 'in'; reason: string | null; pick: ProjectPick }[]
  } | null
  games: ProjectGame[]
  /** Picks that swapped on/off the card today (Eastern). */
  changes?: (ProjectPick & { change: 'added' | 'removed'; at: string })[]
  upcoming_games: number
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

    getProjects: (): Promise<ProjectsResponse> =>
      get(`${BASE}/${slug}/projects`),

    getNews: (): Promise<{ items: NewsItem[] }> =>
      get(`${BASE}/${slug}/news`),

    getStreakWatch: (): Promise<{ date: string | null; rows: StreakWatchRow[] }> =>
      get(`${BASE}/${slug}/streaks/watch`),

    getSuggestionResults: (): Promise<SuggestionResults> =>
      get(`${BASE}/${slug}/suggestions/results`),
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

// ── Game insights (GET /api/{league}/games/:id/insights) ──────────────────────
// The game view's matchup panel: tale of the tape, streaks at Kalshi rungs,
// L10-vs-season trends, ESPN injuries and team news, and outdoor-NFL weather.

export interface GameTapeSide {
  value: number
  /** 1 = best in the league for this row (stingiest defense, most productive offense). */
  rank: number
  /** Team average / league average - 1. */
  vs_league: number
}

export interface GameTapeRow {
  key: string
  label: string
  better: 'higher' | 'lower'
  away: GameTapeSide | null
  home: GameTapeSide | null
}

export interface GameInsightStreak {
  player_id: number
  name: string
  team: string
  ext_id: string | null
  position: string | null
  stat: string
  stat_label: string
  rung: number
  depth: number
  games: number
  l10_avg: number
  /** Oldest first. */
  last10: number[]
  price: number | null
  /** True when Kalshi lists this rung for the game. */
  listed: boolean
  /** Opponent allows this stat vs league; rank 1 = allows the most. */
  matchup: Matchup | null
}

export interface GameInsightTrend {
  player_id: number
  name: string
  team: string
  ext_id: string | null
  position: string | null
  stat: string
  stat_label: string
  window: number
  recent_avg: number
  season_avg: number | null
  z: number
  rung: number | null
  price: number | null
  matchup: Matchup | null
}

export interface GameInsightInjury {
  name: string
  player_id: number | null
  ext_id: string | null
  position: string | null
  status: string
  status_label: string
  injury: string | null
  updated: string | null
}

export interface GameInsightNews {
  id: string
  kind: 'injury' | 'trade' | 'news'
  headline: string
  published: string
  url: string | null
}

export interface GameInsightTeam {
  team_id: number
  abbr: string
  record: { w: number; l: number; t: number } | null
  injuries: GameInsightInjury[]
  injury_source: 'espn' | 'availability' | null
  news: GameInsightNews[]
  streaks: GameInsightStreak[]
  trends: GameInsightTrend[]
}

export interface GameWeather {
  source: 'open-meteo' | 'espn'
  at: string | null
  temp_f: number | null
  wind_mph: number | null
  gust_mph: number | null
  precip_prob: number | null
  condition: string | null
  flags: { label: string; tone: 'bad' | 'warn' }[]
}

export interface GameVenue {
  name: string
  city: string | null
  state: string | null
  indoor: boolean
  roof: 'dome' | 'retractable' | 'open'
  grass: boolean | null
}

export interface GameInsights {
  league: string
  game_id: number
  season_since: string
  games_sampled: { away: number; home: number }
  team_count: number
  defense: GameTapeRow[]
  offense: GameTapeRow[]
  away: GameInsightTeam
  home: GameInsightTeam
  venue: GameVenue | null
  weather: GameWeather | null
  weather_note: string | null
}

export const getGameInsights = (league: string, id: number): Promise<GameInsights> =>
  get(`${BASE}/${league}/games/${id}/insights`)
