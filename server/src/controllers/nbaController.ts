import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { STAT_LABELS, TREND_STAT_NAMES, VALID_STAT_IDS } from '../constants/stats';
import { findNearestConditionsDate } from '../utils/dateQueries';

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

// Shared core: build the trending-player list with drivers, locked to window=10,
// pre-filtered to today's slate teams, with `out` players removed.
async function buildTrendingPayload(opts: {
  statFilter?: number;          // single stat ID filter (used by Trend Finder)
  thresholdMin?: number;        // optional rolling_avg floor
  limit: number;                // final result size after dedupe
  dedupePerPlayer: boolean;     // true for top-trending (one entry per player)
}) {
  const today = new Date().toISOString().slice(0, 10);

  // Step 1: today's slate (DB) + games for availability lookup
  const [gamesResult, conditionsDate] = await Promise.all([
    supabaseAdmin
      .from('games')
      .select('id, home_team_id, away_team_id')
      .eq('game_date', today)
      .eq('league_id', 1),
    findNearestConditionsDate(today),
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
    .from('nba_trends')
    .select('player_id, stat, window_size, trend_val, rolling_avg, season_avg, players!inner(name, team, position)')
    .order('trend_val', { ascending: false })
    .eq('window_size', 10)
    .in('stat', VALID_STAT_IDS)
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

  // Step 3: fetch daily_conditions rows for those players for the chosen date
  const condByPlayerId = new Map<number, any>();
  if (playerIds.length > 0) {
    const { data: condRows } = await supabaseAdmin
      .from('daily_conditions')
      .select('player_id, game_id, rolling_usg_5g, season_avg_usg, rolling_min_5g, rolling_pace_5g')
      .eq('game_date', conditionsDate)
      .in('player_id', playerIds);
    for (const r of (condRows || [])) {
      // Latest wins if multiple — there should only be one per (player, date)
      condByPlayerId.set(r.player_id, r);
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
    const drivers = buildTrendDrivers(cond, injuryBoost);

    return {
      playerId: row.player_id,
      playerName: row.players?.name,
      team: row.players?.team,
      position: row.players?.position,
      stat: TREND_STAT_NAMES[row.stat],
      statId: row.stat,
      zScore: Number(row.trend_val),
      rollingAvg: Number(row.rolling_avg),
      seasonAvg: row.season_avg != null ? Number(row.season_avg) : null,
      windowSize: row.window_size,
      trendDrivers: drivers,
    };
  });

  return result;
}

export async function getTopTrending(_req: Request, res: Response) {
  try {
    const result = await buildTrendingPayload({
      limit: 10,
      dedupePerPlayer: true,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTrends(req: Request<{}, {}, {}, { stat?: string; window?: string; threshold?: string }>, res: Response) {
  try {
    // window is hard-locked to 10 — the legacy `window` query param is ignored.
    const { stat, threshold = '0' } = req.query;

    let statFilter: number | undefined;
    if (stat !== undefined) {
      const statEntry = Object.entries(TREND_STAT_NAMES).find(([, name]) => name === stat);
      if (statEntry) statFilter = parseInt(statEntry[0]);
    }

    const thresholdNum = parseFloat(threshold);

    const result = await buildTrendingPayload({
      statFilter,
      thresholdMin: thresholdNum > 0 ? thresholdNum : undefined,
      limit: 50,
      dedupePerPlayer: false,
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function searchPlayers(req: Request<{}, {}, {}, { q?: string }>, res: Response) {
  try {
    const { q = '' } = req.query;
    if (q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const { data, error } = await supabaseAdmin
      .from('players')
      .select('id, name, team, position')
      .ilike('name', `%${q}%`)
      .eq('league', 'nba')
      .eq('is_active', true)
      .limit(10);

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getPlayerGames(req: Request<{ id: string }>, res: Response) {
  try {
    const { id } = req.params;

    const seasonStart = (() => {
      const today = new Date();
      const year = today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1;
      return `${year}-10-01`;
    })();

    const [playerResult, statsResult, trendsResult, allSeasonStats] = await Promise.all([
      supabaseAdmin
        .from('players')
        .select('id, name, team, position')
        .eq('id', parseInt(id))
        .single(),
      supabaseAdmin
        .from('nba_player_stats')
        .select('game_id, team_id, points, rebounds, assists, three_points_made, fouls, minutes_played, game_date, games!inner(game_type)')
        .eq('player_id', parseInt(id))
        .in('games.game_type', ['regular', 'playoff', 'playin'])
        .gt('minutes_played', 0)
        .order('game_date', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('nba_trends')
        .select('stat, trend_val, rolling_avg, window_size')
        .eq('player_id', parseInt(id))
        .eq('window_size', 10),
      supabaseAdmin
        .from('nba_player_stats')
        .select('points, rebounds, assists, three_points_made, games!inner(game_type)')
        .eq('player_id', parseInt(id))
        .gte('game_date', seasonStart)
        .in('games.game_type', ['regular', 'playoff', 'playin'])
        .gt('minutes_played', 0),
    ]);

    if (playerResult.error) throw playerResult.error;
    if (statsResult.error) throw statsResult.error;
    if (trendsResult.error) throw trendsResult.error;

    const zScores: Record<string, number> = {};
    const rollingAvgs: Record<string, number> = {};
    for (const t of (trendsResult.data || [])) {
      const statName = TREND_STAT_NAMES[t.stat];
      if (statName) {
        zScores[statName] = t.trend_val;
        rollingAvgs[statName] = t.rolling_avg;
      }
    }

    const seasonRows = allSeasonStats.data || [];
    const seasonAvgs: Record<string, number> = {};
    if (seasonRows.length > 0) {
      const sum = (key: string) => seasonRows.reduce((acc: number, r: any) => acc + (r[key] ?? 0), 0);
      seasonAvgs['points']   = Math.round((sum('points')            / seasonRows.length) * 10) / 10;
      seasonAvgs['rebounds'] = Math.round((sum('rebounds')          / seasonRows.length) * 10) / 10;
      seasonAvgs['assists']  = Math.round((sum('assists')           / seasonRows.length) * 10) / 10;
      seasonAvgs['threes']   = Math.round((sum('three_points_made') / seasonRows.length) * 10) / 10;
    }

    // Resolve opponent abbreviations for the recent games
    const statsRows = statsResult.data || [];
    const gameIds = [...new Set(statsRows.map((s: any) => s.game_id).filter((g: any) => g != null))];
    const opponentByGameId: Record<number, string> = {};
    let playerTeamId: number | null = null;
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
      const abbrById: Record<number, string> = {};
      (teamRows || []).forEach((t: any) => { abbrById[t.id] = t.abbreviation; });
      const gameById: Record<number, any> = {};
      (gameRows || []).forEach((g: any) => { gameById[g.id] = g; });
      for (const s of statsRows) {
        const g = gameById[(s as any).game_id];
        if (!g) continue;
        const myTeamId = (s as any).team_id;
        if (playerTeamId == null) playerTeamId = myTeamId;
        const oppId = g.home_team_id === myTeamId ? g.away_team_id : g.home_team_id;
        const abbr = abbrById[oppId];
        if (abbr) opponentByGameId[(s as any).game_id] = abbr;
      }
    }

    res.json({
      success: true,
      data: {
        player: playerResult.data,
        teamId: playerTeamId,
        games: statsRows.map((g: any) => ({
          gameId: g.game_id,
          date: g.game_date,
          opponent: opponentByGameId[g.game_id] ?? undefined,
          points: g.points,
          rebounds: g.rebounds,
          assists: g.assists,
          threes: g.three_points_made,
          fouls: g.fouls,
          minutes: g.minutes_played,
        })),
        zScores,
        rollingAvgs,
        seasonAvgs,
        gamesPlayed: seasonRows.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTodaysGames(_req: Request, res: Response) {
  try {
    const response = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
    );
    if (!response.ok) throw new Error(`ESPN API error: ${response.status}`);
    const json = await response.json() as any;

    const today = new Date().toISOString().slice(0, 10);
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
      const homeAbbr = home?.team?.abbreviation || '';
      const awayAbbr = away?.team?.abbreviation || '';
      const homeId = teamIdByAbbr[homeAbbr];
      const awayId = teamIdByAbbr[awayAbbr];
      const dbId = (homeId != null && awayId != null) ? dbGameByPair[`${homeId}-${awayId}`] : undefined;
      // Only include games that exist in our DB for today
      if (!dbId) return [];
      return [{
        gameId: event.id,
        dbId,
        time: comp?.date,
        status: event.status?.type?.shortDetail || 'Scheduled',
        home: { team: homeAbbr, score: home?.score || '' },
        away: { team: awayAbbr, score: away?.score || '' },
      }];
    });

    res.json({ success: true, data: games });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTodaysPicks(_req: Request, res: Response) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Find nearest upcoming date that has picks, so a late-night UTC rollover
    // doesn't blank the card when the pipeline ran for the previous calendar day.
    const { data: nearestRow } = await supabaseAdmin
      .from('pick_results')
      .select('game_date')
      .gte('game_date', today)
      .order('game_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    // Fall back to the most recent past date if nothing upcoming
    const { data: pastRow } = !nearestRow
      ? await supabaseAdmin
          .from('pick_results')
          .select('game_date')
          .lt('game_date', today)
          .order('game_date', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    const pickDate = nearestRow?.game_date ?? pastRow?.game_date ?? today;

    const { data: pickRows, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id, entity_id, stat, pick_type, recommended_line, hit_rate, ' +
        'sample_size, confidence_score, implied_prob, edge, ' +
        'conditions_matched, total_conditions'
      )
      .eq('game_date', pickDate)
      .eq('prop_type', 'player')
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
      .eq('league_id', 1);

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
          statLabel: STAT_LABELS[row.stat] ?? row.stat.toUpperCase(),
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
      .gte('game_date', fromDate)
      .order('game_date', { ascending: false });

    if (error) throw error;

    const picks = (data || []).map((row: any) => ({
      pickId: row.id,
      date: row.game_date,
      stat: row.stat,
      statLabel: STAT_LABELS[row.stat] ?? row.stat.toUpperCase(),
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
