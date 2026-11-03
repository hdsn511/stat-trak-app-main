// Streak Watch and Trending enrichment for leagues with a Kalshi ladder (NBA).
//
// Streak Watch is one list across stats rather than ten points streaks: for each
// player and stat, the streak is measured at the rungs Kalshi actually lists for him
// today (the ladder when nothing is listed yet). A streak's strength is its depth
// weighted by how close the rung sits to the player's level (rung / L10 average), so
// 25+ for a 29-point scorer outranks 2+ rebounds for a 6-rebound player. Each player
// keeps his strongest stat; at most PER_STAT per stat; the ten that make it are
// ordered by matchup for that stat.
//
// Matchup = what the opponent has allowed in that stat over the last MATCHUP_DAYS,
// relative to the league, shrunk toward even when the sample is small. It is computed
// from box scores because opponent_position_defense is a season snapshot that goes
// stale.

import { supabaseAdmin } from '../config/supabaseAdmin';
import type { LeagueConfig } from '../config/leagues';
import { sportsDay } from '../utils/dateQueries';
import { ladder } from '../utils/kalshiLadder';

export const STAT_COL: Record<string, string> = {
  pts: 'points', reb: 'rebounds', ast: 'assists', fg3m: 'three_points_made',
};
const WATCH_SIZE = 10;
const PER_STAT = 3;
const MIN_DEPTH = 5;          // a run shorter than this is not a streak
const HISTORY = 15;           // games looked back for depth
const MATCHUP_DAYS = 45;
// A rung priced above this is a near-lock, not a pick (2+ rebounds at 98%). Unpriced
// ladder rungs pass, since there is no price to judge them by.
const MAX_PRICE = 0.9;

export interface Matchup { factor: number; rank: number; of: number }
export interface Rung { rung: number; price: number | null }

const day = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** The next date with an unstarted game: once tonight's slate has tipped, or on an
 *  off-day (e.g. Election Day), the lists move to the next slate. */
export async function nextSlate(lg: LeagueConfig): Promise<{ date: string | null; games: any[] }> {
  const today = sportsDay();
  const { data: next } = await supabaseAdmin
    .from('games').select('game_date').eq('league_id', lg.leagueId).gt('game_time', new Date().toISOString())
    .gte('game_date', today).order('game_date', { ascending: true }).limit(1);
  const date = next?.[0]?.game_date ?? null;
  if (!date) return { date: null, games: [] };
  const { data: games } = await supabaseAdmin
    .from('games').select('id,home_team_id,away_team_id,game_time').eq('league_id', lg.leagueId).eq('game_date', date);
  return { date, games: games ?? [] };
}

async function paged<T>(build: (from: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

const matchupCache = new Map<string, { at: number; value: Map<number, Record<string, Matchup>> }>();

/** teamId -> stat -> how much this opponent allows vs the league (rank 1 = allows most). */
export async function matchupFactors(lg: LeagueConfig): Promise<Map<number, Record<string, Matchup>>> {
  const key = `${lg.slug}:${sportsDay()}`;
  const hit = matchupCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.value;

  const since = day(sportsDay(), -MATCHUP_DAYS);
  const games = await paged<any>((from) =>
    supabaseAdmin.from('games').select('id,home_team_id,away_team_id').eq('league_id', lg.leagueId)
      .eq('status', 2).gte('game_date', since).order('id').range(from, from + 999));
  const oppOf = new Map<string, number>();     // `${gameId}:${teamId}` -> opponent
  for (const g of games) {
    oppOf.set(`${g.id}:${g.home_team_id}`, g.away_team_id);
    oppOf.set(`${g.id}:${g.away_team_id}`, g.home_team_id);
  }
  const rows = await paged<any>((from) =>
    supabaseAdmin.from(lg.statsTable).select('game_id,player_id,team_id,' + Object.values(STAT_COL).join(','))
      .gte('game_date', since).order('game_id').order('player_id').range(from, from + 999));

  // Allowed per (opponent, game), then per opponent.
  const allowed = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const opp = oppOf.get(`${r.game_id}:${r.team_id}`);
    if (opp == null) continue;
    const k = `${opp}:${r.game_id}`;
    const a = allowed.get(k) ?? { pts: 0, reb: 0, ast: 0, fg3m: 0 };
    for (const [s, col] of Object.entries(STAT_COL)) a[s] += Number(r[col] ?? 0);
    allowed.set(k, a);
  }
  const byTeam = new Map<number, { n: number; sum: Record<string, number> }>();
  for (const [k, a] of allowed) {
    const team = Number(k.split(':')[0]);
    const t = byTeam.get(team) ?? { n: 0, sum: { pts: 0, reb: 0, ast: 0, fg3m: 0 } };
    t.n++;
    for (const s of Object.keys(STAT_COL)) t.sum[s] += a[s];
    byTeam.set(team, t);
  }
  const value = new Map<number, Record<string, Matchup>>();
  for (const s of Object.keys(STAT_COL)) {
    const teams = [...byTeam.entries()];
    const games_ = teams.reduce((x, [, t]) => x + t.n, 0);
    const league = games_ ? teams.reduce((x, [, t]) => x + t.sum[s], 0) / games_ : 0;
    const scored = teams.map(([id, t]) => {
      const raw = league > 0 ? t.sum[s] / t.n / league : 1;
      return { id, factor: 1 + (raw - 1) * (t.n / (t.n + 8)) };
    }).sort((a, b) => b.factor - a.factor);
    scored.forEach((t, i) => {
      const rec = value.get(t.id) ?? {};
      rec[s] = { factor: Math.round(t.factor * 1000) / 1000, rank: i + 1, of: scored.length };
      value.set(t.id, rec);
    });
  }
  matchupCache.set(key, { at: Date.now(), value });
  return value;
}

/** `${playerId}:${stat}` -> the Kalshi rungs listed for that slate, with their YES price. */
export async function listedRungs(lg: LeagueConfig, date: string, playerIds: number[]): Promise<Map<string, Rung[]>> {
  const out = new Map<string, Rung[]>();
  for (let i = 0; i < playerIds.length; i += 150) {
    const rows = await paged<any>((from) =>
      supabaseAdmin.from('daily_lines').select('entity_id,stat,line,implied_prob,market_ticker')
        .eq('league_id', lg.leagueId).eq('game_date', date).eq('prop_type', 'player')
        .in('entity_id', playerIds.slice(i, i + 150)).order('id').range(from, from + 999));
    for (const r of rows) {
      if (r.line == null || !STAT_COL[r.stat]) continue;
      const k = `${r.entity_id}:${r.stat}`;
      const list = out.get(k) ?? [];
      const rung = Number(r.line) + 0.5;
      if (!list.some((x) => x.rung === rung)) {
        list.push({ rung, price: r.implied_prob != null ? Number(r.implied_prob) : null });
      }
      out.set(k, list.sort((a, b) => a.rung - b.rung));
    }
  }
  return out;
}

/** The rung to show for an average: nearest listed rung (ties down), else the ladder's. */
export function nearestListed(lg: LeagueConfig, stat: string, avg: number, listed: Rung[] | undefined): Rung | null {
  const pool = listed?.length ? listed : (ladder(lg.slug, stat) ?? []).map((rung) => ({ rung, price: null }));
  let best: Rung | null = null;
  for (const r of pool) if (!best || Math.abs(r.rung - avg) < Math.abs(best.rung - avg)) best = r;
  return best;
}

export interface WatchRow {
  player_id: number;
  name: string;
  team: string;
  ext_id: string | null;
  opponent: string | null;
  stat: string;
  rung: number;
  /** Consecutive most-recent games at or above the rung. */
  depth: number;
  /** How far the run's lowest game sits above the rung (0 = cleared it exactly). */
  margin: number;
  l10_avg: number;
  /** Last 10 values, oldest first, for the sparkline. */
  last10: number[];
  /** Kalshi YES price for the rung, if listed. */
  price: number | null;
  matchup: Matchup | null;
}

export interface Candidate extends Omit<WatchRow, 'name' | 'team' | 'ext_id' | 'opponent' | 'matchup'> { listed: boolean }

/** Depth (capped at 10) weighted by how close the rung is to the player's level. */
export function strength(c: Pick<Candidate, 'depth' | 'rung' | 'l10_avg'>): number {
  return Math.min(c.depth, 10) * Math.min(c.rung / Math.max(c.l10_avg, 0.1), 1);
}

export function bestStreak(stat: string, values: number[], rungs: Rung[], listed: boolean): Candidate | null {
  // values: most recent first. The strongest rung with a run of at least MIN_DEPTH.
  let best: Candidate | null = null;
  for (const r of rungs) {
    if (r.price != null && r.price > MAX_PRICE) continue;
    let depth = 0;
    while (depth < values.length && values[depth]! >= r.rung) depth++;
    if (depth < MIN_DEPTH) continue;
    const run = values.slice(0, depth);
    const last10 = values.slice(0, 10);
    const c: Candidate = {
      player_id: 0, stat, rung: r.rung, depth, listed,
      margin: Math.min(...run) - r.rung,
      l10_avg: Math.round((last10.reduce((a, b) => a + b, 0) / last10.length) * 10) / 10,
      last10: [...last10].reverse(),
      price: r.price,
    };
    if (!best || strength(c) > strength(best)) best = c;
  }
  return best;
}

/** Listed lines first, then strength, then the tightest over its rung. */
export function byStreakStrength(a: Candidate, b: Candidate): number {
  return Number(b.listed) - Number(a.listed) || strength(b) - strength(a) || a.margin - b.margin;
}

/** Rank and cap: one stat per player, at most perStat per stat, so the list mixes stats. */
export function selectWatch<T extends Candidate>(cands: T[], size = WATCH_SIZE, perStat = PER_STAT): T[] {
  const order = [...cands].sort(byStreakStrength);
  const players = new Set<number>();
  const per: Record<string, number> = {};
  const out: T[] = [];
  for (const c of order) {
    if (out.length === size) break;
    if (players.has(c.player_id) || (per[c.stat] ?? 0) >= perStat) continue;
    players.add(c.player_id);
    per[c.stat] = (per[c.stat] ?? 0) + 1;
    out.push(c);
  }
  return out;
}

export async function buildStreakWatch(lg: LeagueConfig): Promise<{ date: string | null; rows: WatchRow[] }> {
  const { date, games } = await nextSlate(lg);
  if (!date || games.length === 0) return { date, rows: [] };
  const { data: teams } = await supabaseAdmin.from('teams').select('id,abbreviation').eq('league_id', lg.leagueId);
  const abbrOf = new Map((teams ?? []).map((t: any) => [t.id, (t.abbreviation ?? '').toUpperCase()]));
  const idOf = new Map((teams ?? []).map((t: any) => [(t.abbreviation ?? '').toUpperCase(), t.id]));
  const oppOf = new Map<number, number>();
  for (const g of games) {
    oppOf.set(g.home_team_id, g.away_team_id);
    oppOf.set(g.away_team_id, g.home_team_id);
  }
  const slateAbbrs = [...oppOf.keys()].map((id) => abbrOf.get(id)).filter(Boolean) as string[];
  const { data: outRows } = await supabaseAdmin
    .from('player_availability').select('player_id').eq('status', 'out').in('game_id', games.map((g) => g.id));
  const out = new Set((outRows ?? []).map((r: any) => r.player_id));
  const { data: players } = await supabaseAdmin
    .from('players').select('id,name,team,ext_id').eq('league_id', lg.leagueId).in('team', slateAbbrs);
  const roster = (players ?? []).filter((p: any) => !out.has(p.id));
  const ids = roster.map((p: any) => p.id);

  const values = new Map<number, Record<string, number[]>>();
  const since = day(date, -75);
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await paged<any>((from) =>
      supabaseAdmin.from(lg.statsTable)
        .select('player_id,game_date,game_id,minutes_played,' + Object.values(STAT_COL).join(','))
        .in('player_id', ids.slice(i, i + 100)).gte('game_date', since).lt('game_date', date)
        .order('game_date', { ascending: false }).order('game_id').order('player_id').range(from, from + 999));
    for (const r of rows) {
      if (!(Number(r.minutes_played) > 0)) continue;
      const v = values.get(r.player_id) ?? { pts: [], reb: [], ast: [], fg3m: [] };
      if (v.pts!.length >= HISTORY) continue;
      for (const [s, col] of Object.entries(STAT_COL)) v[s]!.push(Number(r[col] ?? 0));
      values.set(r.player_id, v);
    }
  }

  const listed = await listedRungs(lg, date, ids);
  const cands: Candidate[] = [];
  for (const [pid, byStat] of values) {
    let best: Candidate | null = null;
    for (const s of Object.keys(STAT_COL)) {
      const l = listed.get(`${pid}:${s}`);
      const rungs = l?.length ? l : (ladder(lg.slug, s) ?? []).map((rung) => ({ rung, price: null }));
      const c = bestStreak(s, byStat[s]!, rungs, !!l?.length);
      if (c && (!best || byStreakStrength(c, best) < 0)) best = { ...c, player_id: pid };
    }
    if (best) cands.push(best);
  }
  const chosen = selectWatch(cands);
  const factors = await matchupFactors(lg);
  const byId = new Map(roster.map((p: any) => [p.id, p]));
  const rows: WatchRow[] = chosen.map((c) => {
    const p: any = byId.get(c.player_id);
    const teamId = idOf.get((p?.team ?? '').toUpperCase());
    const opp = teamId != null ? oppOf.get(teamId) : undefined;
    const { listed: _listed, ...rest } = c;
    return {
      ...rest,
      name: p?.name ?? 'Unknown',
      team: p?.team ?? '',
      ext_id: p?.ext_id ?? null,
      opponent: opp != null ? (abbrOf.get(opp) ?? null) : null,
      matchup: opp != null ? (factors.get(opp)?.[c.stat] ?? null) : null,
    };
  });
  rows.sort((a, b) => (b.matchup?.factor ?? 1) - (a.matchup?.factor ?? 1));
  return { date, rows };
}

/**
 * Trending rows get the rung nearest their L10 average from what Kalshi lists (the
 * ladder when nothing is listed), its price, and the opponent's matchup for that
 * stat; the list is then ordered by matchup. Leagues without a ladder pass through.
 */
export async function enrichTrending<T extends { playerId: number; team: string; stat: string; rollingAvg: number }>(
  lg: LeagueConfig, rows: T[],
): Promise<(T & { suggested: { rung: number; line: number; side: 'over' } | null; price: number | null; opponent: string | null; matchup: Matchup | null })[]> {
  const key = (s: string) => ({ points: 'pts', rebounds: 'reb', assists: 'ast', threes: 'fg3m' } as Record<string, string>)[s] ?? s;
  if (!ladder(lg.slug, 'pts')) {
    return rows.map((r) => ({ ...r, suggested: null, price: null, opponent: null, matchup: null }));
  }
  const { date, games } = await nextSlate(lg);
  const { data: teams } = await supabaseAdmin.from('teams').select('id,abbreviation').eq('league_id', lg.leagueId);
  const abbrOf = new Map((teams ?? []).map((t: any) => [t.id, (t.abbreviation ?? '').toUpperCase()]));
  const idOf = new Map((teams ?? []).map((t: any) => [(t.abbreviation ?? '').toUpperCase(), t.id]));
  const oppOf = new Map<number, number>();
  for (const g of games) {
    oppOf.set(g.home_team_id, g.away_team_id);
    oppOf.set(g.away_team_id, g.home_team_id);
  }
  const [listed, factors] = await Promise.all([
    date ? listedRungs(lg, date, rows.map((r) => r.playerId)) : Promise.resolve(new Map<string, Rung[]>()),
    matchupFactors(lg),
  ]);
  const out = rows.map((r) => {
    const s = key(r.stat);
    const pick = nearestListed(lg, s, r.rollingAvg, listed.get(`${r.playerId}:${s}`));
    const teamId = idOf.get((r.team ?? '').toUpperCase());
    const opp = teamId != null ? oppOf.get(teamId) : undefined;
    return {
      ...r,
      suggested: pick ? { rung: pick.rung, line: pick.rung - 0.5, side: 'over' as const } : null,
      price: pick?.price ?? null,
      opponent: opp != null ? (abbrOf.get(opp) ?? null) : null,
      matchup: opp != null ? (factors.get(opp)?.[s] ?? null) : null,
    };
  });
  return out.sort((a, b) => (b.matchup?.factor ?? 1) - (a.matchup?.factor ?? 1));
}
