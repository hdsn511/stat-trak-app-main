import { supabaseAdmin } from '../config/supabaseAdmin';

const STAT_NAMES: Record<number, string> = {
  0: 'points', 1: 'rebounds', 2: 'assists',
  3: 'threes', 4: 'fouls', 5: 'minutes'
};

export async function getTopTrending(req: any, res: any) {
  try {
    const { data, error } = await supabaseAdmin
      .from('nba_trends')
      .select('player_id, stat, window_size, trend_val, rolling_avg, players(name, team, position)')
      .order('trend_val', { ascending: false })
      .eq('window_size', 10)
      .limit(10);

    if (error) throw error;

    const result = (data || []).map((row: any) => ({
      playerId: row.player_id,
      playerName: row.players?.name,
      team: row.players?.team,
      position: row.players?.position,
      stat: STAT_NAMES[row.stat],
      statId: row.stat,
      zScore: row.trend_val,
      rollingAvg: row.rolling_avg,
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

    let query = supabaseAdmin
      .from('nba_trends')
      .select('player_id, stat, window_size, trend_val, rolling_avg, season_avg, players(name, team, position)')
      .eq('window_size', parseInt(window))
      .order('trend_val', { ascending: false });

    if (stat !== undefined) {
      const statEntry = Object.entries(STAT_NAMES).find(([, name]) => name === stat);
      if (statEntry) {
        query = query.eq('stat', parseInt(statEntry[0]));
      }
    }

    const thresholdNum = parseFloat(threshold);
    if (thresholdNum > 0) {
      query = query.gte('rolling_avg', thresholdNum);
    }

    const { data, error } = await query;
    if (error) throw error;

    const result = (data || []).map((row: any) => ({
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

    const [playerResult, statsResult, trendsResult] = await Promise.all([
      supabaseAdmin
        .from('players')
        .select('id, name, team, position')
        .eq('id', parseInt(id))
        .single(),
      supabaseAdmin
        .from('nba_player_stats')
        .select('game_id, points, rebounds, assists, three_points_made, fouls, minutes_played, game_date')
        .eq('player_id', parseInt(id))
        .order('game_date', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('nba_trends')
        .select('stat, trend_val, rolling_avg, window_size')
        .eq('player_id', parseInt(id))
        .eq('window_size', 10),
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

    res.json({
      success: true,
      data: {
        player: playerResult.data,
        games: (statsResult.data || []).map((g: any) => ({
          gameId: g.game_id,
          date: g.game_date,
          points: g.points,
          rebounds: g.rebounds,
          assists: g.assists,
          threes: g.three_points_made,
          fouls: g.fouls,
          minutes: g.minutes_played,
        })),
        zScores,
        rollingAvgs,
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

    const games = (json.events || []).map((event: any) => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      return {
        gameId: event.id,
        time: comp?.date,
        status: event.status?.type?.shortDetail || 'Scheduled',
        home: { team: home?.team?.abbreviation || '', score: home?.score || '' },
        away: { team: away?.team?.abbreviation || '', score: away?.score || '' },
      };
    });

    res.json({ success: true, data: games });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
