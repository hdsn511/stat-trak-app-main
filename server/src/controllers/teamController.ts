import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league, seasonStartFor, LeagueConfig } from '../config/leagues';

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

// Per-league player columns shown on the team page: [db column, label].
// Averages are per game played; `gp` counts games with a played-gate row.
const TEAM_PLAYER_COLUMNS: Record<string, [string, string][]> = {
  nba: [['minutes_played', 'MIN'], ['points', 'PTS'], ['rebounds', 'REB'], ['assists', 'AST'], ['three_points_made', '3PM']],
  mlb: [['hits', 'H'], ['home_runs', 'HR'], ['rbi', 'RBI'], ['runs', 'R'], ['total_bases', 'TB']],
  nhl: [['goals', 'G'], ['assists', 'A'], ['points', 'PTS'], ['shots_on_goal', 'SOG'], ['hits', 'HIT']],
  nfl: [['passing_yards', 'PASS'], ['rushing_yards', 'RUSH'], ['receiving_yards', 'REC'], ['receptions', 'RECS'], ['tackles_total', 'TKL']],
};

async function playerAverages(lg: LeagueConfig, teamId: number, seasonStart: string) {
  const cols = TEAM_PLAYER_COLUMNS[lg.slug] ?? [];
  if (cols.length === 0) return { columns: [], players: [] };
  const sel = `player_id, ${cols.map(([c]) => c).join(', ')}, games!inner(game_type)`;
  const rows: any[] = [];
  for (let page = 0; page < 10; page++) {
    let q: any = supabaseAdmin
      .from(lg.statsTable)
      .select(sel)
      .eq('team_id', teamId)
      .gte('game_date', seasonStart)
      .in('games.game_type', lg.gameTypes);
    if (lg.playedGate) q = q.gt(lg.playedGate.col, lg.playedGate.min);
    const { data } = await q.range(page * 1000, page * 1000 + 999);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const agg = new Map<number, { gp: number; sums: Record<string, number> }>();
  for (const r of rows) {
    const a = agg.get(r.player_id) ?? { gp: 0, sums: {} };
    a.gp += 1;
    for (const [c] of cols) a.sums[c] = (a.sums[c] ?? 0) + (Number(r[c]) || 0);
    agg.set(r.player_id, a);
  }
  const ids = [...agg.keys()];
  const names = new Map<number, { name: string; position: string | null }>();
  if (ids.length > 0) {
    const { data } = await supabaseAdmin.from('players').select('id, name, position').in('id', ids);
    for (const p of (data ?? []) as any[]) names.set(p.id, { name: p.name, position: p.position });
  }
  const players = ids.map((id) => {
    const a = agg.get(id)!;
    const avgs: Record<string, number> = {};
    for (const [c] of cols) avgs[c] = Math.round((a.sums[c]! / a.gp) * 10) / 10;
    return { id, name: names.get(id)?.name ?? `#${id}`, position: names.get(id)?.position ?? null, gp: a.gp, avgs };
  });
  return { columns: cols.map(([key, label]) => ({ key, label })), players };
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
    const [{ data: games }, { data: roster }, playerStats] = await Promise.all([
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

      playerAverages(lg, teamId, seasonStart),
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
        player_stats: playerStats,
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
