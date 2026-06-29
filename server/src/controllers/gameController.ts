import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';

function daysDiff(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return +( arr.reduce((a, b) => a + b, 0) / arr.length ).toFixed(1);
}

function aggregatePlayerStats(rows: any[]): Map<number, { name: string; position: string; pts: number[]; reb: number[]; ast: number[] }> {
  const map = new Map<number, { name: string; position: string; pts: number[]; reb: number[]; ast: number[] }>();
  for (const r of rows ?? []) {
    let p = map.get(r.player_id);
    if (!p) {
      p = { name: r.players?.name ?? '?', position: r.players?.position ?? '?', pts: [], reb: [], ast: [] };
      map.set(r.player_id, p);
    }
    p.pts.push(r.points ?? 0);
    p.reb.push(r.rebounds ?? 0);
    p.ast.push(r.assists ?? 0);
  }
  return map;
}

export async function getGameById(req: Request<{ id: string }>, res: Response) {
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
    const homeTeamId = g.home_team?.id as number;
    const awayTeamId = g.away_team?.id as number;

    // ── parallel fetches ────────────────────────────────────────────────────
    const [
      playerStatsResult,
      rawPropsResult,
      picksResult,
      injuryResult,
      h2hResult,
      homeLastGameResult,
      awayLastGameResult,
      homeSeasonStatsResult,
      awaySeasonStatsResult,
    ] = await Promise.all([
      // box score stats for this game
      supabaseAdmin
        .from('nba_player_stats')
        .select('player_id, team_id, game_date, points, rebounds, assists, three_points_made, minutes_played, players(name, team, position)')
        .eq('game_id', gameId)
        .order('minutes_played', { ascending: false }),

      // betting lines for this game date
      supabaseAdmin
        .from('daily_lines')
        .select('market_ticker, line, implied_prob, prop_type, entity_id, team_id, stat')
        .eq('game_date', g.game_date)
        .order('implied_prob', { ascending: false }),

      // system picks for this game date
      supabaseAdmin
        .from('pick_results')
        .select('entity_id, stat, recommended_line, hit_rate, confidence_score, implied_prob, edge, actual_result, did_hit, prop_type')
        .eq('game_date', g.game_date)
        .limit(100),

      // injury / availability report for this game
      supabaseAdmin
        .from('player_availability')
        .select('player_id, status, players!inner(name, team, position)')
        .eq('game_id', gameId)
        .in('status', ['out', 'gtd', 'questionable']),

      // head-to-head: last 5 meetings between these two teams
      supabaseAdmin
        .from('games')
        .select(`
          id, game_date, home_score, away_score,
          home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
          away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
        `)
        .or(
          `and(home_team_id.eq.${homeTeamId},away_team_id.eq.${awayTeamId}),` +
          `and(home_team_id.eq.${awayTeamId},away_team_id.eq.${homeTeamId})`
        )
        .lt('game_date', g.game_date)
        .not('home_score', 'is', null)
        .order('game_date', { ascending: false })
        .limit(5),

      // last game for home team (for rest days)
      supabaseAdmin
        .from('games')
        .select('game_date')
        .or(`home_team_id.eq.${homeTeamId},away_team_id.eq.${homeTeamId}`)
        .lt('game_date', g.game_date)
        .order('game_date', { ascending: false })
        .limit(1),

      // last game for away team (for rest days)
      supabaseAdmin
        .from('games')
        .select('game_date')
        .or(`home_team_id.eq.${awayTeamId},away_team_id.eq.${awayTeamId}`)
        .lt('game_date', g.game_date)
        .order('game_date', { ascending: false })
        .limit(1),

      // season stats for home team roster (last 500 game-rows, min 5 min)
      supabaseAdmin
        .from('nba_player_stats')
        .select('player_id, points, rebounds, assists, minutes_played, players!inner(name, position)')
        .eq('team_id', homeTeamId)
        .lte('game_date', g.game_date)
        .not('minutes_played', 'is', null)
        .gte('minutes_played', 5)
        .order('game_date', { ascending: false })
        .limit(500),

      // season stats for away team roster
      supabaseAdmin
        .from('nba_player_stats')
        .select('player_id, points, rebounds, assists, minutes_played, players!inner(name, position)')
        .eq('team_id', awayTeamId)
        .lte('game_date', g.game_date)
        .not('minutes_played', 'is', null)
        .gte('minutes_played', 5)
        .order('game_date', { ascending: false })
        .limit(500),
    ]);

    // ── box score ───────────────────────────────────────────────────────────
    const normalizedStats = (playerStatsResult.data ?? []).map((p: any) => ({
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

    const teamIds = [homeTeamId, awayTeamId].filter(Boolean);
    const homeAbbr = (g.home_team as any)?.abbreviation ?? '';
    const awayAbbr = (g.away_team as any)?.abbreviation ?? '';

    // For completed games, player IDs come from the box score.
    // For upcoming games, derive them from the already-fetched season stats rosters.
    const playerIdsInGame: number[] = isCompleted
      ? [...new Set(normalizedStats.map((p: any) => p.player_id))]
      : [...new Set([
          ...(homeSeasonStatsResult.data ?? []).map((p: any) => p.player_id),
          ...(awaySeasonStatsResult.data ?? []).map((p: any) => p.player_id),
        ])];

    const { data: propPlayers } = await supabaseAdmin
      .from('players')
      .select('id, name')
      .in('id', playerIdsInGame.length > 0 ? playerIdsInGame : [-1]);
    const playerNameMap: Record<number, string> = Object.fromEntries(
      (propPlayers ?? []).map((p: any) => [p.id, p.name])
    );

    const matchingProps = (rawPropsResult.data ?? []).filter((p: any) => {
      if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
      if (p.team_id != null) return teamIds.includes(p.team_id);
      if (p.entity_id != null) return teamIds.includes(p.entity_id) || p.entity_id === gameId;
      // entity_id and team_id both null: match by market_ticker containing both team abbreviations
      const ticker = (p.market_ticker ?? '').toUpperCase();
      return ticker.includes(homeAbbr.toUpperCase()) && ticker.includes(awayAbbr.toUpperCase());
    });

    // Cap player props at 20 (frontend re-sorts and slices to 10 anyway).
    // Cap spread lines at 10 most-likely outcomes; always include all winner/total.
    const playerPropsOut = matchingProps.filter((p: any) => p.prop_type === 'player').slice(0, 20);
    const spreadPropsOut = matchingProps.filter((p: any) => p.prop_type === 'spread').slice(0, 10);
    const otherPropsOut  = matchingProps.filter((p: any) => p.prop_type !== 'player' && p.prop_type !== 'spread');
    const gamePropsOut   = [...spreadPropsOut, ...otherPropsOut];
    const props = [...playerPropsOut, ...gamePropsOut]
      .map((p: any) => ({ ...p, player_name: p.prop_type === 'player' ? (playerNameMap[p.entity_id] ?? null) : null }));

    const filteredPicks = (picksResult.data ?? [])
      .filter((p: any) => {
        if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
        // Game picks store entity_id as the game ID
        if (p.entity_id === gameId) return true;
        return teamIds.includes(p.entity_id);
      })
      .map((p: any) => ({ ...p, player_name: playerNameMap[p.entity_id] ?? null }));

    // ── injury report ───────────────────────────────────────────────────────
    const injury_report = (injuryResult.data ?? []).map((r: any) => ({
      player_id: r.player_id,
      status: r.status as 'out' | 'gtd' | 'questionable',
      name: r.players?.name ?? null,
      team: r.players?.team ?? null,
      position: r.players?.position ?? null,
    }));

    // ── head-to-head ─────────────────────────────────────────────────────────
    const head_to_head = (h2hResult.data ?? []).map((m: any) => {
      const homeWon = m.home_score > m.away_score;
      return {
        game_id: m.id,
        game_date: m.game_date,
        home_team: m.home_team,
        away_team: m.away_team,
        home_score: m.home_score,
        away_score: m.away_score,
        winner_team_id: homeWon ? m.home_team?.id : m.away_team?.id,
      };
    });

    // ── rest days ─────────────────────────────────────────────────────────────
    const homeRestDays = homeLastGameResult.data?.[0]?.game_date
      ? daysDiff(homeLastGameResult.data[0].game_date, g.game_date)
      : null;
    const awayRestDays = awayLastGameResult.data?.[0]?.game_date
      ? daysDiff(awayLastGameResult.data[0].game_date, g.game_date)
      : null;

    // ── roster with season averages vs opponent ─────────────────────────────
    const h2hGameIds = head_to_head.map(m => m.game_id);

    // vs-opp stats (from head-to-head games, if any)
    let homeVsOpp: any[] = [];
    let awayVsOpp: any[] = [];
    if (h2hGameIds.length > 0) {
      const [hvs, avs] = await Promise.all([
        supabaseAdmin
          .from('nba_player_stats')
          .select('player_id, points, rebounds, assists')
          .eq('team_id', homeTeamId)
          .in('game_id', h2hGameIds),
        supabaseAdmin
          .from('nba_player_stats')
          .select('player_id, points, rebounds, assists')
          .eq('team_id', awayTeamId)
          .in('game_id', h2hGameIds),
      ]);
      homeVsOpp = hvs.data ?? [];
      awayVsOpp = avs.data ?? [];
    }

    function buildRoster(seasonRows: any[], vsOppRows: any[], top = 5) {
      const seasonMap = aggregatePlayerStats(seasonRows);
      const vsMap = aggregatePlayerStats(vsOppRows);

      const roster = Array.from(seasonMap.entries())
        .map(([id, p]) => {
          const vs = vsMap.get(id);
          return {
            player_id: id,
            name: p.name,
            position: p.position,
            // Season averages (vs this opponent if h2h games exist, else overall season)
            pts: vs ? avg(vs.pts) : avg(p.pts),
            reb: vs ? avg(vs.reb) : avg(p.reb),
            ast: vs ? avg(vs.ast) : avg(p.ast),
            season_pts: avg(p.pts),
            season_reb: avg(p.reb),
            season_ast: avg(p.ast),
            vs_opp_games: vs ? vs.pts.length : 0,
            games_played: p.pts.length,
          };
        })
        .sort((a, b) => (b.season_pts ?? 0) - (a.season_pts ?? 0))
        .slice(0, top);

      return roster;
    }

    const home_roster = buildRoster(homeSeasonStatsResult.data ?? [], homeVsOpp);
    const away_roster = buildRoster(awaySeasonStatsResult.data ?? [], awayVsOpp);

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
        // Box score (populated after game completes)
        player_stats: normalizedStats,
        props,
        picks: filteredPicks,
        // Game view context
        injury_report,
        head_to_head,
        rest: {
          home_days: homeRestDays,
          away_days: awayRestDays,
        },
        rosters: {
          home: home_roster,
          away: away_roster,
          stat_context: h2hGameIds.length > 0
            ? `vs opp avg (${h2hGameIds.length}G)`
            : 'season avg',
        },
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
