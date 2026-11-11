import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { BoxScoreGroup, league } from '../config/leagues';
import { buildGameInsights } from '../services/gameInsights';
import { sportsDay } from '../utils/dateQueries';

// League-agnostic game detail. Every sport-specific decision — which stats
// table to read, which columns make up a box score, whether a betting market
// exists — is resolved from the LeagueConfig attached by leagueMiddleware.

function daysDiff(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A row belongs to a group when its gate column is present and positive. */
function inGroup(row: any, group: BoxScoreGroup): boolean {
  const gate = num(row[group.gate]);
  return gate != null && gate > 0;
}

function groupRows(rows: any[], group: BoxScoreGroup) {
  return rows
    .filter((r) => inGroup(r, group))
    .sort((a, b) => (num(b[group.sortBy]) ?? 0) - (num(a[group.sortBy]) ?? 0))
    .map((r) => ({
      player_id: r.player_id,
      team_id: r.team_id,
      name: r.players?.name ?? null,
      position: r.players?.position ?? null,
      values: Object.fromEntries(group.columns.map((c) => [c.key, num(r[c.key])])),
    }));
}

export async function getGameById(req: Request<{ id: string }>, res: Response) {
  try {
    const lg = league(res);
    const gameId = parseInt(req.params.id, 10);
    if (isNaN(gameId)) {
      return res.status(400).json({ success: false, error: 'Invalid game ID' });
    }

    const { data: game, error: gameErr } = await supabaseAdmin
      .from('games')
      .select(`
        id, league_id, game_date, game_time, home_score, away_score, status, game_type,
        home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
        away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
      `)
      .eq('id', gameId)
      .single();

    if (gameErr || !game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const g = game as any;
    // A game id is globally unique, so a mismatch means the client asked the
    // wrong league mount. 404 rather than silently serving another sport.
    if (g.league_id !== lg.leagueId) {
      return res.status(404).json({ success: false, error: `Game ${gameId} is not a ${lg.slug.toUpperCase()} game` });
    }

    // ET sports day, not the UTC date: UTC rolls over at 7-8pm ET, which would
    // mark the whole evening slate "completed".
    const isCompleted = g.home_score != null || g.game_date < sportsDay();
    const homeTeamId = g.home_team?.id as number;
    const awayTeamId = g.away_team?.id as number;
    const statSelect = `player_id, team_id, game_date, ${lg.boxScore.select}`;

    const [
      boxResult,
      injuryResult,
      h2hResult,
      homeLastGameResult,
      awayLastGameResult,
    ] = await Promise.all([
      supabaseAdmin
        .from(lg.statsTable)
        .select(`${statSelect}, players(name, team, position)`)
        .eq('game_id', gameId),

      supabaseAdmin
        .from('player_availability')
        .select('player_id, status, players!inner(name, team, position)')
        .eq('game_id', gameId)
        .in('status', ['out', 'gtd', 'questionable']),

      // Last 5 meetings between these two teams.
      supabaseAdmin
        .from('games')
        .select(`
          id, game_date, home_score, away_score,
          home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
          away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
        `)
        .eq('league_id', lg.leagueId)
        .or(
          `and(home_team_id.eq.${homeTeamId},away_team_id.eq.${awayTeamId}),` +
          `and(home_team_id.eq.${awayTeamId},away_team_id.eq.${homeTeamId})`
        )
        .lt('game_date', g.game_date)
        .not('home_score', 'is', null)
        .order('game_date', { ascending: false })
        .limit(5),

      supabaseAdmin
        .from('games')
        .select('game_date')
        .eq('league_id', lg.leagueId)
        .or(`home_team_id.eq.${homeTeamId},away_team_id.eq.${homeTeamId}`)
        .lt('game_date', g.game_date)
        .order('game_date', { ascending: false })
        .limit(1),

      supabaseAdmin
        .from('games')
        .select('game_date')
        .eq('league_id', lg.leagueId)
        .or(`home_team_id.eq.${awayTeamId},away_team_id.eq.${awayTeamId}`)
        .lt('game_date', g.game_date)
        .order('game_date', { ascending: false })
        .limit(1),

    ]);

    // ── box score ───────────────────────────────────────────────────────────
    const boxRows = boxResult.data ?? [];
    const box_score = {
      available: boxRows.length > 0,
      groups: lg.boxScore.groups
        .map((grp) => ({
          id: grp.id,
          label: grp.label,
          columns: grp.columns,
          rows: groupRows(boxRows, grp),
        }))
        // A group with no qualifying rows is noise — an NFL game with no field
        // goal attempts should not render an empty KICKING table.
        .filter((grp) => grp.rows.length > 0),
    };

    // Spread and winner lines only, for the game view's spread + moneyline strip.
    const { data: lineRows } = isCompleted
      ? { data: [] as any[] }
      : await supabaseAdmin
          .from('daily_lines')
          .select('market_ticker, line, implied_prob, prop_type, entity_id, team_id, stat')
          .eq('game_date', g.game_date)
          .eq('league_id', lg.leagueId)
          .in('prop_type', ['spread', 'winner']);
    const props = (lineRows ?? [])
      .filter((p: any) => [homeTeamId, awayTeamId].includes(p.team_id ?? p.entity_id) || p.entity_id === gameId)
      .map((p: any) => ({ ...p, player_name: null }));

    // ── injuries ────────────────────────────────────────────────────────────
    const injury_report = (injuryResult.data ?? []).map((r: any) => ({
      player_id: r.player_id,
      status: r.status as 'out' | 'gtd' | 'questionable',
      name: r.players?.name ?? null,
      team: r.players?.team ?? null,
      position: r.players?.position ?? null,
    }));

    // ── head-to-head ─────────────────────────────────────────────────────────
    const head_to_head = (h2hResult.data ?? []).map((m: any) => ({
      game_id: m.id,
      game_date: m.game_date,
      home_team: m.home_team,
      away_team: m.away_team,
      home_score: m.home_score,
      away_score: m.away_score,
      winner_team_id: m.home_score > m.away_score ? m.home_team?.id : m.away_team?.id,
    }));

    // ── rest days ────────────────────────────────────────────────────────────
    const homeLast = homeLastGameResult.data?.[0]?.game_date;
    const awayLast = awayLastGameResult.data?.[0]?.game_date;

    res.json({
      success: true,
      data: {
        league: lg.slug,
        game: {
          id: g.id,
          game_date: g.game_date,
          game_time: g.game_time ?? null,
          game_type: g.game_type ?? null,
          home_team: g.home_team,
          away_team: g.away_team,
          home_score: g.home_score ?? null,
          away_score: g.away_score ?? null,
          is_completed: isCompleted,
        },
        box_score,
        props,
        injury_report,
        head_to_head,
        rest: {
          home_days: homeLast ? daysDiff(homeLast, g.game_date) : null,
          away_days: awayLast ? daysDiff(awayLast, g.game_date) : null,
        },
        // The projected box score was retired from the game view; the field stays
        // (always null) so older clients keep parsing the payload.
        preview: null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /games/:id/insights — the game view's matchup panel: tale of the tape,
 * streaks, trends, injuries, team news and (outdoor NFL) kickoff weather for
 * the two teams in this game.
 */
export async function getGameInsights(req: Request<{ id: string }>, res: Response) {
  try {
    const lg = league(res);
    const gameId = parseInt(req.params.id, 10);
    if (isNaN(gameId)) {
      return res.status(400).json({ success: false, error: 'Invalid game ID' });
    }
    const { data: game, error } = await supabaseAdmin
      .from('games')
      .select(`
        id, league_id, game_date, game_time, home_score, ext_id, espn_id,
        home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
        away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
      `)
      .eq('id', gameId)
      .single();
    const g = game as any;
    if (error || !g || g.league_id !== lg.leagueId) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }
    const data = await buildGameInsights(lg, {
      id: g.id,
      game_date: g.game_date,
      game_time: g.game_time ?? null,
      ext_id: g.ext_id ?? null,
      espn_id: g.espn_id ?? null,
      home_team: g.home_team,
      away_team: g.away_team,
      is_completed: g.home_score != null || g.game_date < sportsDay(),
    });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[getGameInsights]', err);
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to load game insights' });
  }
}
