import { supabaseAdmin } from '../config/supabaseAdmin';

function computeRecord(games: any[], teamId: number) {
  let w = 0, l = 0;
  for (const g of games) {
    if (g.home_score == null || g.away_score == null) continue;
    const teamIsHome = g.home_team?.id === teamId;
    const teamScore  = teamIsHome ? g.home_score : g.away_score;
    const oppScore   = teamIsHome ? g.away_score  : g.home_score;
    if (teamScore > oppScore) w++; else l++;
  }
  return { w, l };
}

export async function getTeamById(req: any, res: any) {
  try {
    const teamId = parseInt(req.params.id, 10);
    if (isNaN(teamId)) {
      return res.status(400).json({ success: false, error: 'Invalid team ID' });
    }

    const { data: team, error: teamErr } = await supabaseAdmin
      .from('teams')
      .select('id, abbreviation, name')
      .eq('id', teamId)
      .single();

    if (teamErr || !team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const today = new Date().toISOString().slice(0, 10);

    // Last 25 games (enough for splits)
    const { data: games } = await supabaseAdmin
      .from('games')
      .select(`
        id, game_date, home_score, away_score,
        home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
        away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
      `)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .eq('league_id', 1)
      .order('game_date', { ascending: false })
      .limit(25);

    const roster = await supabaseAdmin
      .from('players')
      .select('id, name, position')
      .eq('team', (team as any).abbreviation)
      .order('name');

    // Compute W/L for each game
    const gamesWithResult = (games ?? []).map((g: any) => {
      const isHome    = g.home_team?.id === teamId;
      const teamScore = isHome ? g.home_score : g.away_score;
      const oppScore  = isHome ? g.away_score  : g.home_score;
      let result: 'W' | 'L' | null = null;
      if (teamScore != null && oppScore != null) {
        result = teamScore > oppScore ? 'W' : 'L';
      }
      return {
        id: g.id,
        game_date: g.game_date,
        home_team: g.home_team,
        away_team: g.away_team,
        home_score: g.home_score ?? null,
        away_score: g.away_score ?? null,
        is_home: isHome,
        team_score: teamScore ?? null,
        opp_score: oppScore ?? null,
        result,
      };
    });

    // Splits (completed games only)
    const completed = gamesWithResult.filter(g => g.result != null);
    const homeGames = completed.filter(g => g.is_home);
    const awayGames = completed.filter(g => !g.is_home);
    const last10    = completed.slice(0, 10);

    const overall   = computeRecord(games ?? [], teamId);
    const homeRecord = { w: homeGames.filter(g => g.result === 'W').length, l: homeGames.filter(g => g.result === 'L').length };
    const awayRecord = { w: awayGames.filter(g => g.result === 'W').length, l: awayGames.filter(g => g.result === 'L').length };
    const last10Record = { w: last10.filter(g => g.result === 'W').length, l: last10.filter(g => g.result === 'L').length };

    res.json({
      success: true,
      data: {
        team: { id: (team as any).id, abbreviation: (team as any).abbreviation, name: (team as any).name },
        games: gamesWithResult.slice(0, 20),
        roster: roster.data ?? [],
        record: { overall, home: homeRecord, away: awayRecord, last10: last10Record },
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
