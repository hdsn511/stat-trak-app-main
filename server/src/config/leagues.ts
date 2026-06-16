import { Request, Response, NextFunction } from 'express';

// Per-league registry. The controllers are league-agnostic and read their
// table names / stat maps / filters from the active LeagueConfig (resolved by
// `leagueMiddleware` from the mount path). NBA values reproduce the previous
// hardcoded behavior exactly, so /api/nba/* output is unchanged.

export type LeagueSlug = 'nba' | 'mlb';

export interface LeagueConfig {
  slug: LeagueSlug;
  leagueId: number;
  playerLeagueTag: string;           // players.league value
  trendsTable: string;               // nba_trends | mlb_trends
  statsTable: string;                // nba_player_stats | mlb_player_stats
  dailyConditionsTable: string;      // daily_conditions | mlb_daily_conditions
  statLabels: Record<string, string>;        // pick stat key -> short label
  trendStatNames: Record<number, string>;    // trends stat int -> name
  validStatIds: number[];
  statConfig: Record<string, { col: string; statId: number }>;  // streaks/perf stat -> column
  streakStats: string[];             // stats iterated by streak endpoints
  streakStartDate: string;
  // Inclusion gate for the player streaks card: the index into the ascending
  // last-10 values that must be > 0. NBA=0 (cleared the floor in all 10 — works
  // for high-count stats like points). MLB=3 (cleared in >=7/10 — baseball
  // counting stats hit 0 too often for a 10/10 gate to ever populate).
  streakGateTierIndex: number;
  // Optional floor for displayed streak tier lines (MLB clamps to 0.5 so the
  // hits line reads "1+" rather than a meaningless "0+").
  streakLineFloor?: number;
  playedGate: { col: string; min: number };  // "appeared in game" filter
  // columns selected for getPlayerGames + how to shape them
  playerGameSelect: string;
}

// ── NBA (unchanged behavior) ────────────────────────────────────────────────────
const NBA: LeagueConfig = {
  slug: 'nba',
  leagueId: 1,
  playerLeagueTag: 'nba',
  trendsTable: 'nba_trends',
  statsTable: 'nba_player_stats',
  dailyConditionsTable: 'daily_conditions',
  statLabels: { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM' },
  trendStatNames: { 0: 'points', 1: 'rebounds', 2: 'assists', 3: 'threes' },
  validStatIds: [0, 1, 2, 3],
  statConfig: {
    pts:  { col: 'points',            statId: 0 },
    reb:  { col: 'rebounds',          statId: 1 },
    ast:  { col: 'assists',           statId: 2 },
    fg3m: { col: 'three_points_made', statId: 3 },
  },
  streakStats: ['pts', 'reb', 'ast', 'fg3m'],
  streakStartDate: '2026-04-28',
  streakGateTierIndex: 0,
  playedGate: { col: 'minutes_played', min: 0 },
  playerGameSelect:
    'game_id, team_id, points, rebounds, assists, three_points_made, fouls, minutes_played, game_date, games!inner(game_type)',
};

// ── MLB ─────────────────────────────────────────────────────────────────────────
const MLB: LeagueConfig = {
  slug: 'mlb',
  leagueId: 2,
  playerLeagueTag: 'mlb',
  trendsTable: 'mlb_trends',
  statsTable: 'mlb_player_stats',
  dailyConditionsTable: 'mlb_daily_conditions',
  // pick stat keys (from generate_mlb) + streak/trend stat keys
  statLabels: { hits: 'H', hr: 'HR', rbi: 'RBI', ks: 'K', tb: 'TB', runs: 'R', hrr: 'H+R+RBI' },
  trendStatNames: { 0: 'hits', 1: 'total_bases', 2: 'rbi', 3: 'runs', 4: 'home_runs' },
  validStatIds: [0, 1, 2, 3, 4],
  statConfig: {
    hits: { col: 'hits',        statId: 0 },
    tb:   { col: 'total_bases', statId: 1 },
    rbi:  { col: 'rbi',         statId: 2 },
    runs: { col: 'runs',        statId: 3 },
    hr:   { col: 'home_runs',   statId: 4 },
  },
  // HR excluded from streaks — a 7+/10-game HR streak is effectively impossible.
  streakStats: ['hits', 'tb', 'rbi'],
  streakStartDate: '2026-03-25',
  streakGateTierIndex: 3,   // gate on the 7/10 tier (baseball hits a lot of 0s)
  streakLineFloor: 0.5,     // show "1+" rather than "0+" for the hits line
  playedGate: { col: 'plate_appearances', min: 0 },
  playerGameSelect:
    'game_id, team_id, hits, total_bases, rbi, runs, home_runs, strikeouts, plate_appearances, game_date, games!inner(game_type)',
};

export const LEAGUES: Record<LeagueSlug, LeagueConfig> = { nba: NBA, mlb: MLB };

// Express middleware: attach a LeagueConfig to res.locals for the mounted prefix.
export function leagueMiddleware(slug: LeagueSlug) {
  const cfg = LEAGUES[slug];
  return (_req: Request, res: Response, next: NextFunction) => {
    res.locals.league = cfg;
    next();
  };
}

// Resolve the active league for a request, defaulting to NBA so any handler
// reached without the middleware keeps its previous behavior.
export function league(res: Response): LeagueConfig {
  return (res.locals?.league as LeagueConfig) ?? NBA;
}
