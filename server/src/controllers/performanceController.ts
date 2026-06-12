import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league as resolveLeague, LeagueConfig } from '../config/leagues';

// Build the stats SELECT for streak computation from the league's streak stats.
function streakStatsSelect(lg: LeagueConfig): string {
  const cols = lg.streakStats.map((s) => lg.statConfig[s].col);
  return `player_id, game_date, ${cols.join(', ')}, ${lg.playedGate.col}`;
}

function toKalshiLine(value: number): number {
  const half = Math.floor(value * 2) / 2;
  if (half === value) return half - 0.5;
  return half;
}

const BUCKET_EXPECTED: Record<number, number> = {
  50: 0.55, 60: 0.65, 70: 0.75, 80: 0.85,
};

function toBucket(impliedProb: number | null): number {
  const pct = Math.round((impliedProb ?? 0) * 100);
  const b = Math.floor(pct / 10) * 10;
  return Math.max(50, Math.min(80, b));
}

function aggregate(picks: any[]) {
  const settled = picks.filter(p => p.did_hit !== null && p.did_hit !== undefined);
  const hits    = settled.filter(p => p.did_hit === true).length;
  const misses  = settled.filter(p => p.did_hit === false).length;
  const pending = picks.filter(p => p.did_hit === null || p.did_hit === undefined).length;
  const hitRate = settled.length > 0 ? hits / settled.length : null;
  return { total: picks.length, settled: settled.length, hits, misses, pending, hitRate };
}

export async function getPerformanceSummary(req: Request<{}, {}, {}, { days?: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const days = Math.min(365, Math.max(1, parseInt(req.query.days ?? '1', 10) || 1));
    const today = new Date().toISOString().slice(0, 10);
    // days=1 → today only; days=7 → last 7 days including today

    const cutoff = days === 1
      ? today
      : new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

    // ── Fetch all picks in range
    const { data: rawPicks, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id,game_date,entity_id,stat,pick_type,prop_type,' +
        'recommended_line,hit_rate,confidence_score,implied_prob,edge,' +
        'did_hit,actual_result,modifiers'
      )
      .eq('league_id', lg.leagueId)
      .gte('game_date', cutoff)
      .lte('game_date', today)
      .order('game_date', { ascending: false });

    if (error) throw error;
    const picks = (rawPicks ?? []) as any[];

    // ── Join player names for player props
    const playerIds = [...new Set(
      picks.filter(p => p.prop_type === 'player' && p.entity_id != null).map(p => p.entity_id)
    )];
    const { data: players } = playerIds.length
      ? await supabaseAdmin.from('players').select('id,name,team').in('id', playerIds)
      : { data: [] as any[] };
    const playerMap = new Map((players ?? []).map((p: any) => [p.id, p]));

    // ── Join game info for game props (spread/total/winner)
    const gamePickIds = [...new Set(
      picks.filter(p => p.prop_type !== 'player' && p.entity_id != null).map(p => p.entity_id)
    )];
    let gameMap = new Map<number, { homeAbbr: string; awayAbbr: string }>();
    if (gamePickIds.length) {
      const { data: gameRows } = await supabaseAdmin
        .from('games')
        .select('id,home_team_id,away_team_id')
        .in('id', gamePickIds);
      const teamIds = [...new Set((gameRows ?? []).flatMap((g: any) => [g.home_team_id, g.away_team_id]))];
      const { data: teamRows } = teamIds.length
        ? await supabaseAdmin.from('teams').select('id,abbreviation').in('id', teamIds)
        : { data: [] as any[] };
      const teamAbbrMap = new Map((teamRows ?? []).map((t: any) => [t.id, t.abbreviation as string]));
      for (const g of (gameRows ?? []) as any[]) {
        gameMap.set(g.id, {
          homeAbbr: teamAbbrMap.get(g.home_team_id) ?? '',
          awayAbbr: teamAbbrMap.get(g.away_team_id) ?? '',
        });
      }
    }

    // ── Derive POTD: highest-confidence player pick per game_date
    const potdIds = new Set<number>();
    const playerPicksByDate = new Map<string, any>();
    for (const p of picks) {
      if (p.prop_type !== 'player') continue;
      const existing = playerPicksByDate.get(p.game_date);
      if (!existing || (p.confidence_score ?? 0) > (existing.confidence_score ?? 0)) {
        playerPicksByDate.set(p.game_date, p);
      }
    }
    for (const p of playerPicksByDate.values()) potdIds.add(p.id);

    // ── Annotate picks with bucket + isPotd + player/game info
    const annotated = picks.map(p => {
      const isPlayer = p.prop_type === 'player';
      const pl = isPlayer ? playerMap.get(p.entity_id) : null;

      let displayName: string | null = null;
      let displayTeam: string | null = null;

      if (isPlayer) {
        displayName = pl?.name ?? null;
        displayTeam = pl?.team ?? null;
      } else {
        const game = gameMap.get(p.entity_id);
        const mods = p.modifiers ?? {};
        const teamAbbr: string | null = mods.team_abbr ?? null;
        const line = p.recommended_line;

        if (p.prop_type === 'spread' && teamAbbr && game) {
          // teamAbbr is the team receiving points in the Kalshi market (underdog side)
          // Determine sign: if teamAbbr is home team they're favored → negative spread
          const isHome = teamAbbr === game.homeAbbr;
          const sign = isHome ? '-' : '+';
          displayName = `${teamAbbr} ${sign}${line}`;
          const otherAbbr = isHome ? game.awayAbbr : game.homeAbbr;
          displayTeam = `vs ${otherAbbr}`;
        } else if (game) {
          displayName = `${game.homeAbbr} vs ${game.awayAbbr}`;
          displayTeam = p.prop_type?.toUpperCase() ?? null;
        } else {
          displayName = p.prop_type ?? null;
          displayTeam = null;
        }
      }

      return {
        id: p.id,
        game_date: p.game_date,
        player_id: isPlayer ? p.entity_id : null,
        player_name: displayName,
        team: displayTeam,
        stat: p.stat ?? null,
        stat_label: p.stat ? (lg.statLabels[p.stat] ?? p.stat.toUpperCase()) : null,
        prop_type: p.prop_type,
        pick_type: p.pick_type,
        line: p.recommended_line ?? null,
        implied_prob: p.implied_prob ?? null,
        hit_rate: p.hit_rate ?? null,
        edge: p.edge ?? null,
        confidence: p.confidence_score ?? null,
        did_hit: p.did_hit ?? null,
        actual_result: p.actual_result ?? null,
        bucket: toBucket(p.implied_prob),
        is_potd: potdIds.has(p.id),
      };
    });

    // ── Bucket aggregations (50/60/70/80)
    const BUCKETS = [50, 60, 70, 80] as const;
    const buckets = BUCKETS.map(b => {
      const group = annotated.filter(p => toBucket(p.implied_prob) === b);
      const agg = aggregate(group);
      const expected = BUCKET_EXPECTED[b];
      return {
        bucket: b,
        label: `${b}–${b + 9}%`,
        ...agg,
        expectedRate: expected,
        edgeVsMarket: agg.hitRate != null ? +(agg.hitRate - expected).toFixed(3) : null,
      };
    });

    // ── Segment aggregations
    const playerPicksAll = annotated.filter(p => p.prop_type === 'player');
    const gamePicksAll   = annotated.filter(p => p.prop_type !== 'player');
    const potdAll        = annotated.filter(p => p.is_potd);

    // ── Overall
    const overall = aggregate(annotated);

    // ── Recent picks (limit 50, most recent first)
    const recentPicks = annotated.slice(0, 50);

    res.json({
      success: true,
      data: {
        period: { days, from: cutoff, to: today },
        overall,
        buckets,
        playerProps: aggregate(playerPicksAll),
        gameProps: aggregate(gamePicksAll),
        potd: aggregate(potdAll),
        recentPicks,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Paginate a Supabase query that returns plain rows, working around the default 1000-row cap. */
async function paginateStats(
  builder: () => any,
  col: string,
): Promise<any[]> {
  const rows: any[] = [];
  for (let page = 0; page < 30; page++) {
    const { data, error } = await (builder() as any)
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export async function getStreakOutcomes(req: Request<{}, {}, {}, { days?: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const days = Math.min(365, Math.max(1, parseInt(req.query.days ?? '1', 10) || 1));
    const today = new Date().toISOString().slice(0, 10);
    const rawCutoff = days === 1
      ? today
      : new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    // Never show streak rows before tracking began
    const cutoff = rawCutoff < lg.streakStartDate ? lg.streakStartDate : rawCutoff;
    const extCutoff = new Date(Date.parse(cutoff + 'T00:00:00Z') - 180 * 86400000)
      .toISOString().slice(0, 10);

    // ── Build per-date eligible player sets.
    //    For today (pending): use ESPN scoreboard, same as the NBA streaks page.
    //    For historical dates: use the games table + player_availability.

    const [{ data: teamRows }, { data: allPlayerRows }] = await Promise.all([
      supabaseAdmin.from('teams').select('id, abbreviation').eq('league_id', lg.leagueId),
      supabaseAdmin.from('players').select('id, name, team, position').eq('league', lg.playerLeagueTag),
    ]);

    const teamIdToAbbr = new Map<number, string>();
    for (const t of (teamRows ?? [])) teamIdToAbbr.set(t.id, (t.abbreviation ?? '').toUpperCase());

    const playerMap = new Map((allPlayerRows ?? []).map((p: any) => [p.id, p]));

    // team abbr → player IDs lookup
    const playersByTeam = new Map<string, number[]>();
    for (const [pid, p] of playerMap) {
      const abbr = (p.team ?? '').toUpperCase();
      if (!playersByTeam.has(abbr)) playersByTeam.set(abbr, []);
      playersByTeam.get(abbr)!.push(pid);
    }

    const eligibleByDate = new Map<string, Set<number>>();

    // ── Today's slate via DB games table
    const { data: todaySlateGames } = await supabaseAdmin
      .from('games')
      .select('id, home_team_id, away_team_id')
      .eq('game_date', today)
      .eq('league_id', lg.leagueId);
    const todaySlateTeamIds = new Set<number>();
    for (const g of (todaySlateGames ?? [])) {
      todaySlateTeamIds.add(g.home_team_id);
      todaySlateTeamIds.add(g.away_team_id);
    }
    const todayTeamAbbrs = new Set<string>();
    for (const tid of todaySlateTeamIds) {
      const abbr = teamIdToAbbr.get(tid);
      if (abbr) todayTeamAbbrs.add(abbr);
    }

    if (todayTeamAbbrs.size > 0) {
      // "out" players for today's games
      const { data: todayGames } = await supabaseAdmin
        .from('games')
        .select('id')
        .eq('game_date', today)
        .eq('league_id', lg.leagueId);
      const todayGameIds = (todayGames ?? []).map((g: any) => g.id);
      const todayOuts = new Set<number>();
      if (todayGameIds.length > 0) {
        const { data: outRows } = await supabaseAdmin
          .from('player_availability')
          .select('player_id')
          .eq('status', 'out')
          .in('game_id', todayGameIds);
        for (const r of (outRows ?? [])) todayOuts.add(r.player_id);
      }
      const todayEligible = new Set<number>();
      for (const abbr of todayTeamAbbrs) {
        for (const pid of (playersByTeam.get(abbr) ?? [])) {
          if (!todayOuts.has(pid)) todayEligible.add(pid);
        }
      }
      eligibleByDate.set(today, todayEligible);
    }

    // ── Historical dates via games table
    if (cutoff < today) {
      const { data: gameRows } = await supabaseAdmin
        .from('games')
        .select('id, game_date, home_team_id, away_team_id')
        .gte('game_date', cutoff)
        .lt('game_date', today)
        .eq('league_id', lg.leagueId);

      const teamAbbrsByDate = new Map<string, Set<string>>();
      const gameIdToDate = new Map<number, string>();
      for (const g of (gameRows ?? [])) {
        if (!teamAbbrsByDate.has(g.game_date)) teamAbbrsByDate.set(g.game_date, new Set());
        const ha = teamIdToAbbr.get(g.home_team_id);
        const aa = teamIdToAbbr.get(g.away_team_id);
        if (ha) teamAbbrsByDate.get(g.game_date)!.add(ha);
        if (aa) teamAbbrsByDate.get(g.game_date)!.add(aa);
        gameIdToDate.set(g.id, g.game_date);
      }

      const histGameIds = [...gameIdToDate.keys()];
      const outByDate = new Map<string, Set<number>>();
      if (histGameIds.length > 0) {
        const { data: outRows } = await supabaseAdmin
          .from('player_availability')
          .select('game_id, player_id')
          .eq('status', 'out')
          .in('game_id', histGameIds);
        for (const r of (outRows ?? [])) {
          const date = gameIdToDate.get(r.game_id);
          if (!date) continue;
          if (!outByDate.has(date)) outByDate.set(date, new Set());
          outByDate.get(date)!.add(r.player_id);
        }
      }

      for (const [date, teamAbbrs] of teamAbbrsByDate) {
        const outs = outByDate.get(date) ?? new Set<number>();
        const eligible = new Set<number>();
        for (const abbr of teamAbbrs) {
          for (const pid of (playersByTeam.get(abbr) ?? [])) {
            if (!outs.has(pid)) eligible.add(pid);
          }
        }
        eligibleByDate.set(date, eligible);
      }
    }

    // relevantIds: union of all eligible players across all dates in range
    const relevantIds = [...new Set(
      [...eligibleByDate.values()].flatMap(s => [...s])
    )];

    type OutcomeRow = {
      player_id: number; player_name: string | null; team: string | null;
      stat: string; stat_label: string; game_date: string;
      line_100: number; line_90: number; line_80: number; line_70: number;
      actual: number | null;
      hit_100: boolean | null; hit_90: boolean | null;
      hit_80: boolean | null; hit_70: boolean | null;
      did_hit: boolean | null;
    };

    const allRows: OutcomeRow[] = [];
    const seen = new Set<string>();

    for (const stat of lg.streakStats) {
      const col = lg.statConfig[stat].col;
      const statLabel = lg.statLabels[stat];

      const statsData = await paginateStats(
        () => supabaseAdmin
          .from('nba_player_stats')
          .select('player_id, game_date, points, rebounds, assists, three_points_made, minutes_played')
          .in('player_id', relevantIds)
          .gte('game_date', extCutoff)
          .lte('game_date', today)
          .gt('minutes_played', 0)
          .order('game_date', { ascending: true }),
        col,
      );

      type GameEntry = { game_date: string; value: number };
      const byPlayer = new Map<number, GameEntry[]>();
      const hasStatsToday = new Set<number>();

      for (const row of statsData as any[]) {
        const val = row[col];
        if (val == null) continue;
        if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
        byPlayer.get(row.player_id)!.push({ game_date: row.game_date, value: Number(val) });
        if (row.game_date === today) hasStatsToday.add(row.player_id);
      }

      // Collect candidates per game_date — top 10 by line_100 DESC (rolling_avg tiebreaker)
      const candidatesByDate = new Map<string, Array<{ row: OutcomeRow; rollingAvg: number }>>();

      for (const [date, eligible] of eligibleByDate) {
        const isToday = date === today;

        for (const playerId of eligible) {
          const games = byPlayer.get(playerId);

          // Pending: on today's slate, game not played yet
          if (isToday && !hasStatsToday.has(playerId)) {
            const key = `${playerId}|${stat}|${today}`;
            if (seen.has(key) || !games) continue;

            const priorGames = games.filter(g => g.game_date < today);
            if (priorGames.length < 10) continue;

            const prior10 = priorGames.slice(-10).map(g => g.value).sort((a, b) => a - b);
            if (prior10[0] <= 0) continue;

            seen.add(key);
            const player = playerMap.get(playerId);
            const row: OutcomeRow = {
              player_id: playerId,
              player_name: player?.name ?? null,
              team: player?.team ?? null,
              stat, stat_label: statLabel,
              game_date: today,
              line_100: toKalshiLine(prior10[0]),
              line_90:  toKalshiLine(prior10[1]),
              line_80:  toKalshiLine(prior10[2]),
              line_70:  toKalshiLine(prior10[3]),
              actual: null,
              hit_100: null, hit_90: null, hit_80: null, hit_70: null,
              did_hit: null,
            };
            const rollingAvg = prior10.reduce((a, b) => a + b, 0) / 10;
            if (!candidatesByDate.has(today)) candidatesByDate.set(today, []);
            candidatesByDate.get(today)!.push({ row, rollingAvg });
            continue;
          }

          // Settled: find this player's game entry on `date`
          if (!games) continue;
          const gameIdx = games.findIndex(g => g.game_date === date);
          if (gameIdx < 10) continue; // need at least 10 prior games

          const prior10 = games.slice(gameIdx - 10, gameIdx).map(g => g.value).sort((a, b) => a - b);
          if (prior10[0] <= 0) continue;

          const key = `${playerId}|${stat}|${date}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const actual = games[gameIdx].value;
          const player = playerMap.get(playerId);
          const row: OutcomeRow = {
            player_id: playerId,
            player_name: player?.name ?? null,
            team: player?.team ?? null,
            stat, stat_label: statLabel,
            game_date: date,
            line_100: toKalshiLine(prior10[0]),
            line_90:  toKalshiLine(prior10[1]),
            line_80:  toKalshiLine(prior10[2]),
            line_70:  toKalshiLine(prior10[3]),
            actual,
            hit_100: actual > toKalshiLine(prior10[0]),
            hit_90:  actual > toKalshiLine(prior10[1]),
            hit_80:  actual > toKalshiLine(prior10[2]),
            hit_70:  actual > toKalshiLine(prior10[3]),
            did_hit: actual > toKalshiLine(prior10[0]),
          };
          const rollingAvg = prior10.reduce((a, b) => a + b, 0) / 10;
          if (!candidatesByDate.has(date)) candidatesByDate.set(date, []);
          candidatesByDate.get(date)!.push({ row, rollingAvg });
        }
      }

      // Keep only top 10 per date — same sort as NBA streaks page: line_100 DESC, rolling_avg tiebreaker
      for (const candidates of candidatesByDate.values()) {
        candidates.sort((a, b) => {
          if (b.row.line_100 !== a.row.line_100) return b.row.line_100 - a.row.line_100;
          return b.rollingAvg - a.rollingAvg;
        });
        for (const { row } of candidates.slice(0, 10)) {
          allRows.push(row);
        }
      }
    }

    allRows.sort((a, b) => {
      if (a.game_date !== b.game_date) return b.game_date.localeCompare(a.game_date);
      if (a.did_hit === null && b.did_hit !== null) return -1;
      if (a.did_hit !== null && b.did_hit === null) return 1;
      return (a.player_name ?? '').localeCompare(b.player_name ?? '');
    });

    res.json({
      success: true,
      data: { period: { days, from: cutoff, to: today }, rows: allRows.slice(0, 200) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getStreakPerformance(req: Request<{}, {}, {}, { days?: string; stat?: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const days = Math.min(365, Math.max(1, parseInt(req.query.days ?? '30', 10) || 30));
    const stat = (req.query.stat ?? lg.streakStats[0]).toLowerCase();
    const col = lg.statConfig[stat]?.col;
    if (!col) return res.status(400).json({ success: false, error: `invalid stat: ${stat}` });

    const today = new Date().toISOString().slice(0, 10);
    const rawCutoff = days === 1
      ? today
      : new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const cutoff = rawCutoff < lg.streakStartDate ? lg.streakStartDate : rawCutoff;
    const extCutoff = new Date(Date.parse(cutoff + 'T00:00:00Z') - 180 * 86400000).toISOString().slice(0, 10);

    // ── Build eligibleByDate — same logic as getStreakOutcomes ────────────────
    const [{ data: teamRows }, { data: allPlayerRows }] = await Promise.all([
      supabaseAdmin.from('teams').select('id, abbreviation').eq('league_id', lg.leagueId),
      supabaseAdmin.from('players').select('id, name, team, position').eq('league', lg.playerLeagueTag),
    ]);

    const teamIdToAbbr = new Map<number, string>();
    for (const t of (teamRows ?? [])) teamIdToAbbr.set(t.id, (t.abbreviation ?? '').toUpperCase());

    const playerMap = new Map((allPlayerRows ?? []).map((p: any) => [p.id, p]));
    const playersByTeam = new Map<string, number[]>();
    for (const [pid, p] of playerMap) {
      const abbr = (p.team ?? '').toUpperCase();
      if (!playersByTeam.has(abbr)) playersByTeam.set(abbr, []);
      playersByTeam.get(abbr)!.push(pid);
    }

    const eligibleByDate = new Map<string, Set<number>>();

    const { data: todaySlateGames2 } = await supabaseAdmin
      .from('games')
      .select('id, home_team_id, away_team_id')
      .eq('game_date', today)
      .eq('league_id', lg.leagueId);
    const todaySlateTeamIds2 = new Set<number>();
    for (const g of (todaySlateGames2 ?? [])) {
      todaySlateTeamIds2.add(g.home_team_id);
      todaySlateTeamIds2.add(g.away_team_id);
    }
    const todayTeamAbbrs = new Set<string>();
    for (const tid of todaySlateTeamIds2) {
      const abbr = teamIdToAbbr.get(tid);
      if (abbr) todayTeamAbbrs.add(abbr);
    }
    if (todayTeamAbbrs.size > 0) {
      const { data: todayGames } = await supabaseAdmin.from('games').select('id').eq('game_date', today).eq('league_id', lg.leagueId);
      const todayGameIds = (todayGames ?? []).map((g: any) => g.id);
      const todayOuts = new Set<number>();
      if (todayGameIds.length > 0) {
        const { data: outRows } = await supabaseAdmin.from('player_availability').select('player_id').eq('status', 'out').in('game_id', todayGameIds);
        for (const r of (outRows ?? [])) todayOuts.add(r.player_id);
      }
      const todayEligible = new Set<number>();
      for (const abbr of todayTeamAbbrs) {
        for (const pid of (playersByTeam.get(abbr) ?? [])) {
          if (!todayOuts.has(pid)) todayEligible.add(pid);
        }
      }
      eligibleByDate.set(today, todayEligible);
    }

    if (cutoff < today) {
      const { data: gameRows } = await supabaseAdmin.from('games').select('id, game_date, home_team_id, away_team_id').gte('game_date', cutoff).lt('game_date', today).eq('league_id', lg.leagueId);
      const teamAbbrsByDate = new Map<string, Set<string>>();
      const gameIdToDate = new Map<number, string>();
      for (const g of (gameRows ?? [])) {
        if (!teamAbbrsByDate.has(g.game_date)) teamAbbrsByDate.set(g.game_date, new Set());
        const ha = teamIdToAbbr.get(g.home_team_id);
        const aa = teamIdToAbbr.get(g.away_team_id);
        if (ha) teamAbbrsByDate.get(g.game_date)!.add(ha);
        if (aa) teamAbbrsByDate.get(g.game_date)!.add(aa);
        gameIdToDate.set(g.id, g.game_date);
      }
      const histGameIds = [...gameIdToDate.keys()];
      const outByDate = new Map<string, Set<number>>();
      if (histGameIds.length > 0) {
        const { data: outRows } = await supabaseAdmin.from('player_availability').select('game_id, player_id').eq('status', 'out').in('game_id', histGameIds);
        for (const r of (outRows ?? [])) {
          const d = gameIdToDate.get(r.game_id);
          if (!d) continue;
          if (!outByDate.has(d)) outByDate.set(d, new Set());
          outByDate.get(d)!.add(r.player_id);
        }
      }
      for (const [d, teamAbbrs] of teamAbbrsByDate) {
        const outs = outByDate.get(d) ?? new Set<number>();
        const eligible = new Set<number>();
        for (const abbr of teamAbbrs) {
          for (const pid of (playersByTeam.get(abbr) ?? [])) {
            if (!outs.has(pid)) eligible.add(pid);
          }
        }
        eligibleByDate.set(d, eligible);
      }
    }

    const relevantIds = [...new Set([...eligibleByDate.values()].flatMap(s => [...s]))];

    // ── Fetch stats for this stat, paginated ──────────────────────────────────
    const statsData = await paginateStats(
      () => supabaseAdmin
        .from(lg.statsTable)
        .select(streakStatsSelect(lg))
        .in('player_id', relevantIds)
        .gte('game_date', extCutoff)
        .lte('game_date', today)
        .gt(lg.playedGate.col, lg.playedGate.min)
        .order('game_date', { ascending: true }),
      col,
    );

    type GameEntry = { game_date: string; value: number };
    const byPlayer = new Map<number, GameEntry[]>();
    const hasStatsToday = new Set<number>();
    for (const row of statsData as any[]) {
      const val = row[col];
      if (val == null) continue;
      if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
      byPlayer.get(row.player_id)!.push({ game_date: row.game_date, value: Number(val) });
      if (row.game_date === today) hasStatsToday.add(row.player_id);
    }

    // ── Build candidatesByDate with top-10 filter, then aggregate into tiers ─
    type TierKey = '10/10' | '9/10' | '8/10' | '7/10';
    const TIERS: TierKey[] = ['10/10', '9/10', '8/10', '7/10'];
    const acc: Record<TierKey, { hits: number; total: number }> = {
      '10/10': { hits: 0, total: 0 }, '9/10': { hits: 0, total: 0 },
      '8/10':  { hits: 0, total: 0 }, '7/10': { hits: 0, total: 0 },
    };

    const seen = new Set<string>();

    for (const [date, eligible] of eligibleByDate) {
      const isToday = date === today;
      const candidates: Array<{ lines: number[]; actual: number | null; rollingAvg: number; line100: number }> = [];

      for (const playerId of eligible) {
        const games = byPlayer.get(playerId);

        if (isToday && !hasStatsToday.has(playerId)) {
          const key = `${playerId}|${stat}|${today}`;
          if (seen.has(key) || !games) continue;
          const priorGames = games.filter(g => g.game_date < today);
          if (priorGames.length < 10) continue;
          const prior10 = priorGames.slice(-10).map(g => g.value).sort((a, b) => a - b);
          if (prior10[0] <= 0) continue;
          seen.add(key);
          const lines = [toKalshiLine(prior10[0]), toKalshiLine(prior10[1]), toKalshiLine(prior10[2]), toKalshiLine(prior10[3])];
          candidates.push({ lines, actual: null, rollingAvg: prior10.reduce((a, b) => a + b, 0) / 10, line100: lines[0] });
          continue;
        }

        if (!games) continue;
        const gameIdx = games.findIndex(g => g.game_date === date);
        if (gameIdx < 10) continue;
        const prior10 = games.slice(gameIdx - 10, gameIdx).map(g => g.value).sort((a, b) => a - b);
        if (prior10[0] <= 0) continue;
        const key = `${playerId}|${stat}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lines = [toKalshiLine(prior10[0]), toKalshiLine(prior10[1]), toKalshiLine(prior10[2]), toKalshiLine(prior10[3])];
        candidates.push({ lines, actual: games[gameIdx].value, rollingAvg: prior10.reduce((a, b) => a + b, 0) / 10, line100: lines[0] });
      }

      // top 10 per date — same sort as getStreakOutcomes
      candidates.sort((a, b) => b.line100 !== a.line100 ? b.line100 - a.line100 : b.rollingAvg - a.rollingAvg);
      for (const c of candidates.slice(0, 10)) {
        if (c.actual === null) continue; // pending — skip from tier counts
        for (let t = 0; t < 4; t++) {
          acc[TIERS[t]].total++;
          if (c.actual > c.lines[t]) acc[TIERS[t]].hits++;
        }
      }
    }

    const tiers = TIERS.map(tier => {
      const { hits, total } = acc[tier];
      return { tier, hits, misses: total - hits, total, hitRate: total > 0 ? +(hits / total).toFixed(4) : null };
    });

    res.json({
      success: true,
      data: { period: { days, from: cutoff, to: today }, stat, tiers },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
