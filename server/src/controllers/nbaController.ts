import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { findNearestConditionsDate, findNearestPickDate, sportsDay } from '../utils/dateQueries';
import { league as resolveLeague, seasonStartFor, LeagueConfig } from '../config/leagues';

/**
 * Rows to return from the player game log. `all` means the whole season; any
 * other value falls back to the historical default of 20 so existing callers
 * are unaffected.
 */
export function resolveLogLimit(window: unknown): number | null {
  if (window === 'all') return null;
  if (typeof window !== 'string') return 20;
  const n = parseInt(window, 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, 500);
}

interface ScheduledGame {
  id: number;
  game_date: string;
  home_team_id: number;
  away_team_id: number;
}

/**
 * Shape the player's next scheduled game. `lastPlayedDate` is the date of their
 * most recent completed game, used for days rest; null when they have none.
 */
export function buildUpcoming(
  game: ScheduledGame | null,
  playerTeamId: number | null,
  abbrById: Record<number, string>,
  lastPlayedDate: string | null
) {
  if (!game || playerTeamId == null) return null;
  const isHome = game.home_team_id === playerTeamId;
  const opponentTeamId = isHome ? game.away_team_id : game.home_team_id;
  const daysRest =
    lastPlayedDate == null
      ? null
      : Math.round((Date.parse(game.game_date) - Date.parse(lastPlayedDate)) / 86_400_000);
  return {
    gameId: game.id,
    date: game.game_date,
    opponent: abbrById[opponentTeamId] ?? '',
    opponentTeamId,
    isHome,
    daysRest,
  };
}

export type DriverDetail = { label: string; summary: string; lines: string[] };

// Build trend driver chips for a player given their conditions row + injury flag.
function buildTrendDrivers(
  cond: {
    rolling_usg_5g?: number | null;
    season_avg_usg?: number | null;
    rolling_min_5g?: number | null;
    rolling_pace_5g?: number | null;
  } | null | undefined,
  hasInjuryBoost: boolean,
): string[] {
  const drivers: string[] = [];
  if (cond) {
    const rUsg = cond.rolling_usg_5g;
    const sUsg = cond.season_avg_usg;
    if (rUsg != null && sUsg != null && sUsg > 0) {
      const pctIncrease = (rUsg - sUsg) / sUsg;
      if (pctIncrease > 0.10) drivers.push('USG ↑');
    }
    if (cond.rolling_min_5g != null && cond.rolling_min_5g > 30) {
      drivers.push('MIN ↑');
    }
    if (cond.rolling_pace_5g != null && cond.rolling_pace_5g > 102) {
      drivers.push('FAST PACE');
    }
  }
  if (hasInjuryBoost) drivers.push('INJURY BOOST');
  return drivers;
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const sign = (v: number) => (v > 0 ? '+' : '') + f1(v);

// Quantified drill-down behind each NBA chip. `outs` are the injured
// teammates with their season PPG so the boost is a number, not a vibe.
function buildDriverDetails(
  cond: any,
  outs: { name: string; ppg: number | null }[],
): DriverDetail[] {
  const d: DriverDetail[] = [];
  if (cond) {
    const rUsg = cond.rolling_usg_5g, sUsg = cond.season_avg_usg;
    if (rUsg != null && sUsg != null && sUsg > 0 && (rUsg - sUsg) / sUsg > 0.10) {
      const pct = ((rUsg - sUsg) / sUsg) * 100;
      d.push({ label: 'USG ↑', summary: `Usage up ${f1(pct)}% vs season`, lines: [
        `Last 5 games: ${f1(rUsg)}% of team possessions used`,
        `Season average: ${f1(sUsg)}%`,
        'More possessions used means more shot and assist chances.',
      ]});
    }
    if (cond.rolling_min_5g != null && cond.rolling_min_5g > 30) {
      d.push({ label: 'MIN ↑', summary: `${f1(cond.rolling_min_5g)} minutes per game lately`, lines: [
        `Last 5 games: ${f1(cond.rolling_min_5g)} min per game`,
        'Over 30 minutes is a heavy-rotation workload; counting stats scale with it.',
      ]});
    }
    if (cond.rolling_pace_5g != null && cond.rolling_pace_5g > 102) {
      d.push({ label: 'FAST PACE', summary: `Team pace ${f1(cond.rolling_pace_5g)}`, lines: [
        `Last 5 games: ${f1(cond.rolling_pace_5g)} possessions per 48`,
        `That is ${sign(cond.rolling_pace_5g - 100)} vs a ~100 league baseline: more possessions, more chances.`,
      ]});
    }
  }
  if (outs.length > 0) {
    const vacated = outs.reduce((a, o) => a + (o.ppg ?? 0), 0);
    d.push({ label: 'INJURY BOOST', summary: `${outs.length} teammate${outs.length > 1 ? 's' : ''} out, ${f1(vacated)} PPG vacated`, lines: [
      ...outs.map((o) => `${o.name} OUT${o.ppg != null ? ` (${f1(o.ppg)} PPG)` : ''}`),
      'Their shots and minutes get redistributed among the players still active.',
    ]});
  }
  return d;
}

function buildMLBDriverDetails(cond: any, park: any, starter: any): DriverDetail[] {
  const d: DriverDetail[] = [];
  if (cond?.opp_starter_hand === 'L' || cond?.opp_starter_hand === 'R') {
    const hand = cond.opp_starter_hand === 'L' ? 'left' : 'right';
    d.push({ label: cond.opp_starter_hand === 'L' ? 'vs LHP' : 'vs RHP', summary: `Faces a ${hand}-handed starter`, lines: [
      ...(starter ? [`${starter.name}: arm quality rank ${starter.rank} of ${starter.total} (1 = best)`] : []),
      `Platoon matchup: hitters split by pitcher handedness, so the same bat can swing very differently.`,
    ]});
  }
  const pf = cond?.park_factor;
  if (pf != null && (pf > 1.05 || pf < 0.95)) {
    const pct = (pf - 1) * 100;
    d.push({ label: pf > 1.05 ? 'HITTER PARK' : 'PITCHER PARK', summary: `Park run factor ${pf.toFixed(2)} (${sign(pct)}% runs)`, lines: [
      `Runs: ${(pf).toFixed(2)}x league average (${sign(pct)}%)`,
      ...(park?.factor_hr != null ? [`Home runs: ${Number(park.factor_hr).toFixed(2)}x league average (${sign((park.factor_hr - 1) * 100)}%)`] : []),
      '1.00 is a neutral park; above 1 favors hitters, below 1 favors pitchers.',
    ]});
  }
  return d;
}

// MLB trend drivers: baseball-relevant context chips from mlb_daily_conditions.
function buildMLBTrendDrivers(cond: any): string[] {
  const drivers: string[] = [];
  if (!cond) return drivers;
  if (cond.opp_starter_hand === 'L') drivers.push('vs LHP');
  else if (cond.opp_starter_hand === 'R') drivers.push('vs RHP');
  const pf = cond.park_factor;
  if (pf != null && pf > 1.05) drivers.push('HITTER PARK');
  else if (pf != null && pf < 0.95) drivers.push('PITCHER PARK');
  return drivers;
}

// Shared core: build the trending-player list with drivers, locked to window=10,
// pre-filtered to today's slate teams, with `out` players removed.
async function buildTrendingPayload(opts: {
  statFilter?: number;          // single stat ID filter (used by Trend Finder)
  thresholdMin?: number;        // optional rolling_avg floor
  limit: number;                // final result size after dedupe
  dedupePerPlayer: boolean;     // true for top-trending (one entry per player)
}, lg: LeagueConfig) {
  // NHL and NFL have per-game stats but no computed trends table. An empty
  // list is the honest answer; without this the query below asks Postgres for
  // a table literally named "null" and the client sees a schema-cache error.
  if (!lg.trendsTable) return [];

  const today = new Date().toISOString().slice(0, 10);

  // Step 1: today's slate (DB) + games for availability lookup.
  // NFL/NHL have a trends table but no conditions table (dailyConditionsTable
  // is null for them) — skip the lookup rather than passing null through, or
  // Postgres gets asked for a table literally named "null".
  const [gamesResult, conditionsDate] = await Promise.all([
    supabaseAdmin
      .from('games')
      .select('id, home_team_id, away_team_id')
      .eq('game_date', today)
      .eq('league_id', lg.leagueId),
    lg.dailyConditionsTable ? findNearestConditionsDate(today, lg.dailyConditionsTable) : null,
  ]);

  const todayGamesRaw = (gamesResult.data || []) as any[];
  const slateTeamIds = new Set<number>();
  for (const g of todayGamesRaw) {
    slateTeamIds.add(g.home_team_id);
    slateTeamIds.add(g.away_team_id);
  }

  const todayTeams = new Set<string>();
  if (slateTeamIds.size > 0) {
    const { data: slateTeamRows } = await supabaseAdmin
      .from('teams')
      .select('id, abbreviation')
      .in('id', [...slateTeamIds]);
    for (const t of (slateTeamRows || [])) {
      if (t.abbreviation) todayTeams.add(t.abbreviation.toUpperCase());
    }
  }

  const todayGames = todayGamesRaw;
  const gameIds = todayGames.map((g: any) => g.id);

  // Build availability sets keyed by game_id
  const outByGameId = new Map<number, Set<number>>();
  const outIds = new Set<number>();
  if (gameIds.length > 0) {
    const { data: outRows } = await supabaseAdmin
      .from('player_availability')
      .select('player_id, game_id, status')
      .in('game_id', gameIds);
    for (const r of (outRows || [])) {
      if (r.status !== 'out') continue;
      outIds.add(r.player_id);
      const set = outByGameId.get(r.game_id) ?? new Set<number>();
      set.add(r.player_id);
      outByGameId.set(r.game_id, set);
    }
  }

  // Step 2: query trends — locked to window_size=10
  let trendsQuery = supabaseAdmin
    .from(lg.trendsTable)
    .select('player_id, stat, window_size, trend_val, rolling_avg, season_avg, players!inner(name, team, position)')
    .order('trend_val', { ascending: false })
    .eq('window_size', 10)
    .in('stat', lg.validStatIds)
    .limit(300);

  if (opts.statFilter !== undefined) {
    trendsQuery = trendsQuery.eq('stat', opts.statFilter);
  }
  if (opts.thresholdMin !== undefined && opts.thresholdMin > 0) {
    trendsQuery = trendsQuery.gte('rolling_avg', opts.thresholdMin);
  }
  if (todayTeams.size > 0) {
    trendsQuery = trendsQuery.in('players.team', [...todayTeams]);
  }

  const trendsResult = await trendsQuery;
  if (trendsResult.error) throw trendsResult.error;

  const rows = (trendsResult.data || []) as any[];
  let filtered = rows.filter(row => !outIds.has(row.player_id));

  // Optional dedupe: keep one entry per player (their highest trend_val)
  if (opts.dedupePerPlayer) {
    const topPerPlayer = new Map<number, any>();
    for (const row of filtered) {
      const existing = topPerPlayer.get(row.player_id);
      if (!existing || row.trend_val > existing.trend_val) {
        topPerPlayer.set(row.player_id, row);
      }
    }
    filtered = Array.from(topPerPlayer.values())
      .sort((a, b) => b.trend_val - a.trend_val);
  }

  const top = filtered.slice(0, opts.limit);
  const playerIds = top.map((r) => r.player_id);

  // Step 3: fetch conditions rows for those players for the chosen date.
  // Column set is league-specific (NBA usage/pace vs MLB handedness/park).
  const condSelect = lg.slug === 'mlb'
    ? 'player_id, game_id, opp_starter_hand, opp_starter_id, park_factor, rolling_pa_5g'
    : 'player_id, game_id, rolling_usg_5g, season_avg_usg, rolling_min_5g, rolling_pace_5g';
  const condByPlayerId = new Map<number, any>();
  if (playerIds.length > 0 && lg.dailyConditionsTable) {
    const { data: condRows } = await supabaseAdmin
      .from(lg.dailyConditionsTable)
      .select(condSelect)
      .eq('game_date', conditionsDate)
      .in('player_id', playerIds);
    for (const r of ((condRows || []) as any[])) {
      // Latest wins if multiple — there should only be one per (player, date)
      condByPlayerId.set(r.player_id, r);
    }
  }

  // Step 3b: supporting numbers for the drill-down (names + season PPG of
  // injured teammates; arm quality of the opposing MLB starter).
  const outIdSet = new Set<number>();
  for (const set of outByGameId.values()) for (const id of set) outIdSet.add(id);
  const outInfo = new Map<number, { name: string; ppg: number | null }>();
  const starterInfo = new Map<number, { name: string; rank: number; total: number }>();
  if (lg.slug !== 'mlb' && outIdSet.size > 0) {
    const ids = [...outIdSet];
    const [{ data: pl }, { data: tr }] = await Promise.all([
      supabaseAdmin.from('players').select('id, name').in('id', ids),
      lg.trendsTable
        ? supabaseAdmin.from(lg.trendsTable).select('player_id, season_avg').in('player_id', ids).eq('stat', 0).eq('window_size', 10)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const ppg = new Map<number, number>();
    for (const t of (tr || []) as any[]) if (t.season_avg != null) ppg.set(t.player_id, Number(t.season_avg));
    for (const p of (pl || []) as any[]) outInfo.set(p.id, { name: p.name, ppg: ppg.get(p.id) ?? null });
  }
  if (lg.slug === 'mlb') {
    const starterIds = [...new Set([...condByPlayerId.values()].map((c) => c.opp_starter_id).filter((x) => x != null))];
    if (starterIds.length > 0) {
      const [{ data: pq }, { data: allQ }, { data: names }] = await Promise.all([
        supabaseAdmin.from('mlb_pitcher_quality').select('player_id, quality_rank, snapshot_date').in('player_id', starterIds).order('snapshot_date', { ascending: false }),
        supabaseAdmin.from('mlb_pitcher_quality').select('player_id').order('snapshot_date', { ascending: false }).limit(1000),
        supabaseAdmin.from('players').select('id, name').in('id', starterIds),
      ]);
      const total = new Set((allQ || []).map((r: any) => r.player_id)).size;
      const nm = new Map((names || []).map((n: any) => [n.id, n.name]));
      for (const r of (pq || []) as any[]) {
        if (!starterInfo.has(r.player_id) && r.quality_rank != null) {
          starterInfo.set(r.player_id, { name: nm.get(r.player_id) ?? 'Starter', rank: r.quality_rank, total });
        }
      }
    }
  }

  // Step 4: build final payload with trend_drivers
  const result = top.map((row: any) => {
    const cond = condByPlayerId.get(row.player_id);
    // Injury boost = any teammate marked 'out' on this player's game today.
    // We only have game_id from daily_conditions, so use that to check teammates.
    let injuryBoost = false;
    if (cond?.game_id) {
      const teammatesOut = outByGameId.get(cond.game_id);
      if (teammatesOut && teammatesOut.size > 0) {
        // any teammate (someone other than self) is out
        const others = Array.from(teammatesOut).filter((id) => id !== row.player_id);
        injuryBoost = others.length > 0;
      }
    }
    const drivers = lg.slug === 'mlb'
      ? buildMLBTrendDrivers(cond)
      : buildTrendDrivers(cond, injuryBoost);
    const outsForPlayer = cond?.game_id
      ? [...(outByGameId.get(cond.game_id) ?? [])]
          .filter((id) => id !== row.player_id)
          .map((id) => outInfo.get(id))
          .filter((o): o is { name: string; ppg: number | null } => !!o)
          .sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0))
      : [];
    const trendDriverDetails = lg.slug === 'mlb'
      ? buildMLBDriverDetails(cond, null, cond?.opp_starter_id != null ? starterInfo.get(cond.opp_starter_id) : null)
      : buildDriverDetails(cond, injuryBoost ? outsForPlayer : []);

    return {
      playerId: row.player_id,
      playerName: row.players?.name,
      team: row.players?.team,
      position: row.players?.position,
      stat: lg.trendStatNames[row.stat],
      statId: row.stat,
      zScore: Number(row.trend_val),
      rollingAvg: Number(row.rolling_avg),
      seasonAvg: row.season_avg != null ? Number(row.season_avg) : null,
      windowSize: row.window_size,
      trendDrivers: drivers,
      trendDriverDetails,
    };
  });

  return result;
}

export async function getTopTrending(_req: Request, res: Response) {
  try {
    const lg = resolveLeague(res);
    const result = await buildTrendingPayload({
      limit: 10,
      dedupePerPlayer: true,
    }, lg);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTrends(req: Request<{}, {}, {}, { stat?: string; window?: string; threshold?: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    // window is hard-locked to 10 — the legacy `window` query param is ignored.
    const { stat, threshold = '0' } = req.query;

    let statFilter: number | undefined;
    if (stat !== undefined) {
      const statEntry = Object.entries(lg.trendStatNames).find(([, name]) => name === stat);
      if (statEntry) statFilter = parseInt(statEntry[0]);
    }

    const thresholdNum = parseFloat(threshold);

    const result = await buildTrendingPayload({
      statFilter,
      thresholdMin: thresholdNum > 0 ? thresholdNum : undefined,
      limit: 50,
      dedupePerPlayer: false,
    }, lg);

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function searchPlayers(req: Request<{}, {}, {}, { q?: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const { q = '' } = req.query;
    if (q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const { data, error } = await supabaseAdmin
      .from('players')
      .select('id, name, team, position')
      .ilike('name', `%${q}%`)
      .eq('league', lg.playerLeagueTag)
      .eq('is_active', true)
      .limit(10);

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// MLB pitchers never bat, so their game logs come from the pitching columns of
// mlb_player_stats and are gated on batters_faced (not plate_appearances).
const MLB_PITCHER_SELECT =
  'game_id, team_id, strikeouts_pitched, outs_pitched, earned_runs, hits_allowed, ' +
  'walks_allowed, home_runs_allowed, batters_faced, game_date, games!inner(game_type, season)';

/** Start of the season two before the current one: three seasons of history. */
function threeSeasonStart(lg: LeagueConfig): string {
  const start = seasonStartFor(lg);
  return `${Number(start.slice(0, 4)) - 2}${start.slice(4)}`;
}

export async function getPlayerGames(req: Request<{ id: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const { id } = req.params;
    const logLimit = resolveLogLimit(req.query.window);

    // Season window and game-type vocabulary both vary by league; they live in
    // the registry so adding a sport does not mean editing this controller.
    // Three seasons of history, each row tagged with its season; the client
    // scopes L-N windows and season averages to a single season so a window
    // never spills back into the prior one.
    const seasonStart = threeSeasonStart(lg);
    const gameTypes = lg.gameTypes;

    // Fetch the player first: for MLB we branch the stat query on whether they
    // pitch. Pitchers never bat, so the batting "appeared" gate would exclude
    // them entirely — we chart their pitching line (Ks, outs, ER…) instead.
    const playerResult = await supabaseAdmin
      .from('players')
      .select('id, name, team, position, league')
      .eq('id', parseInt(id))
      .single();
    if (playerResult.error) throw playerResult.error;

    const isPitcher =
      lg.slug === 'mlb' &&
      /^(p|sp|rp|lhp|rhp)$/i.test(((playerResult.data as any)?.position || '').trim());

    const select = isPitcher ? MLB_PITCHER_SELECT : lg.playerGameSelect;
    const gate = isPitcher ? { col: 'batters_faced', min: 0 } : lg.playedGate;

    // NFL has no single "appeared" column, so its gate is null and every row
    // for the player counts as an appearance.
    const applyGate = (q: any): any => (gate ? q.gt(gate.col, gate.min) : q);

    const [statsResult, trendsResult, allSeasonStats] = await Promise.all([
      applyGate(
        supabaseAdmin
          .from(lg.statsTable)
          .select(select)
          .eq('player_id', parseInt(id))
          .gte('game_date', seasonStart)
          .in('games.game_type', gameTypes)
          .order('game_date', { ascending: false })
          .limit(logLimit ?? 5000)
      ),
      // NFL and NHL have no trends table; skip the query rather than error.
      lg.trendsTable
        ? supabaseAdmin
            .from(lg.trendsTable)
            .select('stat, trend_val, rolling_avg, window_size')
            .eq('player_id', parseInt(id))
            .eq('window_size', 10)
        : Promise.resolve({ data: [] as any[], error: null }),
      applyGate(
        supabaseAdmin
          .from(lg.statsTable)
          .select(select)
          .eq('player_id', parseInt(id))
          .gte('game_date', seasonStart)
          .in('games.game_type', gameTypes)
      ),
    ]);

    if (statsResult.error) throw statsResult.error;
    if (lg.trendsTable && trendsResult.error) throw trendsResult.error;

    const zScores: Record<string, number> = {};
    const rollingAvgs: Record<string, number> = {};
    for (const t of (trendsResult.data || [])) {
      const statName = lg.trendStatNames[t.stat];
      if (statName) {
        zScores[statName] = t.trend_val;
        rollingAvgs[statName] = t.rolling_avg;
      }
    }

    // Per-league season-average columns (DB column -> output stat name)
    const seasonAvgCols: Record<string, string> = isPitcher
      ? {
          strikeouts_pitched: 'strikeouts_pitched',
          outs_pitched: 'outs_pitched',
          earned_runs: 'earned_runs',
          hits_allowed: 'hits_allowed',
          walks_allowed: 'walks_allowed',
        }
      : lg.slug === 'mlb'
      ? { hits: 'hits', total_bases: 'total_bases', rbi: 'rbi', runs: 'runs', home_runs: 'home_runs' }
      : lg.slug === 'nhl'
      ? { goals: 'goals', assists: 'assists', points: 'points', shots_on_goal: 'shots_on_goal',
          blocks: 'blocks', hits: 'hits', toi_seconds: 'toi_seconds' }
      : lg.slug === 'nfl'
      ? { passing_yards: 'passing_yards', rushing_yards: 'rushing_yards',
          receiving_yards: 'receiving_yards', receptions: 'receptions',
          tackles_total: 'tackles_total' }
      : { points: 'points', rebounds: 'rebounds', assists: 'assists', three_points_made: 'threes' };

    const allRows = allSeasonStats.data || [];
    // The player's active season is the latest one they actually appeared in:
    // a preseason-only or injured player shows last season rather than nothing.
    const seasonOf = (r: any): number | null => r.games?.season ?? null;
    const seasons = [...new Set(allRows.map(seasonOf).filter((x: any) => x != null))].sort(
      (a: any, b: any) => b - a
    ) as number[];
    const currentSeason = seasons[0] ?? null;
    const seasonRows = allRows.filter((r: any) => seasonOf(r) === currentSeason);
    const seasonAvgs: Record<string, number> = {};
    if (seasonRows.length > 0) {
      const sum = (key: string) => seasonRows.reduce((acc: number, r: any) => acc + (r[key] ?? 0), 0);
      for (const [col, name] of Object.entries(seasonAvgCols)) {
        seasonAvgs[name] = Math.round((sum(col) / seasonRows.length) * 10) / 10;
      }
    }

    // Resolve opponent abbreviations for the recent games
    const statsRows = statsResult.data || [];
    const gameIds = [...new Set(statsRows.map((s: any) => s.game_id).filter((g: any) => g != null))];
    const opponentByGameId: Record<number, string> = {};
    const isHomeByGameId: Record<number, boolean> = {};
    let playerTeamId: number | null = null;
    // Hoisted so the upcoming-game lookup below can reuse resolved abbreviations.
    const abbrById: Record<number, string> = {};
    if (gameIds.length > 0) {
      const { data: gameRows } = await supabaseAdmin
        .from('games')
        .select('id, home_team_id, away_team_id')
        .in('id', gameIds as number[]);
      const teamIds = new Set<number>();
      (gameRows || []).forEach((g: any) => {
        teamIds.add(g.home_team_id);
        teamIds.add(g.away_team_id);
      });
      const { data: teamRows } = await supabaseAdmin
        .from('teams')
        .select('id, abbreviation')
        .in('id', Array.from(teamIds));
      (teamRows || []).forEach((t: any) => { abbrById[t.id] = t.abbreviation; });
      const gameById: Record<number, any> = {};
      (gameRows || []).forEach((g: any) => { gameById[g.id] = g; });
      for (const s of statsRows) {
        const g = gameById[(s as any).game_id];
        if (!g) continue;
        const myTeamId = (s as any).team_id;
        if (playerTeamId == null) playerTeamId = myTeamId;
        const oppId = g.home_team_id === myTeamId ? g.away_team_id : g.home_team_id;
        isHomeByGameId[(s as any).game_id] = g.home_team_id === myTeamId;
        const abbr = abbrById[oppId];
        if (abbr) opponentByGameId[(s as any).game_id] = abbr;
      }
    }

    // Next scheduled game for the player's team. Most leagues are out of season
    // for much of the year, so this is frequently null and the client falls back
    // to a user-selected opponent.
    let upcoming: ReturnType<typeof buildUpcoming> = null;
    // The team the player is on NOW: their last logged game may be from a
    // prior team (trade/offseason move), which would point "next game" at the
    // wrong club. Falls back to the last logged team when the abbreviation
    // doesn't resolve.
    const currentAbbr = (playerResult.data as any)?.team;
    if (currentAbbr) {
      const { data: curTeam } = await supabaseAdmin
        .from('teams').select('id')
        .eq('league_id', lg.leagueId).eq('abbreviation', currentAbbr).maybeSingle();
      if (curTeam) playerTeamId = (curTeam as any).id;
    }
    if (playerTeamId != null) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: nextGames } = await supabaseAdmin
        .from('games')
        .select('id, game_date, home_team_id, away_team_id')
        .eq('league_id', lg.leagueId)
        .gte('game_date', today)
        .or(`home_team_id.eq.${playerTeamId},away_team_id.eq.${playerTeamId}`)
        .order('game_date', { ascending: true })
        .limit(1);
      const next = (nextGames || [])[0] as any;
      if (next) {
        const oppId = next.home_team_id === playerTeamId ? next.away_team_id : next.home_team_id;
        if (abbrById[oppId] == null) {
          const { data: oppTeam } = await supabaseAdmin
            .from('teams').select('id, abbreviation').eq('id', oppId).single();
          if (oppTeam) abbrById[(oppTeam as any).id] = (oppTeam as any).abbreviation;
        }
        const lastPlayed = statsRows.length > 0 ? (statsRows[0] as any).game_date : null;
        upcoming = buildUpcoming(next, playerTeamId, abbrById, lastPlayed);
      }
    }

    res.json({
      success: true,
      data: {
        player: playerResult.data,
        teamId: playerTeamId,
        isPitcher,
        games: statsRows.map((g: any) => {
          const base = {
            gameId: g.game_id,
            date: g.game_date,
            season: g.games?.season ?? undefined,
            opponent: opponentByGameId[g.game_id] ?? undefined,
            isHome: isHomeByGameId[g.game_id] ?? undefined,
          };
          if (isPitcher) {
            return {
              ...base,
              strikeoutsPitched: g.strikeouts_pitched,
              outsPitched: g.outs_pitched,
              earnedRuns: g.earned_runs,
              hitsAllowed: g.hits_allowed,
              walksAllowed: g.walks_allowed,
              homeRunsAllowed: g.home_runs_allowed,
              battersFaced: g.batters_faced,
            };
          }
          if (lg.slug === 'mlb') {
            return {
              ...base,
              hits: g.hits, totalBases: g.total_bases, rbi: g.rbi,
              runs: g.runs, homeRuns: g.home_runs, strikeouts: g.strikeouts,
              plateAppearances: g.plate_appearances,
            };
          }
          if (lg.slug === 'nhl') {
            return {
              ...base,
              goals: g.goals, assists: g.assists, points: g.points,
              shotsOnGoal: g.shots_on_goal, blocks: g.blocks, hits: g.hits,
              plusMinus: g.plus_minus, pim: g.pim,
              takeaways: g.takeaways, giveaways: g.giveaways,
              toiSeconds: g.toi_seconds, ppToiSeconds: g.pp_toi_seconds,
              positionType: g.position_type,
              saves: g.saves, shotsAgainst: g.shots_against,
              goalsAgainst: g.goals_against, savePct: g.save_pct,
              goalieToiSeconds: g.goalie_toi_seconds,
            };
          }
          if (lg.slug === 'nfl') {
            return {
              ...base,
              completions: g.completions, attempts: g.attempts,
              passingYards: g.passing_yards, passingTds: g.passing_tds,
              interceptions: g.interceptions,
              carries: g.carries, rushingYards: g.rushing_yards, rushingTds: g.rushing_tds,
              receptions: g.receptions, targets: g.targets,
              receivingYards: g.receiving_yards, receivingTds: g.receiving_tds,
              fumblesLost: g.fumbles_lost,
              tacklesTotal: g.tackles_total, sacks: g.sacks,
              fgMade: g.fg_made, fgAtt: g.fg_att,
            };
          }
          return {
            ...base,
            points: g.points,
            rebounds: g.rebounds,
            assists: g.assists,
            threes: g.three_points_made,
            fouls: g.fouls,
            minutes: g.minutes_played,
          };
        }),
        zScores,
        rollingAvgs,
        seasonAvgs,
        gamesPlayed: seasonRows.length,
        currentSeason,
        seasons,
        upcoming,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ESPN uses different abbreviations than the NBA API (which our DB stores).
// This map normalizes ESPN abbreviations to match DB values.
const ESPN_TO_DB_ABBR: Record<string, string> = {
  GS:   'GSW',
  NO:   'NOP',
  NY:   'NYK',
  SA:   'SAS',
  UTAH: 'UTA',
  WSH:  'WAS',
};

// Today's slate served from the DB games table (populated by the nightly slate
// sync). Used by every league except NBA, which has a live ESPN feed. Mirrors
// the ESPN-backed shape: { gameId, dbId, date, time, status, home/away }.
//
// When today is empty the next scheduled date is returned instead, so the
// ticker still has something during an off day. Each row carries its own
// `date` so the caller can label a substituted slate honestly rather than
// presenting next week's games as tonight's.
async function getTodaysGamesFromDb(res: Response) {
  const lg = resolveLeague(res);
  const today = sportsDay();

  const selectCols =
    'id, ext_id, game_date, game_time, status, home_team_id, away_team_id, home_score, away_score';

  let { data: dbGames } = await supabaseAdmin
    .from('games')
    .select(selectCols)
    .eq('game_date', today)
    .eq('league_id', lg.leagueId);

  // Nothing today: fall back to the nearest slate, preferring an upcoming one
  // but accepting the most recent past one. Looking only forward leaves the
  // ticker permanently empty once a season ends.
  if (!dbGames?.length) {
    const [upcoming, previous] = await Promise.all([
      supabaseAdmin
        .from('games')
        .select('game_date')
        .eq('league_id', lg.leagueId)
        .gt('game_date', today)
        .order('game_date', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('games')
        .select('game_date')
        .eq('league_id', lg.leagueId)
        .lt('game_date', today)
        .order('game_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const fallbackDate = upcoming.data?.game_date ?? previous.data?.game_date;
    if (fallbackDate) {
      const { data: fallbackGames } = await supabaseAdmin
        .from('games')
        .select(selectCols)
        .eq('game_date', fallbackDate)
        .eq('league_id', lg.leagueId);
      dbGames = fallbackGames ?? [];
    }
  }

  const teamIds = new Set<number>();
  for (const g of (dbGames || [])) { teamIds.add(g.home_team_id); teamIds.add(g.away_team_id); }
  const { data: teamRows } = teamIds.size
    ? await supabaseAdmin.from('teams').select('id, abbreviation').in('id', [...teamIds])
    : { data: [] as any[] };
  const abbrById: Record<number, string> = {};
  for (const t of (teamRows || [])) abbrById[t.id] = t.abbreviation;
  // The stored status code lags the data — plenty of played games are still
  // flagged 0. Scores are the reliable signal, so they win; a past game with
  // no score is reported as a gap rather than mislabelled "Scheduled".
  const statusLabel = (g: any): string => {
    if (g.status === 1) return 'Live';
    if (g.home_score != null && g.away_score != null) return 'Final';
    return g.game_date < today ? 'No score' : 'Scheduled';
  };

  const games = (dbGames || []).map((g: any) => ({
    gameId: g.ext_id,
    dbId: g.id,
    date: g.game_date,
    time: g.game_time ?? null,
    status: statusLabel(g),
    live: g.status === 1,
    home: { team: abbrById[g.home_team_id] ?? '', score: g.home_score ?? '' },
    away: { team: abbrById[g.away_team_id] ?? '', score: g.away_score ?? '' },
  }));
  res.json({ success: true, data: games });
}

export async function getTodaysGames(_req: Request, res: Response) {
  try {
    // Only NBA has a live ESPN scoreboard wired up; the rest read the synced
    // schedule. Previously NHL and NFL fell through to the NBA branch and
    // silently returned basketball games.
    if (resolveLeague(res).slug !== 'nba') {
      return await getTodaysGamesFromDb(res);
    }
    // Ask ESPN for the sports day explicitly; its default "today" and our DB's
    // ET game_date can disagree around midnight.
    const today = sportsDay();
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today.replace(/-/g, '')}`
    );
    if (!response.ok) throw new Error(`ESPN API error: ${response.status}`);
    const json = await response.json() as any;

    // Map abbreviation -> team_id
    const { data: teamRows } = await supabaseAdmin
      .from('teams')
      .select('id, abbreviation');
    const teamIdByAbbr: Record<string, number> = {};
    (teamRows || []).forEach((t: any) => { teamIdByAbbr[t.abbreviation] = t.id; });

    // Today's games for matching
    const { data: dbGames } = await supabaseAdmin
      .from('games')
      .select('id, game_date, home_team_id, away_team_id')
      .eq('game_date', today)
      .eq('league_id', 1);
    const dbGameByPair: Record<string, number> = {};
    (dbGames || []).forEach((g: any) => {
      dbGameByPair[`${g.home_team_id}-${g.away_team_id}`] = g.id;
    });

    const games = (json.events || []).flatMap((event: any) => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      const rawHomeAbbr = home?.team?.abbreviation || '';
      const rawAwayAbbr = away?.team?.abbreviation || '';
      const homeAbbr = ESPN_TO_DB_ABBR[rawHomeAbbr] ?? rawHomeAbbr;
      const awayAbbr = ESPN_TO_DB_ABBR[rawAwayAbbr] ?? rawAwayAbbr;
      const homeId = teamIdByAbbr[homeAbbr];
      const awayId = teamIdByAbbr[awayAbbr];
      const dbId = (homeId != null && awayId != null) ? dbGameByPair[`${homeId}-${awayId}`] : undefined;
      // Only include games that exist in our DB for today
      if (!dbId) return [];
      return [{
        gameId: event.id,
        dbId,
        date: today,
        time: comp?.date,
        status: event.status?.type?.shortDetail || 'Scheduled',
        live: event.status?.type?.state === 'in',
        home: { team: homeAbbr, score: home?.score || '' },
        away: { team: awayAbbr, score: away?.score || '' },
      }];
    });

    // No NBA game tonight — fall back to the synced schedule so the ticker can
    // show the next slate rather than nothing.
    if (games.length === 0) {
      return await getTodaysGamesFromDb(res);
    }

    res.json({ success: true, data: games });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTodaysPicks(_req: Request, res: Response) {
  try {
    const lg = resolveLeague(res);
    const today = new Date().toISOString().slice(0, 10);

    // Find nearest date (upcoming first, else past) WITH picks for this league,
    // so a late-night UTC rollover doesn't blank the card.
    const pickDate = await findNearestPickDate(today, lg.leagueId);

    const { data: pickRows, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id, entity_id, stat, pick_type, recommended_line, hit_rate, ' +
        'sample_size, confidence_score, implied_prob, edge, ' +
        'conditions_matched, total_conditions'
      )
      .eq('game_date', pickDate)
      .eq('prop_type', 'player')
      .eq('league_id', lg.leagueId)
      .order('confidence_score', { ascending: false });

    if (error) throw error;

    if (!pickRows || pickRows.length === 0) {
      return res.json({ success: true, data: { topPick: null, allPicks: [], gameDate: pickDate } });
    }

    const playerIds = [...new Set((pickRows as any[]).map((r) => r.entity_id))];
    const { data: playerRows } = await supabaseAdmin
      .from('players')
      .select('id, name, team, position')
      .in('id', playerIds);

    const playerMap: Record<number, any> = {};
    for (const p of (playerRows || [])) playerMap[p.id] = p;

    const { data: todayGames } = await supabaseAdmin
      .from('games')
      .select('id')
      .eq('game_date', today)
      .eq('league_id', lg.leagueId);

    const todayGameIds = (todayGames || []).map((g: any) => g.id);

    const outIds = new Set<number>();
    if (todayGameIds.length > 0) {
      const { data: outRows } = await supabaseAdmin
        .from('player_availability')
        .select('player_id')
        .eq('status', 'out')
        .in('game_id', todayGameIds);

      for (const r of (outRows || [])) outIds.add(r.player_id);
    }

    const picks = (pickRows as any[])
      .filter((row) => !outIds.has(row.entity_id))
      .map((row) => {
        const player = playerMap[row.entity_id] || {};
        return {
          pickId: row.id,
          playerId: row.entity_id,
          playerName: player.name ?? null,
          team: player.team ?? null,
          position: player.position ?? null,
          stat: row.stat,
          statLabel: lg.statLabels[row.stat] ?? row.stat.toUpperCase(),
          pickType: row.pick_type,
          recommendedLine: row.recommended_line,
          confidence: row.confidence_score,
          edge: row.edge,
          hitRate: row.hit_rate,
          impliedProb: row.implied_prob,
          sampleSize: row.sample_size,
          conditionsMatched: row.conditions_matched,
          totalConditions: row.total_conditions,
        };
      });

    res.json({
      success: true,
      data: {
        gameDate: pickDate,
        topPick: picks[0] ?? null,
        allPicks: picks,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getPlayerPicks(req: Request<{ id: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const { id } = req.params;
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const fromDate = from.toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id, game_date, entity_id, stat, pick_type, recommended_line, ' +
        'hit_rate, confidence_score, implied_prob, edge, actual_result, did_hit'
      )
      .eq('entity_id', parseInt(id))
      .eq('prop_type', 'player')
      .eq('league_id', lg.leagueId)
      .gte('game_date', fromDate)
      .order('game_date', { ascending: false });

    if (error) throw error;

    const picks = (data || []).map((row: any) => ({
      pickId: row.id,
      date: row.game_date,
      stat: row.stat,
      statLabel: lg.statLabels[row.stat] ?? row.stat.toUpperCase(),
      pickType: row.pick_type,
      recommendedLine: row.recommended_line,
      confidence: row.confidence_score,
      hitRate: row.hit_rate,
      impliedProb: row.implied_prob,
      edge: row.edge,
      actualResult: row.actual_result,
      didHit: row.did_hit,
    }));

    res.json({ success: true, data: picks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
