import { supabaseAdmin } from '../config/supabaseAdmin';

export async function getTeamById(req: any, res: any) {
  try {
    const teamId = parseInt(req.params.id, 10);
    if (isNaN(teamId)) {
      return res.status(400).json({ success: false, error: 'Invalid team ID' });
    }

    // Fetch team info
    const { data: team, error: teamErr } = await supabaseAdmin
      .from('teams')
      .select('id, abbreviation, name')
      .eq('id', teamId)
      .single();

    if (teamErr || !team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    // Fetch last 20 games (descending by date)
    const { data: games } = await supabaseAdmin
      .from('games')
      .select(`
        id, game_date,
        home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
        away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
      `)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .eq('league_id', 1)
      .order('game_date', { ascending: false })
      .limit(20);

    // Fetch roster (players on this team)
    const { data: roster } = await supabaseAdmin
      .from('players')
      .select('id, name, position')
      .eq('team', (team as any).abbreviation)
      .order('name');

    // Compute basic recent-points avg from nba_player_stats over the last ~14 days
    const today = new Date().toISOString().slice(0, 10);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().slice(0, 10);

    const { data: recentStats } = await supabaseAdmin
      .from('nba_player_stats')
      .select('points')
      .eq('team_id', teamId)
      .gte('game_date', fourteenDaysAgoStr)
      .lt('game_date', today);

    const avgPoints = recentStats && recentStats.length > 0
      ? recentStats.reduce((s: number, r: any) => s + (r.points ?? 0), 0) / recentStats.length
      : null;

    res.json({
      success: true,
      data: {
        team: { id: (team as any).id, abbreviation: (team as any).abbreviation, name: (team as any).name },
        games: (games ?? []).map((g: any) => ({
          id: g.id,
          game_date: g.game_date,
          home_team: g.home_team,
          away_team: g.away_team,
          is_home: g.home_team?.id === teamId,
        })),
        roster: roster ?? [],
        recent_avg_points: avgPoints,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
