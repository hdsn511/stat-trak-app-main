// Game-page insights: everything the game view shows about the two teams in one
// game — tale of the tape (defense/offense ranks), streaks at Kalshi rungs,
// L10-vs-season trends, ESPN injuries and team news, and kickoff weather for
// outdoor NFL games.
//
// Deliberately self-contained rather than built on services/nbaWatch.ts: that
// service is NBA-shaped (one hard-coded stat map) and is being generalised
// separately. The streak rule here is the same one — the deepest run of
// consecutive games at or above a rung, weighted by how close the rung sits to
// the player's level — applied per league with its own stat map.

import { supabaseAdmin } from '../config/supabaseAdmin';
import { LeagueConfig, LeagueSlug, seasonStartFor } from '../config/leagues';
import { preseasonGameIds, watchConfig } from './nbaWatch';
import { ladder } from '../utils/kalshiLadder';

// ── shared helpers ────────────────────────────────────────────────────────────

const day = (d: string, n: number) =>
  new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const round1 = (v: number) => Math.round(v * 10) / 10;

async function paged<T>(build: (from: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

function cached<T>(store: Map<string, { at: number; value: T }>, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  return load().then((value) => {
    store.set(key, { at: Date.now(), value });
    return value;
  });
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const normName = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');

// ── per-league stat maps ──────────────────────────────────────────────────────

/** A team-level per-game metric for the tale of the tape. `col` is summed over the
 *  team's player rows; `score` reads the game score instead. */
interface TapeStat {
  key: string;
  label: string;
  col?: string;
  score?: true;
}

const TAPE: Record<LeagueSlug, TapeStat[]> = {
  nba: [
    { key: 'pts', label: 'PTS', score: true },
    { key: 'reb', label: 'REB', col: 'rebounds' },
    { key: 'ast', label: 'AST', col: 'assists' },
    { key: 'fg3m', label: '3PM', col: 'three_points_made' },
  ],
  nfl: [
    { key: 'pts', label: 'PTS', score: true },
    { key: 'payds', label: 'PASS YDS', col: 'passing_yards' },
    { key: 'patd', label: 'PASS TD', col: 'passing_tds' },
    { key: 'ruyds', label: 'RUSH YDS', col: 'rushing_yards' },
    { key: 'rec', label: 'REC', col: 'receptions' },
    { key: 'sacks', label: 'SACKS', col: 'sacks' },
    { key: 'int', label: 'INT', col: 'interceptions' },
  ],
  mlb: [
    { key: 'runs', label: 'RUNS', score: true },
    { key: 'hits', label: 'HITS', col: 'hits' },
    { key: 'hr', label: 'HR', col: 'home_runs' },
    { key: 'tb', label: 'TB', col: 'total_bases' },
    { key: 'k', label: 'K', col: 'strikeouts' },
  ],
  nhl: [
    { key: 'goals', label: 'GOALS', score: true },
    { key: 'sog', label: 'SOG', col: 'shots_on_goal' },
  ],
};

interface StreakStat {
  key: string;
  label: string;
  col: string;
  /** Games where this column is 0 don't count (QB attempts for pass yards). */
  gate?: string;
}

const STREAK: Record<LeagueSlug, StreakStat[]> = {
  nba: [
    { key: 'pts', label: 'PTS', col: 'points', gate: 'minutes_played' },
    { key: 'reb', label: 'REB', col: 'rebounds', gate: 'minutes_played' },
    { key: 'ast', label: 'AST', col: 'assists', gate: 'minutes_played' },
    { key: 'fg3m', label: '3PM', col: 'three_points_made', gate: 'minutes_played' },
  ],
  nfl: [
    { key: 'payds', label: 'PASS YDS', col: 'passing_yards', gate: 'attempts' },
    { key: 'patd', label: 'PASS TD', col: 'passing_tds', gate: 'attempts' },
    { key: 'ruyds', label: 'RUSH YDS', col: 'rushing_yards', gate: 'carries' },
    { key: 'recyds', label: 'REC YDS', col: 'receiving_yards', gate: 'targets' },
    { key: 'rec', label: 'REC', col: 'receptions', gate: 'targets' },
  ],
  mlb: [
    { key: 'hits', label: 'H', col: 'hits', gate: 'plate_appearances' },
    { key: 'tb', label: 'TB', col: 'total_bases', gate: 'plate_appearances' },
    { key: 'rbi', label: 'RBI', col: 'rbi', gate: 'plate_appearances' },
  ],
  nhl: [
    { key: 'p', label: 'PTS', col: 'points', gate: 'toi_seconds' },
    { key: 'sog', label: 'SOG', col: 'shots_on_goal', gate: 'toi_seconds' },
  ],
};

/** Rungs ("X+") to test when Kalshi has listed nothing for a player yet. NBA uses
 *  the shared ladder; the rest mirror the rungs Kalshi lists for those sports. */
const FALLBACK_LADDER: Record<string, Record<string, number[]>> = {
  nfl: {
    payds: [150, 175, 200, 225, 250, 275, 300],
    patd: [1, 2, 3],
    ruyds: [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100],
    recyds: [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100],
    rec: [2, 3, 4, 5, 6, 7, 8],
  },
  mlb: { hits: [1, 2], tb: [1, 2, 3], rbi: [1, 2] },
  nhl: { p: [1, 2], sog: [2, 3, 4, 5] },
};

function rungsFor(slug: string, stat: string): number[] {
  return ladder(slug, stat) ?? FALLBACK_LADDER[slug]?.[stat] ?? [];
}

/** Shortest run that counts as a streak: NFL seasons are short, so 4 straight weeks. */
const MIN_DEPTH: Record<LeagueSlug, number> = { nba: 5, nfl: 4, mlb: 5, nhl: 5 };
const HISTORY = 15;
const MAX_PRICE = 0.9; // a rung priced above this is a near-lock, not a pick

// ── tale of the tape ──────────────────────────────────────────────────────────

export interface TapeSide {
  value: number;
  rank: number;
  /** Team average / league average - 1 (0.07 = 7% above league). */
  vs_league: number;
}

export interface TapeRow {
  key: string;
  label: string;
  /** 'higher' when a bigger number is the better side of this row. */
  better: 'higher' | 'lower';
  away: TapeSide | null;
  home: TapeSide | null;
}

interface TeamSeason {
  games: number;
  /** Per-game averages produced by the team (offense) and allowed (defense). */
  for: Record<string, number>;
  against: Record<string, number>;
}

interface SeasonTable {
  teams: Map<number, TeamSeason>;
  league: Record<string, number>;
  /** stat key -> teamId -> rank, for defense (1 = stingiest) and offense (1 = most). */
  defRank: Record<string, Map<number, number>>;
  offRank: Record<string, Map<number, number>>;
  teamCount: number;
  since: string;
}

const seasonCache = new Map<string, { at: number; value: SeasonTable }>();

/** Per-team season averages for every tape stat and streak column, for and against. */
async function seasonTable(lg: LeagueConfig, before: string): Promise<SeasonTable> {
  const since = seasonStartFor(lg, new Date(before + 'T12:00:00Z'));
  return cached(seasonCache, `${lg.slug}:${since}:${before}`, 6 * 3600_000, async () => {
    const games = await paged<any>((from) =>
      supabaseAdmin.from('games').select('id,home_team_id,away_team_id,home_score,away_score')
        .eq('league_id', lg.leagueId).in('game_type', lg.gameTypes)
        .gte('game_date', since).lt('game_date', before).not('home_score', 'is', null)
        .order('id').range(from, from + 999));
    const cols = [...new Set([
      ...TAPE[lg.slug].filter((s) => s.col).map((s) => s.col!),
      ...Object.values(lg.statConfig).map((s) => s.col),
    ])];
    const rows = games.length
      ? await paged<any>((from) =>
          supabaseAdmin.from(lg.statsTable).select('game_id,team_id,' + cols.join(','))
            .gte('game_date', since).lt('game_date', before)
            .order('game_id').order('player_id').range(from, from + 999))
      : [];

    // per (game, team) sums of every column
    const sums = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const k = `${r.game_id}:${r.team_id}`;
      const s = sums.get(k) ?? {};
      for (const c of cols) s[c] = (s[c] ?? 0) + Number(r[c] ?? 0);
      sums.set(k, s);
    }

    const acc = new Map<number, { n: number; f: Record<string, number>; a: Record<string, number> }>();
    const add = (team: number, opp: number, gameId: number, ptsFor: number, ptsAgainst: number) => {
      const mine = sums.get(`${gameId}:${team}`);
      const theirs = sums.get(`${gameId}:${opp}`);
      if (!mine || !theirs) return; // box score not ingested: skip the game for both sides
      const t = acc.get(team) ?? { n: 0, f: {}, a: {} };
      t.n++;
      t.f.__score = (t.f.__score ?? 0) + ptsFor;
      t.a.__score = (t.a.__score ?? 0) + ptsAgainst;
      for (const c of cols) {
        t.f[c] = (t.f[c] ?? 0) + (mine[c] ?? 0);
        t.a[c] = (t.a[c] ?? 0) + (theirs[c] ?? 0);
      }
      acc.set(team, t);
    };
    for (const g of games) {
      add(g.home_team_id, g.away_team_id, g.id, Number(g.home_score), Number(g.away_score));
      add(g.away_team_id, g.home_team_id, g.id, Number(g.away_score), Number(g.home_score));
    }

    const teams = new Map<number, TeamSeason>();
    for (const [id, t] of acc) {
      const per = (o: Record<string, number>) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / t.n]));
      teams.set(id, { games: t.n, for: per(t.f), against: per(t.a) });
    }
    const keys = ['__score', ...cols];
    const league: Record<string, number> = {};
    const defRank: Record<string, Map<number, number>> = {};
    const offRank: Record<string, Map<number, number>> = {};
    for (const k of keys) {
      const list = [...teams.entries()];
      league[k] = list.length ? list.reduce((x, [, t]) => x + (t.against[k] ?? 0), 0) / list.length : 0;
      defRank[k] = new Map(
        [...list].sort((a, b) => (a[1].against[k] ?? 0) - (b[1].against[k] ?? 0)).map(([id], i) => [id, i + 1]));
      offRank[k] = new Map(
        [...list].sort((a, b) => (b[1].for[k] ?? 0) - (a[1].for[k] ?? 0)).map(([id], i) => [id, i + 1]));
    }
    return { teams, league, defRank, offRank, teamCount: teams.size, since };
  });
}

/**
 * Which way is good. For a defensive row the default is "allowing less is
 * better"; some stats are the defense's own work (an NFL sack is recorded on
 * the defender; an interception thrown or a batter's strikeout is the
 * defense's win), so more is better there.
 */
const DEFENSE_EARNED = new Set(['sacks', 'int', 'k']);
/** Stats where more is worse for the offense producing them. */
const OFFENSE_NEGATIVE = new Set(['int', 'k']);

function tapeRows(lg: LeagueConfig, table: SeasonTable, awayId: number, homeId: number, side: 'defense' | 'offense'): TapeRow[] {
  return TAPE[lg.slug]
    .filter((s) => !(side === 'offense' && s.key === 'sacks'))
    .map((s) => {
      const col = s.score ? '__score' : s.col!;
      // NFL sacks live on the defender's row, so a team's own sum is what its defense made.
      const ownDefStat = s.key === 'sacks';
      const sideOf = (teamId: number): TapeSide | null => {
        const t = table.teams.get(teamId);
        if (!t) return null;
        const value = side === 'defense' ? (ownDefStat ? t.for[col] : t.against[col]) : t.for[col];
        if (value == null) return null;
        const lgAvg = table.league[col] ?? 0;
        const rankMap = side === 'defense'
          ? (ownDefStat ? table.offRank[col] : table.defRank[col])
          : table.offRank[col];
        let rank = rankMap?.get(teamId) ?? 0;
        // Ranks read "1 = best": invert where the raw ordering points the wrong way.
        if (side === 'defense' && DEFENSE_EARNED.has(s.key) && !ownDefStat) rank = table.teamCount + 1 - rank;
        if (side === 'offense' && OFFENSE_NEGATIVE.has(s.key)) rank = table.teamCount + 1 - rank;
        return { value: round1(value), rank, vs_league: lgAvg > 0 ? Math.round((value / lgAvg - 1) * 1000) / 1000 : 0 };
      };
      const better: TapeRow['better'] =
        side === 'defense'
          ? DEFENSE_EARNED.has(s.key) ? 'higher' : 'lower'
          : OFFENSE_NEGATIVE.has(s.key) ? 'lower' : 'higher';
      return {
        key: s.key,
        label: side === 'defense' && !DEFENSE_EARNED.has(s.key) ? `${s.label} ALLOWED` : s.label,
        better,
        away: sideOf(awayId),
        home: sideOf(homeId),
      };
    });
}

// ── streaks & trends ──────────────────────────────────────────────────────────

export interface Matchup { factor: number; rank: number; of: number }

export interface GameStreak {
  player_id: number;
  name: string;
  team: string;
  ext_id: string | null;
  position: string | null;
  stat: string;
  stat_label: string;
  rung: number;
  depth: number;
  /** Games looked at (the run can't be deeper than this). */
  games: number;
  l10_avg: number;
  last10: number[];
  price: number | null;
  listed: boolean;
  matchup: Matchup | null;
}

export interface GameTrend {
  player_id: number;
  name: string;
  team: string;
  ext_id: string | null;
  position: string | null;
  stat: string;
  stat_label: string;
  window: number;
  recent_avg: number;
  season_avg: number | null;
  z: number;
  /** Nearest Kalshi rung to the recent average, with its price when listed. */
  rung: number | null;
  price: number | null;
  matchup: Matchup | null;
}

interface Rung { rung: number; price: number | null }

async function listedRungs(lg: LeagueConfig, date: string, ids: number[]): Promise<Map<string, Rung[]>> {
  const out = new Map<string, Rung[]>();
  for (let i = 0; i < ids.length; i += 150) {
    const rows = await paged<any>((from) =>
      supabaseAdmin.from('daily_lines').select('entity_id,stat,line,implied_prob')
        .eq('league_id', lg.leagueId).eq('game_date', date).eq('prop_type', 'player')
        .in('entity_id', ids.slice(i, i + 150)).order('id').range(from, from + 999));
    for (const r of rows) {
      if (r.line == null) continue;
      const k = `${r.entity_id}:${r.stat}`;
      const list = out.get(k) ?? [];
      const rung = Number(r.line) + 0.5;
      const price = r.implied_prob != null ? Number(r.implied_prob) : null;
      // Rows come oldest first; a later snapshot of the same rung replaces the earlier price.
      const at = list.findIndex((x) => x.rung === rung);
      if (at >= 0) list[at] = { rung, price };
      else list.push({ rung, price });
      out.set(k, list.sort((a, b) => a.rung - b.rung));
    }
  }
  return out;
}

const strength = (depth: number, rung: number, avg: number) => Math.min(depth, 15) * Math.min(rung / Math.max(avg, 0.1), 1);

function bestRun(values: number[], rungs: Rung[], minDepth: number, minRung = -Infinity) {
  let best: { rung: number; price: number | null; depth: number; s: number } | null = null;
  for (const r of rungs) {
    if (r.price != null && r.price > MAX_PRICE) continue;
    if (r.rung < minRung) continue;   // same floors as the league Streak Watch
    let depth = 0;
    while (depth < values.length && values[depth]! >= r.rung) depth++;
    if (depth < minDepth) continue;
    const l10 = values.slice(0, 10);
    const avg = l10.reduce((a, b) => a + b, 0) / l10.length;
    // A rung far below the player's level (1+ catch for a 5-catch tight end) is
    // a near-certainty, not a streak worth showing.
    if (r.rung < avg * 0.45) continue;
    const s = strength(depth, r.rung, avg);
    if (!best || s > best.s) best = { ...r, depth, s };
  }
  return best;
}

function matchupFor(lg: LeagueConfig, table: SeasonTable, oppId: number | undefined, col: string): Matchup | null {
  if (oppId == null) return null;
  const t = table.teams.get(oppId);
  const lgAvg = table.league[col];
  if (!t || !lgAvg || t.against[col] == null) return null;
  // Same small-sample shrink as the Streak Watch: a few games can't say much.
  const raw = t.against[col]! / lgAvg;
  const factor = 1 + (raw - 1) * (t.games / (t.games + (lg.slug === 'nfl' ? 3 : 8)));
  // rank 1 = allows the most (the softest matchup), matching the Streak Watch.
  const rank = table.teamCount + 1 - (table.defRank[col]?.get(oppId) ?? table.teamCount);
  return { factor: Math.round(factor * 1000) / 1000, rank, of: table.teamCount };
}

// ── ESPN: injuries, venue, weather, news ──────────────────────────────────────

const ESPN_SPORT: Record<LeagueSlug, string> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb',
};

export interface GameInjuryRow {
  name: string;
  player_id: number | null;
  ext_id: string | null;
  position: string | null;
  /** out | doubtful | questionable | day-to-day | ir | suspended | other */
  status: string;
  status_label: string;
  injury: string | null;
  updated: string | null;
}

export interface TeamNewsRow {
  id: string;
  kind: 'injury' | 'trade' | 'news';
  headline: string;
  published: string;
  url: string | null;
}

export interface WeatherInfo {
  source: 'open-meteo' | 'espn';
  at: string | null;
  temp_f: number | null;
  wind_mph: number | null;
  gust_mph: number | null;
  precip_prob: number | null;
  condition: string | null;
  /** Plain-language flags that move totals/passing (wind, rain, cold). */
  flags: { label: string; tone: 'bad' | 'warn' }[];
}

export interface VenueInfo {
  name: string;
  city: string | null;
  state: string | null;
  indoor: boolean;
  roof: 'dome' | 'retractable' | 'open';
  grass: boolean | null;
}

/** NFL stadiums with a roof. Retractable roofs are closed in bad weather, so the
 *  forecast at the stadium says little about game conditions there. */
const DOMES: [RegExp, VenueInfo['roof']][] = [
  [/superdome/i, 'dome'], [/ford field/i, 'dome'], [/u\.?s\.? bank/i, 'dome'],
  [/allegiant/i, 'dome'], [/sofi/i, 'dome'],
  [/at&t stadium/i, 'retractable'], [/lucas oil/i, 'retractable'], [/mercedes-benz stadium/i, 'retractable'],
  [/nrg stadium/i, 'retractable'], [/state farm stadium/i, 'retractable'], [/bernab/i, 'retractable'],
];

const ESPN_STATUS: Record<string, string> = {
  INJURY_STATUS_OUT: 'out',
  INJURY_STATUS_DOUBTFUL: 'doubtful',
  INJURY_STATUS_QUESTIONABLE: 'questionable',
  INJURY_STATUS_DAYTODAY: 'day-to-day',
  INJURY_STATUS_IR: 'ir',
  INJURY_STATUS_SUSPENSION: 'suspended',
};

const summaryCache = new Map<string, { at: number; value: any | null }>();

function espnSummary(slug: LeagueSlug, eventId: string): Promise<any | null> {
  return cached(summaryCache, `${slug}:${eventId}`, 10 * 60_000, () =>
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_SPORT[slug]}/summary?event=${eventId}`));
}

// Stricter than the league news card's classifier: "returns to the Bay Area" is not
// an injury story. Only stories that name a health or roster event are flagged.
const INJURY_NEWS = /\b(injur\w*|ruled out|out for|sidelin\w*|questionable|doubtful|day-to-day|sprain\w*|strain\w*|surgery|fractur\w*|torn|tear|concussion|hamstring|ankle|knee|achilles|illness|suspen\w*|reinstat\w*|limited|miss(es|ed|ing)?|DNP|IR|injured reserve)\b/i;
const ROSTER_NEWS = /\b(trade[sd]?|trading|acquir\w*|sign(s|ed|ing)?|waive[sd]?|releas\w*|claim(s|ed)?|extension|free agen\w*|cut[s]?|promot\w*|bench\w*|start(s|er|ing)? (at|over)|deadline)\b/i;

export function classifyTeamNews(headline: string): TeamNewsRow['kind'] {
  if (INJURY_NEWS.test(headline)) return 'injury';
  if (ROSTER_NEWS.test(headline)) return 'trade';
  return 'news';
}

const newsCache = new Map<string, { at: number; value: TeamNewsRow[] }>();

/** Team-tagged ESPN stories from the last week. League-wide roundups (three or more
 *  teams tagged) are dropped: they are about everyone, so about no one. */
function teamNews(slug: LeagueSlug, espnTeamId: string, abbrNick: string): Promise<TeamNewsRow[]> {
  return cached(newsCache, `${slug}:${espnTeamId}`, 10 * 60_000, async () => {
    const body = await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/${ESPN_SPORT[slug]}/news?team=${espnTeamId}&limit=30`);
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const out: TeamNewsRow[] = [];
    for (const a of body?.articles ?? []) {
      if (!a.headline || !a.published || a.published < cutoff) continue;
      // Highlights clips and game recaps say what happened, not what changes next game.
      if (!['HeadlineNews', 'Story', 'Preview'].includes(a.type)) continue;
      const teams = (a.categories ?? []).filter((c: any) => c.type === 'team');
      if (teams.length > 2) continue;
      const mine = teams.some((c: any) => String(c.teamId ?? c.team?.id ?? '') === espnTeamId ||
        (c.description ?? '').toLowerCase().endsWith(abbrNick));
      if (!mine) continue;
      out.push({
        id: String(a.id),
        kind: classifyTeamNews(a.headline),
        headline: a.headline,
        published: a.published,
        url: a.links?.web?.href ?? null,
      });
    }
    // Injury and roster stories first, then the rest, newest first within each.
    const order = { injury: 0, trade: 1, news: 2 } as const;
    out.sort((x, y) => order[x.kind] - order[y.kind] || y.published.localeCompare(x.published));
    return out.slice(0, 6);
  });
}

const STATE_NAME: Record<string, string> = {
  AL: 'Alabama', AZ: 'Arizona', CA: 'California', CO: 'Colorado', FL: 'Florida', GA: 'Georgia',
  IL: 'Illinois', IN: 'Indiana', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', MI: 'Michigan',
  MN: 'Minnesota', MO: 'Missouri', NC: 'North Carolina', NJ: 'New Jersey', NV: 'Nevada', NY: 'New York',
  OH: 'Ohio', PA: 'Pennsylvania', TN: 'Tennessee', TX: 'Texas', WA: 'Washington', WI: 'Wisconsin',
  DC: 'District of Columbia', NE: 'Nebraska', UT: 'Utah', OR: 'Oregon', OK: 'Oklahoma', KY: 'Kentucky',
};

/** WMO weather codes (Open-Meteo) to a short label. */
function wmo(code: number | null): string | null {
  if (code == null) return null;
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

function weatherFlags(w: Omit<WeatherInfo, 'flags' | 'source' | 'at'>): WeatherInfo['flags'] {
  const flags: WeatherInfo['flags'] = [];
  const wind = Math.max(w.wind_mph ?? 0, (w.gust_mph ?? 0) * 0.7);
  if (wind >= 18) flags.push({ label: 'HIGH WIND · PASSING & KICKING DOWN', tone: 'bad' });
  else if (wind >= 12) flags.push({ label: 'BREEZY · LONG KICKS HARDER', tone: 'warn' });
  if ((w.precip_prob ?? 0) >= 50) {
    const snow = /snow/i.test(w.condition ?? '');
    flags.push({ label: snow ? 'SNOW LIKELY · FAVORS THE RUN' : 'RAIN LIKELY · BALL SECURITY', tone: 'bad' });
  } else if ((w.precip_prob ?? 0) >= 25) flags.push({ label: 'CHANCE OF PRECIP', tone: 'warn' });
  if (w.temp_f != null && w.temp_f <= 32) flags.push({ label: 'FREEZING', tone: 'bad' });
  else if (w.temp_f != null && w.temp_f >= 88) flags.push({ label: 'HEAT', tone: 'warn' });
  return flags;
}

const geoCache = new Map<string, { at: number; value: { lat: number; lon: number } | null }>();

async function geocode(city: string, state: string | null, country: string | null) {
  return cached(geoCache, `${city}|${state}|${country}`, 30 * 86400_000, async () => {
    const us = !country || /usa|united states/i.test(country);
    const body = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10${us ? '&countryCode=US' : ''}`);
    const results: any[] = body?.results ?? [];
    const want = state ? (STATE_NAME[state.toUpperCase()] ?? state) : null;
    const hit = (want && results.find((r) => (r.admin1 ?? '').toLowerCase() === want.toLowerCase())) || results[0];
    return hit ? { lat: Number(hit.latitude), lon: Number(hit.longitude) } : null;
  });
}

const forecastCache = new Map<string, { at: number; value: WeatherInfo | null }>();

async function kickoffWeather(city: string, state: string | null, country: string | null, kickoff: string): Promise<WeatherInfo | null> {
  return cached(forecastCache, `${city}|${state}|${kickoff}`, 60 * 60_000, async () => {
    const geo = await geocode(city, state, country);
    if (!geo) return null;
    const date = kickoff.slice(0, 10);
    const body = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
      '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code' +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&start_date=${date}&end_date=${date}`);
    const times: string[] = body?.hourly?.time ?? [];
    if (!times.length) return null; // beyond the 16-day forecast horizon
    const target = Date.parse(kickoff);
    let idx = 0;
    times.forEach((t, i) => {
      if (Math.abs(Date.parse(t + 'Z') - target) < Math.abs(Date.parse(times[idx]! + 'Z') - target)) idx = i;
    });
    const h = body.hourly;
    const pick = (k: string) => (h[k]?.[idx] != null ? Math.round(Number(h[k][idx])) : null);
    const base = {
      temp_f: pick('temperature_2m'),
      wind_mph: pick('wind_speed_10m'),
      gust_mph: pick('wind_gusts_10m'),
      precip_prob: pick('precipitation_probability'),
      condition: wmo(pick('weather_code')),
    };
    return { source: 'open-meteo' as const, at: times[idx]! + 'Z', ...base, flags: weatherFlags(base) };
  });
}

// ── the payload ───────────────────────────────────────────────────────────────

export interface TeamInsights {
  team_id: number;
  abbr: string;
  record: { w: number; l: number; t: number } | null;
  injuries: GameInjuryRow[];
  /** Where the injury list came from: ESPN's game summary, or our availability table. */
  injury_source: 'espn' | 'availability' | null;
  news: TeamNewsRow[];
  streaks: GameStreak[];
  trends: GameTrend[];
}

export interface GameInsights {
  league: LeagueSlug;
  game_id: number;
  season_since: string;
  games_sampled: { away: number; home: number };
  team_count: number;
  defense: TapeRow[];
  offense: TapeRow[];
  away: TeamInsights;
  home: TeamInsights;
  venue: VenueInfo | null;
  /** Null for indoor venues, non-NFL games, finished games, or when no forecast exists yet. */
  weather: WeatherInfo | null;
  weather_note: string | null;
}

interface GameRow {
  id: number;
  game_date: string;
  game_time: string | null;
  ext_id: string | null;
  espn_id: string | null;
  home_team: { id: number; abbreviation: string; name: string };
  away_team: { id: number; abbreviation: string; name: string };
  is_completed: boolean;
}

function espnEventId(lg: LeagueConfig, g: GameRow): string | null {
  if (g.espn_id) return String(g.espn_id);
  // NFL and NHL were ingested from ESPN, so their ext_id is the ESPN event id.
  if ((lg.slug === 'nfl' || lg.slug === 'nhl') && g.ext_id && /^\d+$/.test(g.ext_id)) return g.ext_id;
  return null;
}

export async function buildGameInsights(lg: LeagueConfig, g: GameRow): Promise<GameInsights> {
  const awayId = g.away_team.id;
  const homeId = g.home_team.id;
  const awayAbbr = (g.away_team.abbreviation ?? '').toUpperCase();
  const homeAbbr = (g.home_team.abbreviation ?? '').toUpperCase();
  const eventId = espnEventId(lg, g);

  const [table, summary, rosterRes, availRes] = await Promise.all([
    seasonTable(lg, g.game_date),
    eventId ? espnSummary(lg.slug, eventId) : Promise.resolve(null),
    supabaseAdmin.from('players').select('id,name,team,position,ext_id')
      .eq('league', lg.playerLeagueTag).in('team', [awayAbbr, homeAbbr]),
    supabaseAdmin.from('player_availability').select('player_id,status').eq('game_id', g.id),
  ]);
  const roster = (rosterRes.data ?? []) as any[];
  const byId = new Map<number, any>(roster.map((p) => [p.id, p]));
  const byName = new Map<string, any>();
  for (const p of roster) byName.set(`${(p.team ?? '').toUpperCase()}:${normName(p.name ?? '')}`, p);

  // ── injuries ───────────────────────────────────────────────────────────
  const injuries: Record<string, GameInjuryRow[]> = { [awayAbbr]: [], [homeAbbr]: [] };
  let injurySource: TeamInsights['injury_source'] = null;
  const espnInj: any[] = summary?.injuries ?? [];
  const espnTeamAbbr = (t: any) => {
    // ESPN and our abbreviations can differ (WSH vs WAS): match by home/away id.
    const comps: any[] = summary?.header?.competitions?.[0]?.competitors ?? [];
    const c = comps.find((x) => String(x.team?.id) === String(t?.id));
    if (c) return c.homeAway === 'home' ? homeAbbr : awayAbbr;
    return (t?.abbreviation ?? '').toUpperCase();
  };
  if (espnInj.length) {
    injurySource = 'espn';
    for (const t of espnInj) {
      const abbr = espnTeamAbbr(t.team);
      if (!injuries[abbr]) continue;
      for (const i of t.injuries ?? []) {
        const name = i.athlete?.displayName ?? '';
        const p = byName.get(`${abbr}:${normName(name)}`);
        const d = i.details ?? {};
        const injury = [d.side && d.side !== 'Not Specified' ? d.side : null, d.type, d.detail && d.detail !== 'Not Specified' && d.detail !== d.type ? d.detail : null]
          .filter(Boolean).join(' ') || null;
        injuries[abbr]!.push({
          name,
          player_id: p?.id ?? null,
          ext_id: p?.ext_id ?? null,
          position: i.athlete?.position?.abbreviation ?? p?.position ?? null,
          status: ESPN_STATUS[i.type?.name] ?? 'other',
          status_label: (i.status ?? i.type?.description ?? '').toUpperCase(),
          injury,
          updated: i.date ?? null,
        });
      }
    }
  } else if ((availRes.data ?? []).length) {
    injurySource = 'availability';
    for (const r of availRes.data as any[]) {
      if (!['out', 'gtd', 'questionable'].includes(r.status)) continue;
      const p = byId.get(r.player_id);
      const abbr = (p?.team ?? '').toUpperCase();
      if (!injuries[abbr]) continue;
      injuries[abbr]!.push({
        name: p?.name ?? `#${r.player_id}`, player_id: r.player_id, ext_id: p?.ext_id ?? null,
        position: p?.position ?? null, status: r.status === 'gtd' ? 'day-to-day' : r.status,
        status_label: r.status.toUpperCase(), injury: null, updated: null,
      });
    }
  }
  const STATUS_ORDER = ['out', 'doubtful', 'questionable', 'day-to-day', 'suspended', 'ir', 'other'];
  for (const list of Object.values(injuries)) {
    list.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  }
  // Players who won't play are left out of streaks and trends.
  const outIds = new Set<number>();
  for (const r of (availRes.data ?? []) as any[]) if (r.status === 'out') outIds.add(r.player_id);
  for (const list of Object.values(injuries)) {
    for (const i of list) if (i.player_id && ['out', 'ir', 'suspended', 'doubtful'].includes(i.status)) outIds.add(i.player_id);
  }

  const active = roster.filter((p) => !outIds.has(p.id));
  const ids = active.map((p) => p.id);
  const teamIdOfAbbr = (abbr: string) => (abbr === awayAbbr ? awayId : homeId);
  const oppOfAbbr = (abbr: string) => (abbr === awayAbbr ? homeId : awayId);

  // ── streaks ────────────────────────────────────────────────────────────
  const streakStats = STREAK[lg.slug];
  const gateCols = [...new Set(streakStats.map((s) => s.gate).filter(Boolean) as string[])];
  const statCols = [...new Set(streakStats.map((s) => s.col))];
  const values = new Map<number, Record<string, number[]>>();
  const lookback = lg.slug === 'nfl' ? 150 : 75;
  const exhibition = await preseasonGameIds(lg.leagueId, day(g.game_date, -lookback), g.game_date);
  const [listed] = await Promise.all([
    listedRungs(lg, g.game_date, ids),
    (async () => {
      for (let i = 0; i < ids.length; i += 100) {
        const rows = await paged<any>((from) =>
          supabaseAdmin.from(lg.statsTable)
            .select(['player_id', 'game_date', 'game_id', ...gateCols, ...statCols].join(','))
            .in('player_id', ids.slice(i, i + 100))
            .gte('game_date', day(g.game_date, -lookback)).lt('game_date', g.game_date)
            .order('game_date', { ascending: false }).order('game_id').order('player_id')
            .range(from, from + 999));
        for (const r of rows) {
          if (exhibition.has(r.game_id)) continue;
          const v = values.get(r.player_id) ?? {};
          for (const s of streakStats) {
            if (s.gate && !(Number(r[s.gate]) > 0)) continue;
            const list = (v[s.key] ??= []);
            if (list.length < HISTORY) list.push(Number(r[s.col] ?? 0));
          }
          values.set(r.player_id, v);
        }
      }
    })(),
  ]);

  const streaks: GameStreak[] = [];
  for (const [pid, byStat] of values) {
    const p = byId.get(pid);
    const abbr = (p?.team ?? '').toUpperCase();
    let best: (GameStreak & { s: number }) | null = null;
    for (const s of streakStats) {
      const vals = byStat[s.key] ?? [];
      if (vals.length < MIN_DEPTH[lg.slug]) continue;
      const l = listed.get(`${pid}:${s.key}`);
      const rungs = l?.length ? l : rungsFor(lg.slug, s.key).map((rung) => ({ rung, price: null }));
      const run = bestRun(vals, rungs, MIN_DEPTH[lg.slug], watchConfig(lg)?.minRung[s.key]);
      if (!run) continue;
      const l10 = vals.slice(0, 10);
      const cand = {
        player_id: pid, name: p?.name ?? 'Unknown', team: abbr, ext_id: p?.ext_id ?? null,
        position: p?.position ?? null, stat: s.key, stat_label: s.label, rung: run.rung,
        depth: run.depth, games: vals.length,
        l10_avg: round1(l10.reduce((a, b) => a + b, 0) / l10.length),
        last10: [...l10].reverse(), price: run.price, listed: !!l?.length,
        matchup: matchupFor(lg, table, oppOfAbbr(abbr), s.col), s: run.s,
      };
      // Listed markets first, then strength.
      if (!best || Number(cand.listed) - Number(best.listed) > 0 ||
          (cand.listed === best.listed && cand.s > best.s)) best = cand;
    }
    if (best) streaks.push(best);
  }
  streaks.sort((a, b) => Number(b.listed) - Number(a.listed) ||
    strength(b.depth, b.rung, b.l10_avg) - strength(a.depth, a.rung, a.l10_avg));

  // ── trends ─────────────────────────────────────────────────────────────
  const trends: GameTrend[] = [];
  if (lg.trendsTable && ids.length) {
    const { data: tr } = await supabaseAdmin.from(lg.trendsTable)
      .select('player_id,stat,window_size,trend_val,rolling_avg,season_avg')
      .in('player_id', ids).in('window_size', [3, 5, 10]).in('stat', lg.validStatIds);
    const best = new Map<string, any>();
    for (const r of (tr ?? []) as any[]) {
      const k = `${r.player_id}:${r.stat}`;
      const cur = best.get(k);
      if (!cur || r.window_size > cur.window_size) best.set(k, r);
    }
    const keyOfStatId = new Map(Object.entries(lg.statConfig).map(([k, v]) => [v.statId, { key: k, col: v.col }]));
    for (const r of best.values()) {
      const p = byId.get(r.player_id);
      const sc = keyOfStatId.get(r.stat);
      if (!p || !sc || r.trend_val == null) continue;
      const abbr = (p.team ?? '').toUpperCase();
      const recent = Number(r.rolling_avg);
      const l = listed.get(`${r.player_id}:${sc.key}`);
      const pool = l?.length ? l : rungsFor(lg.slug, sc.key).map((rung) => ({ rung, price: null }));
      let near: Rung | null = null;
      for (const x of pool) if (!near || Math.abs(x.rung - recent) < Math.abs(near.rung - recent)) near = x;
      trends.push({
        player_id: r.player_id, name: p.name, team: abbr, ext_id: p.ext_id ?? null, position: p.position ?? null,
        stat: sc.key, stat_label: lg.statLabels[sc.key] ?? sc.key.toUpperCase(), window: r.window_size,
        recent_avg: round1(recent), season_avg: r.season_avg != null ? round1(Number(r.season_avg)) : null,
        z: Math.round(Number(r.trend_val) * 100) / 100,
        rung: near?.rung ?? null, price: near?.price ?? null,
        matchup: matchupFor(lg, table, oppOfAbbr(abbr), sc.col),
      });
    }
  }
  // Volume floor: a trend on a stat the player barely records is noise.
  // Only stats with a prop market (a rung to bet) are shown: an NFL tackles trend
  // has nothing to act on.
  const meaningful = trends.filter((t) =>
    t.rung != null && Math.max(t.recent_avg, t.season_avg ?? 0) >= minVolume(lg.slug, t.stat));

  // ── venue & weather ────────────────────────────────────────────────────
  let venue: VenueInfo | null = null;
  let weather: WeatherInfo | null = null;
  let weatherNote: string | null = null;
  const v = summary?.gameInfo?.venue;
  if (v?.fullName) {
    const dome = DOMES.find(([re]) => re.test(v.fullName));
    const roof = lg.slug === 'nfl' ? (dome?.[1] ?? 'open') : 'dome';
    venue = {
      name: v.fullName, city: v.address?.city ?? null, state: v.address?.state ?? null,
      indoor: roof !== 'open', roof, grass: typeof v.grass === 'boolean' ? v.grass : null,
    };
  }
  if (lg.slug === 'nfl' && !g.is_completed) {
    if (venue?.indoor) {
      weatherNote = venue.roof === 'dome' ? 'INDOOR · WEATHER NOT A FACTOR' : 'RETRACTABLE ROOF · USUALLY CLOSED IN BAD WEATHER';
    } else if (venue?.city && g.game_time) {
      weather = await kickoffWeather(venue.city, venue.state, v?.address?.country ?? null, new Date(g.game_time).toISOString());
      const ew = summary?.gameInfo?.weather;
      if (!weather && ew && ew.temperature != null) {
        const base = { temp_f: Number(ew.temperature), wind_mph: null, gust_mph: ew.gust != null ? Number(ew.gust) : null, precip_prob: ew.precipitation != null ? Number(ew.precipitation) : null, condition: null };
        weather = { source: 'espn', at: null, ...base, flags: weatherFlags(base) };
      }
      if (!weather) weatherNote = 'NO FORECAST YET · TOO FAR OUT';
    } else {
      weatherNote = 'VENUE UNKNOWN · NO FORECAST';
    }
  }

  // ── news & records ─────────────────────────────────────────────────────
  const comps: any[] = summary?.header?.competitions?.[0]?.competitors ?? [];
  const compFor = (side: 'home' | 'away') => comps.find((c) => c.homeAway === side);
  const nick = (name: string) => (name ?? '').toLowerCase().split(' ').slice(-1)[0] ?? '';
  const [awayNews, homeNews] = await Promise.all(
    (['away', 'home'] as const).map((side) => {
      const c = compFor(side);
      const team = side === 'away' ? g.away_team : g.home_team;
      return c?.team?.id ? teamNews(lg.slug, String(c.team.id), nick(team.name)) : Promise.resolve([]);
    }),
  );
  const recordOf = (side: 'home' | 'away') => {
    const summaryText = compFor(side)?.record?.find((r: any) => r.type === 'total')?.summary
      ?? compFor(side)?.record?.[0]?.summary;
    const m = typeof summaryText === 'string' ? summaryText.match(/^(\d+)-(\d+)(?:-(\d+))?$/) : null;
    return m ? { w: Number(m[1]), l: Number(m[2]), t: Number(m[3] ?? 0) } : null;
  };

  const forTeam = (abbr: string, side: 'home' | 'away', news: TeamNewsRow[]): TeamInsights => ({
    team_id: teamIdOfAbbr(abbr),
    abbr,
    record: recordOf(side),
    injuries: injuries[abbr] ?? [],
    injury_source: injurySource,
    news,
    streaks: streaks.filter((s) => s.team === abbr).slice(0, 6),
    trends: meaningful.filter((t) => t.team === abbr).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 6),
  });

  return {
    league: lg.slug,
    game_id: g.id,
    season_since: table.since,
    games_sampled: { away: table.teams.get(awayId)?.games ?? 0, home: table.teams.get(homeId)?.games ?? 0 },
    team_count: table.teamCount,
    defense: tapeRows(lg, table, awayId, homeId, 'defense'),
    offense: tapeRows(lg, table, awayId, homeId, 'offense'),
    away: forTeam(awayAbbr, 'away', awayNews),
    home: forTeam(homeAbbr, 'home', homeNews),
    venue,
    weather,
    weather_note: weatherNote,
  };
}

/** Smallest average worth calling a trend on (1.2 assists a game is not a story). */
function minVolume(slug: LeagueSlug, stat: string): number {
  const t: Record<string, Record<string, number>> = {
    nba: { pts: 8, reb: 3, ast: 2, fg3m: 1 },
    nfl: { payds: 100, patd: 0.8, ruyds: 20, rutd: 0.3, recyds: 20, rec: 2, rectd: 0.3, tkl: 3 },
  };
  return t[slug]?.[stat] ?? 0;
}
