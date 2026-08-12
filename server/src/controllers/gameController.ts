import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { BoxScoreGroup, LeagueConfig, league } from '../config/leagues';

// League-agnostic game detail. Every sport-specific decision — which stats
// table to read, which columns make up a box score, whether a betting market
// exists — is resolved from the LeagueConfig attached by leagueMiddleware.

function daysDiff(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null;
  return +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
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

/**
 * Season averages for the top players on a team, used as the pre-game preview
 * when no box score exists yet. Uses the league's primary box-score group so
 * the preview columns match what the completed game will eventually show.
 */
function buildPreview(seasonRows: any[], vsOppRows: any[], group: BoxScoreGroup, top = 6) {
  const collect = (rows: any[]) => {
    const map = new Map<number, { name: string; position: string; vals: Record<string, number[]> }>();
    for (const r of rows) {
      if (!inGroup(r, group)) continue;
      let p = map.get(r.player_id);
      if (!p) {
        p = { name: r.players?.name ?? '?', position: r.players?.position ?? '?', vals: {} };
        map.set(r.player_id, p);
      }
      for (const c of group.columns) {
        const v = num(r[c.key]);
        if (v == null) continue;
        (p.vals[c.key] ??= []).push(v);
      }
    }
    return map;
  };

  const season = collect(seasonRows);
  const vsOpp = collect(vsOppRows);

  return Array.from(season.entries())
    .map(([id, p]) => {
      const vs = vsOpp.get(id);
      const averages = (src: typeof p) =>
        Object.fromEntries(group.columns.map((c) => [c.key, avg(src.vals[c.key] ?? [])]));
      return {
        player_id: id,
        name: p.name,
        position: p.position,
        // Averages vs this opponent when head-to-head games exist, else season.
        values: vs ? averages(vs) : averages(p),
        season_values: averages(p),
        vs_opp_games: vs ? (vs.vals[group.sortBy]?.length ?? 0) : 0,
        games_played: p.vals[group.sortBy]?.length ?? 0,
      };
    })
    .sort((a, b) => (b.season_values[group.sortBy] ?? 0) - (a.season_values[group.sortBy] ?? 0))
    .slice(0, top);
}

/** Betting lines and system picks. Only NBA and MLB have these pipelines. */
async function fetchMarkets(lg: LeagueConfig, gameDate: string) {
  if (!lg.hasMarkets) return { props: [], picks: [] };

  const [lines, picks] = await Promise.all([
    supabaseAdmin
      .from('daily_lines')
      .select('market_ticker, line, implied_prob, prop_type, entity_id, team_id, stat')
      .eq('game_date', gameDate)
      .eq('league_id', lg.leagueId)
      .order('implied_prob', { ascending: false }),
    supabaseAdmin
      .from('pick_results')
      .select(
        'entity_id, stat, recommended_line, hit_rate, confidence_score, implied_prob, edge, ' +
        'actual_result, did_hit, prop_type'
      )
      .eq('game_date', gameDate)
      .eq('league_id', lg.leagueId)
      .limit(100),
  ]);

  return { props: lines.data ?? [], picks: picks.data ?? [] };
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

    const today = new Date().toISOString().slice(0, 10);
    const isCompleted = g.home_score != null || g.game_date < today;
    const homeTeamId = g.home_team?.id as number;
    const awayTeamId = g.away_team?.id as number;
    const primaryGroup = lg.boxScore.groups[0]!;
    const statSelect = `player_id, team_id, game_date, ${lg.boxScore.select}`;

    // The pre-game preview averages a team's season to date. A finished game
    // has a real box score, so those two 600-row scans are pure waste there.
    const seasonRowsFor = (teamId: number) =>
      isCompleted
        ? Promise.resolve({ data: [] as any[] })
        : supabaseAdmin
            .from(lg.statsTable)
            .select(`${statSelect}, players!inner(name, position)`)
            .eq('team_id', teamId)
            .lte('game_date', g.game_date)
            .order('game_date', { ascending: false })
            .limit(600);

    const [
      boxResult,
      markets,
      injuryResult,
      h2hResult,
      homeLastGameResult,
      awayLastGameResult,
      homeSeasonStatsResult,
      awaySeasonStatsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from(lg.statsTable)
        .select(`${statSelect}, players(name, team, position)`)
        .eq('game_id', gameId),

      fetchMarkets(lg, g.game_date),

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

      seasonRowsFor(homeTeamId),
      seasonRowsFor(awayTeamId),
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

    const teamIds = [homeTeamId, awayTeamId].filter(Boolean);
    const homeAbbr = (g.home_team as any)?.abbreviation ?? '';
    const awayAbbr = (g.away_team as any)?.abbreviation ?? '';

    // For completed games the participants come from the box score; before
    // tipoff they come from the season rosters already fetched above.
    const playerIdsInGame: number[] = isCompleted && boxRows.length > 0
      ? [...new Set(boxRows.map((p: any) => p.player_id))]
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

    // ── markets ─────────────────────────────────────────────────────────────
    const matchingProps = markets.props.filter((p: any) => {
      if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
      if (p.team_id != null) return teamIds.includes(p.team_id);
      if (p.entity_id != null) return teamIds.includes(p.entity_id) || p.entity_id === gameId;
      // Neither id is set: fall back to matching both abbreviations in the ticker.
      const ticker = (p.market_ticker ?? '').toUpperCase();
      return ticker.includes(homeAbbr.toUpperCase()) && ticker.includes(awayAbbr.toUpperCase());
    });

    // Cap player props at 20 and spreads at 10; winner/total lines are few.
    const playerProps = matchingProps.filter((p: any) => p.prop_type === 'player').slice(0, 20);
    const spreadProps = matchingProps.filter((p: any) => p.prop_type === 'spread').slice(0, 10);
    const otherProps = matchingProps.filter(
      (p: any) => p.prop_type !== 'player' && p.prop_type !== 'spread'
    );
    const props = [...playerProps, ...spreadProps, ...otherProps].map((p: any) => ({
      ...p,
      player_name: p.prop_type === 'player' ? (playerNameMap[p.entity_id] ?? null) : null,
    }));

    const picks = markets.picks
      .filter((p: any) => {
        if (p.prop_type === 'player') return playerIdsInGame.includes(p.entity_id);
        // Game picks store entity_id as the game id.
        if (p.entity_id === gameId) return true;
        return teamIds.includes(p.entity_id);
      })
      .map((p: any) => ({ ...p, player_name: playerNameMap[p.entity_id] ?? null }));

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

    // ── pre-game preview ─────────────────────────────────────────────────────
    const h2hGameIds = head_to_head.map((m) => m.game_id);
    let homeVsOpp: any[] = [];
    let awayVsOpp: any[] = [];
    if (h2hGameIds.length > 0 && !isCompleted) {
      const [hvs, avs] = await Promise.all([
        supabaseAdmin
          .from(lg.statsTable)
          .select(`${statSelect}, players!inner(name, position)`)
          .eq('team_id', homeTeamId)
          .in('game_id', h2hGameIds),
        supabaseAdmin
          .from(lg.statsTable)
          .select(`${statSelect}, players!inner(name, position)`)
          .eq('team_id', awayTeamId)
          .in('game_id', h2hGameIds),
      ]);
      homeVsOpp = hvs.data ?? [];
      awayVsOpp = avs.data ?? [];
    }

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
        picks,
        has_markets: lg.hasMarkets,
        injury_report,
        head_to_head,
        rest: {
          home_days: homeLast ? daysDiff(homeLast, g.game_date) : null,
          away_days: awayLast ? daysDiff(awayLast, g.game_date) : null,
        },
        // Only meaningful before tipoff; a finished game shows its box score.
        preview: isCompleted
          ? null
          : {
              label: primaryGroup.label,
              columns: primaryGroup.columns,
              home: buildPreview(homeSeasonStatsResult.data ?? [], homeVsOpp, primaryGroup),
              away: buildPreview(awaySeasonStatsResult.data ?? [], awayVsOpp, primaryGroup),
              stat_context:
                h2hGameIds.length > 0 ? `vs opp avg (${h2hGameIds.length}G)` : 'season avg',
            },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
