import { supabaseAdmin } from '../config/supabaseAdmin';

export async function getGameById(req: any, res: any) {
  try {
    const gameId = parseInt(req.params.id, 10);
    if (isNaN(gameId)) {
      return res.status(400).json({ success: false, error: 'Invalid game ID' });
    }

    // Fetch game + teams
    const { data: game, error: gameErr } = await supabaseAdmin
      .from('games')
      .select(`
        id, game_date, league_id,
        home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
        away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
      `)
      .eq('id', gameId)
      .single();

    if (gameErr || !game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const isCompleted = (game as any).game_date < today;

    const homeTeam: any = (game as any).home_team;
    const awayTeam: any = (game as any).away_team;

    // Fetch player stats for this game (box score) — match by game_id
    const { data: playerStats } = await supabaseAdmin
      .from('nba_player_stats')
      .select('player_id, team_id, game_date, points, rebounds, assists, three_points_made, minutes_played, players(name, team, position)')
      .eq('game_id', gameId)
      .order('minutes_played', { ascending: false });

    // Normalize minutes -> minutes for client convenience
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

    // Fetch lines for this game from daily_lines (by date), then filter
    // by team or player association.
    const teamIds = [homeTeam?.id, awayTeam?.id].filter(Boolean);
    const playerIdsInGame = [...new Set(normalizedStats.map((p: any) => p.player_id))];

    const { data: rawProps } = await supabaseAdmin
      .from('daily_lines')
      .select('market_ticker, line, implied_prob, prop_type, entity_id, team_id, source, stat')
      .eq('game_date', (game as any).game_date)
      .order('implied_prob', { ascending: false });

    const props = (rawProps ?? []).filter((p: any) => {
      if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
      // team-level props (spread/total/winner) — entity_id may be team_id
      if (p.team_id != null) return teamIds.includes(p.team_id);
      return teamIds.includes(p.entity_id);
    }).slice(0, 20);

    // Fetch player picks for this game date (any player on either team)
    const { data: picks } = await supabaseAdmin
      .from('pick_results')
      .select('entity_id, stat, recommended_line, hit_rate, confidence_score, implied_prob, edge, actual_result, did_hit, prop_type')
      .eq('game_date', (game as any).game_date)
      .limit(100);

    // Filter to picks relevant to this game (player-level: in the game; team-level: team in game)
    const filteredPicks = (picks ?? []).filter((p: any) => {
      if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
      return teamIds.includes(p.entity_id);
    });

    res.json({
      success: true,
      data: {
        game: {
          id: (game as any).id,
          game_date: (game as any).game_date,
          home_team: homeTeam,
          away_team: awayTeam,
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
