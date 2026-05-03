import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { STAT_LABELS, STAT_CONFIG } from '../constants/stats';
import { findNearestPickDate, findNearestLinesDate } from '../utils/dateQueries';

// ESPN uses different abbreviations than the NBA API / our DB.
const ESPN_ABBR_TO_DB: Record<string, string> = {
  NY:   'NYK',
  SA:   'SAS',
  GS:   'GSW',
  NO:   'NOP',
  PHO:  'PHX',
  BK:   'BKN',
  UTAH: 'UTA',
};

export async function getTopPicks(req: Request<{}, {}, {}, { limit?: string }>, res: Response) {
  try {
    const parsed = parseInt(req.query.limit ?? '5', 10);
    const limit = Number.isNaN(parsed) ? 5 : Math.max(1, Math.min(20, parsed));
    const today = new Date().toISOString().slice(0, 10);
    const pickDate = await findNearestPickDate(today);

    const { data: picks, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id,entity_id,stat,pick_type,prop_type,recommended_line,hit_rate,' +
        'sample_size,confidence_score,implied_prob,edge,did_hit,actual_result'
      )
      .eq('game_date', pickDate)
      .order('confidence_score', { ascending: false });

    if (error) throw error;
    if (!picks || picks.length === 0) {
      console.warn(`[getTopPicks] no picks found for game_date=${pickDate} — returning empty payload`);
    }
    const allPicks = (picks ?? []) as any[];

    const playerRows = allPicks.filter((p) => p.prop_type === 'player');
    const gameRows = allPicks.filter((p) =>
      ['winner', 'spread', 'total'].includes(p.prop_type)
    );

    // Dedupe game picks by (entity_id, prop_type), keeping highest confidence
    const bestPerGameProp = new Map<string, any>();
    for (const g of gameRows) {
      const key = `${g.entity_id}-${g.prop_type}`;
      const existing = bestPerGameProp.get(key);
      if (!existing || (g.confidence_score ?? 0) > (existing.confidence_score ?? 0)) {
        bestPerGameProp.set(key, g);
      }
    }
    const dedupedGameRows = Array.from(bestPerGameProp.values())
      .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0));

    // ── Player side: dedupe by (entity_id, stat), keeping highest confidence
    const bestPerPlayerStat = new Map<string, any>();
    for (const p of playerRows) {
      const key = `${p.entity_id}-${p.stat}`;
      const existing = bestPerPlayerStat.get(key);
      if (!existing || (p.confidence_score ?? 0) > (existing.confidence_score ?? 0)) {
        bestPerPlayerStat.set(key, p);
      }
    }
    const topPlayerPicks = Array.from(bestPerPlayerStat.values())
      .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))
      .slice(0, limit);

    // Join players table
    const playerIds = topPlayerPicks.map((p) => p.entity_id);
    const { data: players } = playerIds.length
      ? await supabaseAdmin.from('players').select('id,name,team,position').in('id', playerIds)
      : { data: [] as any[] };
    const playerMap = new Map((players ?? []).map((p: any) => [p.id, p]));

    // ── Opponent lookup for player picks (using pickDate's games + teams)
    // We need: player team abbr → game on pickDate → opponent team abbr + name
    const playerTeams = (players ?? []).map((p: any) => p.team).filter(Boolean) as string[];
    const oppByTeamAbbr = new Map<string, { team: string | null; team_name: string | null }>();
    if (playerTeams.length > 0) {
      // Fetch all teams to build abbr→id and id→{abbr,name} maps
      const { data: allTeams } = await supabaseAdmin
        .from('teams')
        .select('id,abbreviation,name');
      const abbrToTeamId = new Map<string, number>();
      const teamIdToInfo = new Map<number, { abbreviation: string; name: string }>();
      for (const t of (allTeams ?? [])) {
        abbrToTeamId.set((t.abbreviation ?? '').toUpperCase(), t.id);
        teamIdToInfo.set(t.id, { abbreviation: t.abbreviation, name: t.name });
      }

      // Resolve team IDs for player teams
      const playerTeamIds = playerTeams
        .map((abbr: string) => abbrToTeamId.get(abbr.toUpperCase()))
        .filter((id): id is number => id != null);

      if (playerTeamIds.length > 0) {
        const { data: pickDateGames } = await supabaseAdmin
          .from('games')
          .select('home_team_id,away_team_id')
          .eq('game_date', pickDate)
          .or(
            playerTeamIds.map((id) => `home_team_id.eq.${id},away_team_id.eq.${id}`).join(',')
          );
        for (const g of (pickDateGames ?? [])) {
          const homeInfo = teamIdToInfo.get(g.home_team_id);
          const awayInfo = teamIdToInfo.get(g.away_team_id);
          if (homeInfo) {
            oppByTeamAbbr.set(homeInfo.abbreviation.toUpperCase(), {
              team: awayInfo?.abbreviation ?? null,
              team_name: awayInfo?.name ?? null,
            });
          }
          if (awayInfo) {
            oppByTeamAbbr.set(awayInfo.abbreviation.toUpperCase(), {
              team: homeInfo?.abbreviation ?? null,
              team_name: homeInfo?.name ?? null,
            });
          }
        }
      }
    }

    // ── Game side: one of each ML/Spread/Total, then fill by confidence
    const pickByPropType = (t: string) => dedupedGameRows.find((r: any) => r.prop_type === t);
    const featuredPicks: Array<{ row: any; featured: 'ml' | 'spread' | 'total' }> = [];
    const ml = pickByPropType('winner');
    if (ml) featuredPicks.push({ row: ml, featured: 'ml' });
    const sp = pickByPropType('spread');
    if (sp) featuredPicks.push({ row: sp, featured: 'spread' });
    const to = pickByPropType('total');
    if (to) featuredPicks.push({ row: to, featured: 'total' });

    const featuredIds = new Set(featuredPicks.map((f) => f.row.id));
    const fillers = dedupedGameRows
      .filter((r: any) => !featuredIds.has(r.id))
      .slice(0, Math.max(0, limit - featuredPicks.length));

    const topGamePicksRaw = [
      ...featuredPicks.map((f) => ({ ...f.row, _featured: f.featured as string })),
      ...fillers.map((r: any) => ({ ...r, _featured: null })),
    ].slice(0, limit);

    // Join games + teams
    const gameIds = topGamePicksRaw.map((g: any) => g.entity_id).filter((id: any) => id != null);
    const { data: games } = gameIds.length
      ? await supabaseAdmin
          .from('games')
          .select('id,home_team_id,away_team_id')
          .in('id', gameIds)
      : { data: [] as any[] };
    const gameMap = new Map((games ?? []).map((g: any) => [g.id, g]));

    // Resolve team abbreviations
    const teamIds = new Set<number>();
    for (const g of (games ?? [])) {
      if (g.home_team_id != null) teamIds.add(g.home_team_id);
      if (g.away_team_id != null) teamIds.add(g.away_team_id);
    }
    const { data: teams } = teamIds.size
      ? await supabaseAdmin.from('teams').select('id,abbreviation').in('id', [...teamIds])
      : { data: [] as any[] };
    const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.abbreviation]));

    // ── Build response
    const playerPayload = topPlayerPicks.map((p) => {
      const pl: any = playerMap.get(p.entity_id) ?? { name: null, team: null, position: null };

      // Direction: Kalshi only offers OVER markets (YES/NO on "Will player X exceed line Y?").
      // 'over' means we recommend betting YES (model expects the player to hit the OVER).
      // 'under' means we recommend betting NO. Use hit_rate vs implied_prob as the signal:
      // if model's hit_rate exceeds the market's implied probability, we like the OVER.
      const direction: 'over' | 'under' =
        (p.hit_rate ?? 0) >= (p.implied_prob ?? 0.5) ? 'over' : 'under';

      // Derive opponent from games on pickDate
      const teamAbbr = (pl.team ?? '').toUpperCase();
      const opponent = teamAbbr ? (oppByTeamAbbr.get(teamAbbr) ?? null) : null;

      return {
        player_id: p.entity_id,
        player_name: pl.name,
        team: pl.team,
        position: pl.position,
        stat: p.stat,
        stat_label: STAT_LABELS[p.stat] ?? String(p.stat).toUpperCase(),
        pick_type: p.pick_type,
        line: p.recommended_line,
        direction,
        hit_rate: p.hit_rate,
        confidence: p.confidence_score,
        edge: p.edge,
        sample_size: p.sample_size,
        implied_prob: p.implied_prob,
        opponent,
        did_hit: p.did_hit ?? null,
        actual_result: p.actual_result ?? null,
      };
    });

    const gamePayload = topGamePicksRaw.map((g: any) => {
      const gm: any = gameMap.get(g.entity_id) ?? {};
      const home = teamMap.get(gm.home_team_id) ?? null;
      const away = teamMap.get(gm.away_team_id) ?? null;
      return {
        game_id: g.entity_id,
        prop_type: g.prop_type,
        home_team: home,
        away_team: away,
        pick_type: g.pick_type,
        line: g.prop_type === 'winner' ? null : g.recommended_line,
        hit_rate: g.hit_rate,
        confidence: g.confidence_score,
        edge: g.edge,
        implied_prob: g.implied_prob,
        featured: g._featured,
      };
    });

    res.json({
      success: true,
      data: {
        game_date: pickDate,
        player: playerPayload,
        game: gamePayload,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// Tiered lines are always computed on a 10-game window — that's the bet horizon
// users care about and matches the Kalshi prop look-back.
const STREAKS_WINDOW = 10;

// Round a raw value down to the nearest 0.5 to produce a clean Kalshi-style line.
// e.g. 24.0 → 23.5, 24.7 → 24.5, 25.0 → 24.5.
// We always round DOWN (subtract 0.5 from .0/.5 boundaries) because the line
// must be strictly under the floor for the player to clear it.
function toKalshiLine(value: number): number {
  // Convert to half-units, floor, then back to value units.
  const half = Math.floor(value * 2) / 2;
  // If the value sits exactly on a half boundary (e.g. 20.0 or 20.5), drop one
  // step so the line is strictly less than the value.
  if (half === value) return half - 0.5;
  return half;
}

export async function getPerfectStreaks(req: Request<{}, {}, {}, { type?: string; stat?: string; window?: string }>, res: Response) {
  try {
    const type = (req.query.type ?? 'player').toLowerCase();
    const stat = (req.query.stat ?? 'pts').toLowerCase();
    // Game streaks still honor the legacy `window` param (3/5/10);
    // player streaks are always 10-game and ignore it (tiered hit-rate model).
    const parsedWindow = parseInt(req.query.window ?? '5', 10);
    const window = Number.isNaN(parsedWindow)
      ? 5
      : Math.max(3, Math.min(10, parsedWindow));

    if (type === 'game') {
      return await getGamePerfectStreaks(req, res, stat, window);
    }
    if (type !== 'player') {
      return res.status(400).json({ success: false, error: `unknown type: ${type}` });
    }

    const statCfg = STAT_CONFIG[stat];
    if (!statCfg) {
      return res.status(400).json({ success: false, error: `invalid stat: ${stat}` });
    }

    const today = new Date().toISOString().slice(0, 10);

    // ── A. Today's slate teams via ESPN
    const espn = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard')
      .then((r) => {
        if (!r.ok) { console.error(`[getPerfectStreaks] ESPN ${r.status}`); return null; }
        return r.json();
      })
      .catch((err) => {
        console.error('[getPerfectStreaks] ESPN failed:', err?.message ?? err);
        return null;
      });
    const slateTeams = new Set<string>();
    for (const ev of (((espn as any)?.events) ?? [])) {
      for (const c of (ev.competitions?.[0]?.competitors ?? [])) {
        const abbr = c.team?.abbreviation?.toUpperCase();
        if (abbr) slateTeams.add(ESPN_ABBR_TO_DB[abbr] ?? abbr);
      }
    }
    if (slateTeams.size === 0) {
      console.warn('[getPerfectStreaks] no teams on ESPN slate');
      return res.json({ success: true, data: { stat, window: STREAKS_WINDOW, rows: [] } });
    }

    // ── B. Today's games (for opponent + out-player lookup)
    const linesDate = await findNearestPickDate(today);
    const { data: todayGames } = await supabaseAdmin
      .from('games')
      .select('id,home_team_id,away_team_id')
      .eq('game_date', linesDate)
      .eq('league_id', 1);
    const todayGameIds = (todayGames ?? []).map((g: any) => g.id);

    const outIds = new Set<number>();
    if (todayGameIds.length > 0) {
      const { data: outRows } = await supabaseAdmin
        .from('player_availability')
        .select('player_id')
        .eq('status', 'out')
        .in('game_id', todayGameIds);
      for (const r of (outRows ?? [])) outIds.add(r.player_id);
    }

    // ── C. All active players on today's slate teams
    const { data: allPlayers } = await supabaseAdmin
      .from('players')
      .select('id,name,team,position')
      .in('team', [...slateTeams]);
    const candidates = (allPlayers ?? []).filter((p: any) => !outIds.has(p.id));
    if (candidates.length === 0) {
      return res.json({ success: true, data: { stat, window: STREAKS_WINDOW, rows: [] } });
    }

    // ── D. Per-player: fetch last 10 games and compute tiered lines.
    // Sort the values ascending [v0, v1, ..., v9]:
    //   v0 → 100% line (10/10 games clear it)
    //   v1 → 90% line  (9/10)
    //   v2 → 80% line  (8/10)
    //   v3 → 70% line  (7/10)
    // We then snap each tier down to the nearest 0.5 for Kalshi-clean lines.
    type TieredRow = {
      player_id: number;
      player_name: string;
      team: string;
      position: string;
      line_100: number;
      line_90: number;
      line_80: number;
      line_70: number;
      rolling_avg: number;
      games_used: number;
      opponent: { team: string; league_rank: number | null } | null;
      // Picks v2 context fields (nullable until backfill / nightly populates them)
      recent_opp_form: number | null;
      key_teammates_out: number[];
      opportunity_trend: number | null;
    };

    const tieredResults = await Promise.all(candidates.map(async (p: any) => {
      const { data: statRows } = await supabaseAdmin
        .from('nba_player_stats')
        .select(`player_id,game_date,${statCfg.col},minutes_played`)
        .eq('player_id', p.id)
        .gt('minutes_played', 0)
        .order('game_date', { ascending: false })
        .limit(STREAKS_WINDOW);

      const values: number[] = ((statRows ?? []) as any[])
        .map((r: any) => r[statCfg.col])
        .filter((v: any) => v != null && typeof v === 'number');

      if (values.length < STREAKS_WINDOW) return null;

      const sortedAsc = [...values].sort((a, b) => a - b);
      const v0 = sortedAsc[0]; // min — 10/10 floor
      const v1 = sortedAsc[1];
      const v2 = sortedAsc[2];
      const v3 = sortedAsc[3];

      // Skip players with a trivial 100% line (e.g. zeros) — not actionable.
      if (v0 <= 0) return null;

      const line_100 = toKalshiLine(v0);
      const line_90  = toKalshiLine(v1);
      const line_80  = toKalshiLine(v2);
      const line_70  = toKalshiLine(v3);

      const rollingAvg = values.reduce((a: number, b: number) => a + b, 0) / values.length;

      return {
        player_id: p.id as number,
        player_name: p.name as string,
        team: p.team as string,
        position: p.position as string,
        line_100,
        line_90,
        line_80,
        line_70,
        rolling_avg: rollingAvg,
        games_used: STREAKS_WINDOW,
        opponent: null,
        recent_opp_form: null,
        key_teammates_out: [],
        opportunity_trend: null,
      } as TieredRow;
    }));

    const tieredRows: TieredRow[] = tieredResults.filter((r): r is TieredRow => r !== null);

    if (tieredRows.length === 0) {
      return res.json({ success: true, data: { stat, window: STREAKS_WINDOW, rows: [] } });
    }

    // ── E. Enrich with opponent + position-based defense rank
    const { data: teamRows } = await supabaseAdmin.from('teams').select('id,abbreviation');
    const abbrToId = new Map<string, number>();
    const idToAbbr = new Map<number, string>();
    for (const t of (teamRows ?? [])) {
      abbrToId.set((t.abbreviation ?? '').toUpperCase(), t.id);
      idToAbbr.set(t.id, t.abbreviation);
    }

    const opponentByTeamId = new Map<number, number>();
    for (const g of (todayGames ?? [])) {
      opponentByTeamId.set(g.home_team_id, g.away_team_id);
      opponentByTeamId.set(g.away_team_id, g.home_team_id);
    }

    const { data: oppDef } = await supabaseAdmin
      .from('opponent_position_defense')
      .select('team_id,position_group,league_rank,snapshot_date')
      .order('snapshot_date', { ascending: false });
    const latestOppDef = new Map<string, number>();
    for (const row of (oppDef ?? [])) {
      const key = `${row.team_id}-${row.position_group}`;
      if (!latestOppDef.has(key)) latestOppDef.set(key, row.league_rank);
    }

    // Picks v2: pull today's daily_conditions for the candidate set so we can
    // surface recent_opp_form (stat-specific), key_teammates_out, and
    // opportunity_trend (rolling vs season touches delta).
    const candidateIds = tieredRows.map((r) => r.player_id);
    const dcByPlayer = new Map<number, any>();
    if (candidateIds.length > 0) {
      const { data: dcRows } = await supabaseAdmin
        .from('daily_conditions')
        .select(
          'player_id, rolling_touches_5g, season_avg_touches, key_teammates_out, ' +
          'recent_opp_pts_form, recent_opp_reb_form, recent_opp_ast_form, recent_opp_fg3m_form'
        )
        .in('player_id', candidateIds)
        .eq('game_date', linesDate);
      for (const r of ((dcRows ?? []) as any[])) dcByPlayer.set(r.player_id, r);
    }
    const formColumn = `recent_opp_${stat}_form`;

    const enriched = tieredRows.map((r) => {
      const teamAbbr = (r.team ?? '').toUpperCase();
      const teamId = abbrToId.get(teamAbbr);
      const opponentId = teamId != null ? opponentByTeamId.get(teamId) : undefined;
      const opponentAbbr = opponentId != null ? (idToAbbr.get(opponentId) ?? null) : null;
      const pos = (r.position ?? '').toUpperCase();
      const positionGroup = pos.startsWith('G') ? 'G' : pos.startsWith('F') ? 'F' : 'C';
      const leagueRank =
        opponentId != null ? (latestOppDef.get(`${opponentId}-${positionGroup}`) ?? null) : null;

      // Picks v2 context
      const dc = dcByPlayer.get(r.player_id);
      const recentOppForm = (dc?.[formColumn] ?? null) as number | null;
      const keyTeammatesOut: number[] = (dc?.key_teammates_out ?? []) as number[];
      let opportunityTrend: number | null = null;
      const rt = dc?.rolling_touches_5g;
      const st = dc?.season_avg_touches;
      if (rt != null && st != null && st > 0) {
        opportunityTrend = (rt - st) / st;
      }

      return {
        ...r,
        opponent: opponentAbbr ? { team: opponentAbbr, league_rank: leagueRank } : null,
        recent_opp_form: recentOppForm,
        key_teammates_out: keyTeammatesOut,
        opportunity_trend: opportunityTrend,
      };
    });

    // Sort by line_100 DESC (highest guaranteed floor first), rolling_avg as tiebreaker
    enriched.sort((a, b) => {
      if (b.line_100 !== a.line_100) return b.line_100 - a.line_100;
      return b.rolling_avg - a.rolling_avg;
    });

    res.json({
      success: true,
      data: { stat, window: STREAKS_WINDOW, rows: enriched.slice(0, 10) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// cover_spread and over_total are both team-scoped:
//   cover_spread: did the team win by more than its spread line? (daily_lines.prop_type='spread', team_id=teamId)
//   over_total:   did the team's own score exceed its team-total line? (prop_type='total', team_id=teamId)
// team_id is now populated on daily_lines for all team-bearing Kalshi game-prop rows.
const GAME_STAT_CHOICES = new Set(['cover_spread', 'over_total', 'winner']);

async function getGamePerfectStreaks(_req: Request, res: Response, stat: string, window: number) {
  if (!GAME_STAT_CHOICES.has(stat)) {
    return res.status(400).json({ success: false, error: `invalid game stat: ${stat}` });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Today's teams
  const { data: todaysGames } = await supabaseAdmin
    .from('games')
    .select('id,home_team_id,away_team_id')
    .eq('game_date', today)
    .eq('league_id', 1);
  const slateTeamIds = new Set<number>();
  for (const g of (todaysGames ?? [])) {
    slateTeamIds.add(g.home_team_id);
    slateTeamIds.add(g.away_team_id);
  }
  if (slateTeamIds.size === 0) {
    console.warn('[getGamePerfectStreaks] no teams on today\'s slate');
    return res.json({ success: true, data: { stat, window, rows: [] } });
  }

  const candidateTeamIds = [...slateTeamIds];

  // For each candidate team, pull last `window` completed games and evaluate
  const rows = await Promise.all(candidateTeamIds.map(async (teamId) => {
    const { data: history } = await supabaseAdmin
      .from('games')
      .select('id,game_date,home_team_id,away_team_id,home_score,away_score')
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .lt('game_date', today)
      .order('game_date', { ascending: false })
      .limit(window);

    if (!history || history.length < window) return null;

    let allHit = true;
    for (const g of history) {
      const isHome = g.home_team_id === teamId;
      if (g.home_score == null || g.away_score == null) {
        allHit = false;
        break;
      }

      if (stat === 'winner') {
        const won = isHome ? g.home_score > g.away_score : g.away_score > g.home_score;
        if (!won) { allHit = false; break; }
      } else {
        // For both cover_spread and over_total, look up the team-scoped line
        // for this historical game. team_id on daily_lines filters to the team's
        // spread/teamtotal market specifically (not 1H/2H game-level totals).
        const neededPropType = stat === 'cover_spread' ? 'spread' : 'total';
        const { data: lineRow } = await supabaseAdmin
          .from('daily_lines')
          .select('line')
          .eq('game_date', g.game_date)
          .eq('entity_id', g.id)
          .eq('prop_type', neededPropType)
          .eq('team_id', teamId)
          .limit(1)
          .maybeSingle();
        if (!lineRow) { allHit = false; break; }

        if (stat === 'cover_spread') {
          // "Covered" means team won by more than the spread line
          const margin = isHome ? (g.home_score - g.away_score) : (g.away_score - g.home_score);
          if (!(margin > lineRow.line)) { allHit = false; break; }
        } else {
          // over_total (team-scoped): did the team's own score beat its team-total line?
          const teamScore = isHome ? g.home_score : g.away_score;
          if (!(teamScore > lineRow.line)) { allHit = false; break; }
        }
      }
    }
    if (!allHit) return null;
    return { team_id: teamId, streak_count: window };
  }));

  const hits = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  if (hits.length === 0) {
    return res.json({ success: true, data: { stat, window, rows: [] } });
  }

  // Enrich with team abbr + today's opponent
  const { data: teams } = await supabaseAdmin.from('teams').select('id,abbreviation,name');
  const teamMap = new Map<number, any>();
  for (const t of (teams ?? [])) teamMap.set(t.id, t);

  const opponentByTeam = new Map<number, number>();
  for (const g of (todaysGames ?? [])) {
    opponentByTeam.set(g.home_team_id, g.away_team_id);
    opponentByTeam.set(g.away_team_id, g.home_team_id);
  }

  const enriched = hits.map((h) => {
    const team: any = teamMap.get(h.team_id) ?? {};
    const oppId = opponentByTeam.get(h.team_id);
    const opp: any = oppId != null ? teamMap.get(oppId) : null;
    return {
      team_id: h.team_id,
      team_abbr: team.abbreviation ?? null,
      team_name: team.name ?? null,
      streak_count: h.streak_count,
      opponent: opp ? { team: opp.abbreviation, team_name: opp.name } : null,
    };
  });

  res.json({
    success: true,
    data: { stat, window, rows: enriched.slice(0, 10) },
  });
}
