import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league, seasonStartFor } from '../config/leagues';

interface GameRow {
  is_home: boolean;
  team_score: number | null;
  opp_score: number | null;
  result: 'W' | 'L' | 'T' | null;
}

function tally(games: GameRow[]) {
  let w = 0, l = 0, t = 0;
  for (const g of games) {
    if (g.result === 'W') w++;
    else if (g.result === 'L') l++;
    else if (g.result === 'T') t++;
  }
  return { w, l, t };
}

export async function getTeamById(req: Request<{ id: string }>, res: Response) {
  try {
    const lg = league(res);
    const teamId = parseInt(req.params.id, 10);
    if (isNaN(teamId)) {
      return res.status(400).json({ success: false, error: 'Invalid team ID' });
    }

    const { data: team, error: teamErr } = await supabaseAdmin
      .from('teams')
      .select('id, league_id, abbreviation, name, city')
      .eq('id', teamId)
      .single();

    if (teamErr || !team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }
    if ((team as any).league_id !== lg.leagueId) {
      return res.status(404).json({
        success: false,
        error: `Team ${teamId} is not a ${lg.slug.toUpperCase()} team`,
      });
    }

    const seasonStart = seasonStartFor(lg);

    // Season schedule, newest first. Upcoming games have null scores and sort
    // to the top, which is what the game log wants.
    const [{ data: games }, { data: roster }] = await Promise.all([
      supabaseAdmin
        .from('games')
        .select(`
          id, game_date, game_time, home_score, away_score, game_type,
          home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
          away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
        `)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .eq('league_id', lg.leagueId)
        .gte('game_date', seasonStart)
        .in('game_type', lg.gameTypes)
        .order('game_date', { ascending: false })
        .limit(120),

      // players.team stores the abbreviation, which repeats across sports
      // (WSH exists in three leagues), so the league tag is required here.
      supabaseAdmin
        .from('players')
        .select('id, name, position')
        .eq('team', (team as any).abbreviation)
        .eq('league', lg.playerLeagueTag)
        .eq('is_active', true)
        .order('name'),
    ]);

    const gamesWithResult = (games ?? []).map((g: any) => {
      const isHome = g.home_team?.id === teamId;
      const teamScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      let result: 'W' | 'L' | 'T' | null = null;
      if (teamScore != null && oppScore != null) {
        // NFL ties are rare but real; scoring them as losses skews the record.
        result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T';
      }
      return {
        id: g.id,
        game_date: g.game_date,
        game_time: g.game_time ?? null,
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

    const completed = gamesWithResult.filter((g) => g.result != null);

    res.json({
      success: true,
      data: {
        league: lg.slug,
        team: {
          id: (team as any).id,
          abbreviation: (team as any).abbreviation,
          name: (team as any).name,
          city: (team as any).city ?? null,
        },
        games: gamesWithResult,
        roster: roster ?? [],
        record: {
          overall: tally(completed),
          home: tally(completed.filter((g) => g.is_home)),
          away: tally(completed.filter((g) => !g.is_home)),
          last10: tally(completed.slice(0, 10)),
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
