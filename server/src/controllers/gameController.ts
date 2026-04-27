import { supabaseAdmin } from '../config/supabaseAdmin';

export async function getGameById(req: any, res: any) {
  try {
    const gameId = parseInt(req.params.id, 10);
    if (isNaN(gameId)) {
      return res.status(400).json({ success: false, error: 'Invalid game ID' });
    }

    const { data: game, error: gameErr } = await supabaseAdmin
      .from('games')
      .select(`
        id, game_date, home_score, away_score,
        home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
        away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
      `)
      .eq('id', gameId)
      .single();

    if (gameErr || !game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const g = game as any;
    const today = new Date().toISOString().slice(0, 10);
    const isCompleted = g.home_score != null || g.game_date < today;

    // Box score
    const { data: playerStats } = await supabaseAdmin
      .from('nba_player_stats')
      .select('player_id, team_id, game_date, points, rebounds, assists, three_points_made, minutes_played, players(name, team, position)')
      .eq('game_id', gameId)
      .order('minutes_played', { ascending: false });

    const normalizedStats = (playerStats ?? []).map((p: any) => ({
      player_id: p.player_id,
      team_id: p.team_id,
      game_date: p.game_date,
      points: p.points,
      rebounds: p.rebounds,
      assists: p.assists,
      three_points_made: p.three_points_made,
      minutes: p.minutes_played,
      players: p.players,
    }));

    const teamIds = [g.home_team?.id, g.away_team?.id].filter(Boolean);
    const playerIdsInGame = [...new Set(normalizedStats.map((p: any) => p.player_id))];

    // Resolve player names for prop display
    const { data: propPlayers } = await supabaseAdmin
      .from('players')
      .select('id, name')
      .in('id', playerIdsInGame.length > 0 ? playerIdsInGame : [-1]);
    const playerNameMap: Record<number, string> = Object.fromEntries(
      (propPlayers ?? []).map((p: any) => [p.id, p.name])
    );

    // Lines for this game
    const { data: rawProps } = await supabaseAdmin
      .from('daily_lines')
      .select('market_ticker, line, implied_prob, prop_type, entity_id, team_id, source, stat')
      .eq('game_date', g.game_date)
      .order('implied_prob', { ascending: false });

    const props = (rawProps ?? [])
      .filter((p: any) => {
        if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
        if (p.team_id != null) return teamIds.includes(p.team_id);
        return teamIds.includes(p.entity_id);
      })
      .slice(0, 30)
      .map((p: any) => ({
        ...p,
        player_name: p.prop_type === 'player' ? (playerNameMap[p.entity_id] ?? null) : null,
      }));

    // Picks for this game date
    const { data: picks } = await supabaseAdmin
      .from('pick_results')
      .select('entity_id, stat, recommended_line, hit_rate, confidence_score, implied_prob, edge, actual_result, did_hit, prop_type')
      .eq('game_date', g.game_date)
      .limit(100);

    const filteredPicks = (picks ?? [])
      .filter((p: any) => {
        if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
        return teamIds.includes(p.entity_id);
      })
      .map((p: any) => ({
        ...p,
        player_name: playerNameMap[p.entity_id] ?? null,
      }));

    res.json({
      success: true,
      data: {
        game: {
          id: g.id,
          game_date: g.game_date,
          home_team: g.home_team,
          away_team: g.away_team,
          home_score: g.home_score ?? null,
          away_score: g.away_score ?? null,
          is_completed: isCompleted,
        },
        player_stats: normalizedStats,
        props,
        picks: filteredPicks,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
