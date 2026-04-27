import { supabaseAdmin } from '../config/supabaseAdmin';

const STAT_NAMES: Record<number, string> = {
  0: 'points', 1: 'rebounds', 2: 'assists', 3: 'threes',
};

// stat IDs that are computed and displayed
const VALID_STAT_IDS = [0, 1, 2, 3];

const PICK_STAT_LABELS: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM',
};

export async function getTopTrending(req: any, res: any) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Fetch trending rows, today's games, and player availability in parallel
    const [trendsResult, espnResult, gamesResult] = await Promise.all([
      supabaseAdmin
        .from('nba_trends')
        .select('player_id, stat, window_size, trend_val, rolling_avg, season_avg, players(name, team, position)')
        .order('trend_val', { ascending: false })
        .eq('window_size', 10)
        .in('stat', VALID_STAT_IDS)
        .limit(80),
      fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard')
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      supabaseAdmin
        .from('games')
        .select('id')
        .eq('game_date', today)
        .eq('league_id', 1),
    ]);

    if (trendsResult.error) throw trendsResult.error;

    // Build set of teams playing today from ESPN
    const todayTeams = new Set<string>();
    const espnEvents = (espnResult as any)?.events || [];
    for (const event of espnEvents) {
      const comp = event.competitions?.[0];
      for (const c of (comp?.competitors || [])) {
        const abbr = c.team?.abbreviation;
        if (abbr) todayTeams.add(abbr.toUpperCase());
      }
    }

    // Build set of player_ids that are out today
    const outIds = new Set<number>();
    const gameIds = (gamesResult.data || []).map((g: any) => g.id);
    if (gameIds.length > 0) {
      const { data: outRows } = await supabaseAdmin
        .from('player_availability')
        .select('player_id')
        .eq('status', 'out')
        .in('game_id', gameIds);
      for (const r of (outRows || [])) outIds.add(r.player_id);
    }

    const rows = (trendsResult.data || []) as any[];
    const filtered = todayTeams.size > 0
      ? rows.filter(row => {
          const team = (row.players?.team || '').toUpperCase();
          return todayTeams.has(team) && !outIds.has(row.player_id);
        })
      : rows.filter(row => !outIds.has(row.player_id));

    // Deduplicate: one entry per player, their highest-z_score stat
    const topPerPlayer = new Map<number, any>();
    for (const row of filtered) {
      const existing = topPerPlayer.get(row.player_id);
      if (!existing || row.trend_val > existing.trend_val) {
        topPerPlayer.set(row.player_id, row);
      }
    }
    const deduped = Array.from(topPerPlayer.values())
      .sort((a, b) => b.trend_val - a.trend_val);

    const result = deduped.slice(0, 10).map((row: any) => ({
      playerId: row.player_id,
      playerName: row.players?.name,
      team: row.players?.team,
      position: row.players?.position,
      stat: STAT_NAMES[row.stat],
      statId: row.stat,
      zScore: row.trend_val,
      rollingAvg: row.rolling_avg,
      seasonAvg: row.season_avg,
      windowSize: row.window_size,
    }));

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTrends(req: any, res: any) {
  try {
    const { stat, window = '10', threshold = '0' } = req.query as Record<string, string>;

    const [trendsResult, espnResult] = await Promise.all([
      (() => {
        let query = supabaseAdmin
          .from('nba_trends')
          .select('player_id, stat, window_size, trend_val, rolling_avg, season_avg, players(name, team, position)')
          .eq('window_size', parseInt(window))
          .in('stat', VALID_STAT_IDS)
          .order('trend_val', { ascending: false });

        if (stat !== undefined) {
          const statEntry = Object.entries(STAT_NAMES).find(([, name]) => name === stat);
          if (statEntry) query = query.eq('stat', parseInt(statEntry[0]));
        }

        const thresholdNum = parseFloat(threshold);
        if (thresholdNum > 0) query = query.gte('rolling_avg', thresholdNum);

        return query;
      })(),
      fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard')
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    ]);

    if (trendsResult.error) throw trendsResult.error;

    const todayTeams = new Set<string>();
    for (const event of ((espnResult as any)?.events || [])) {
      for (const c of (event.competitions?.[0]?.competitors || [])) {
        const abbr = c.team?.abbreviation;
        if (abbr) todayTeams.add(abbr.toUpperCase());
      }
    }

    const rows = (trendsResult.data || []) as any[];
    const filtered = todayTeams.size > 0
      ? rows.filter(row => todayTeams.has((row.players?.team || '').toUpperCase()))
      : rows;

    const result = filtered.map((row: any) => ({
      playerId: row.player_id,
      playerName: row.players?.name,
      team: row.players?.team,
      position: row.players?.position,
      stat: STAT_NAMES[row.stat],
      statId: row.stat,
      zScore: row.trend_val,
      rollingAvg: row.rolling_avg,
      seasonAvg: row.season_avg,
      windowSize: row.window_size,
    }));

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function searchPlayers(req: any, res: any) {
  try {
    const { q = '' } = req.query as Record<string, string>;
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

export async function getPlayerGames(req: any, res: any) {
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
        .eq('games.game_type', 'regular')
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
        .eq('games.game_type', 'regular')
        .gt('minutes_played', 0),
    ]);

    if (playerResult.error) throw playerResult.error;
    if (statsResult.error) throw statsResult.error;
    if (trendsResult.error) throw trendsResult.error;

    const zScores: Record<string, number> = {};
    const rollingAvgs: Record<string, number> = {};
    for (const t of (trendsResult.data || [])) {
      const statName = STAT_NAMES[t.stat];
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

export async function getTodaysGames(req: any, res: any) {
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

    const games = (json.events || []).map((event: any) => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      const homeAbbr = home?.team?.abbreviation || '';
      const awayAbbr = away?.team?.abbreviation || '';
      const homeId = teamIdByAbbr[homeAbbr];
      const awayId = teamIdByAbbr[awayAbbr];
      const dbId = (homeId != null && awayId != null) ? dbGameByPair[`${homeId}-${awayId}`] : undefined;
      return {
        gameId: event.id,
        dbId: dbId ?? null,
        time: comp?.date,
        status: event.status?.type?.shortDetail || 'Scheduled',
        home: { team: homeAbbr, score: home?.score || '' },
        away: { team: awayAbbr, score: away?.score || '' },
      };
    });

    res.json({ success: true, data: games });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTodaysPicks(req: any, res: any) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data: pickRows, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id, entity_id, stat, pick_type, recommended_line, hit_rate, ' +
        'sample_size, confidence_score, implied_prob, edge, ' +
        'conditions_matched, total_conditions'
      )
      .eq('game_date', today)
      .eq('prop_type', 'player')
      .order('confidence_score', { ascending: false });

    if (error) throw error;

    if (!pickRows || pickRows.length === 0) {
      return res.json({ success: true, data: { topPick: null, allPicks: [] } });
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
          statLabel: PICK_STAT_LABELS[row.stat] ?? row.stat.toUpperCase(),
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
        gameDate: today,
        topPick: picks[0] ?? null,
        allPicks: picks,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getPlayerPicks(req: any, res: any) {
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
      statLabel: PICK_STAT_LABELS[row.stat] ?? row.stat.toUpperCase(),
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
