import { supabaseAdmin } from '../config/supabaseAdmin';

const PICK_STAT_LABELS: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM',
};

const STAT_TO_COLUMN: Record<string, { col: string; statId: number }> = {
  pts: { col: 'points', statId: 0 },
  reb: { col: 'rebounds', statId: 1 },
  ast: { col: 'assists', statId: 2 },
  fg3m: { col: 'three_points_made', statId: 3 },
};

// Resolve the nearest upcoming slate with picks.
// Mirrors getTodaysPicks fallback in nbaController.ts (~lines 246-255).
async function findNearestPickDate(today: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('pick_results')
    .select('game_date')
    .gte('game_date', today)
    .order('game_date', { ascending: true })
    .limit(1)
    .single();
  return data?.game_date ?? today;
}

export async function getTopPicks(req: any, res: any) {
  try {
    const parsed = parseInt((req.query.limit as string) ?? '5', 10);
    const limit = Number.isNaN(parsed) ? 5 : Math.max(1, Math.min(20, parsed));
    const today = new Date().toISOString().slice(0, 10);
    const pickDate = await findNearestPickDate(today);

    const { data: picks, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id,entity_id,stat,pick_type,prop_type,recommended_line,hit_rate,' +
        'sample_size,confidence_score,implied_prob,edge'
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

    // Dedupe game picks by (game_id, prop_type), preferring pick_type='safe'
    const bestPerGameProp = new Map<string, any>();
    for (const g of gameRows) {
      const key = `${g.entity_id}-${g.prop_type}`;
      const existing = bestPerGameProp.get(key);
      if (!existing || (g.pick_type === 'safe' && existing.pick_type !== 'safe')) {
        bestPerGameProp.set(key, g);
      }
    }
    const dedupedGameRows = Array.from(bestPerGameProp.values())
      .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0));

    // ── Player side: dedupe by (entity_id, stat), prefer pick_type='safe'
    const bestPerPlayerStat = new Map<string, any>();
    for (const p of playerRows) {
      const key = `${p.entity_id}-${p.stat}`;
      const existing = bestPerPlayerStat.get(key);
      if (!existing || (p.pick_type === 'safe' && existing.pick_type !== 'safe')) {
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
        stat_label: PICK_STAT_LABELS[p.stat] ?? String(p.stat).toUpperCase(),
        pick_type: p.pick_type,
        line: p.recommended_line,
        direction,
        hit_rate: p.hit_rate,
        confidence: p.confidence_score,
        edge: p.edge,
        sample_size: p.sample_size,
        implied_prob: p.implied_prob,
        opponent,
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

export async function getPerfectStreaks(req: any, res: any) {
  try {
    const type = ((req.query.type as string) ?? 'player').toLowerCase();
    const stat = ((req.query.stat as string) ?? 'pts').toLowerCase();
    const parsedWindow = parseInt((req.query.window as string) ?? '5', 10);
    const window = Number.isNaN(parsedWindow)
      ? 5
      : Math.max(3, Math.min(10, parsedWindow));

    if (type === 'game') {
      return await getGamePerfectStreaks(req, res, stat, window);
    }
    if (type !== 'player') {
      return res.status(400).json({ success: false, error: `unknown type: ${type}` });
    }

    const statCfg = STAT_TO_COLUMN[stat];
    if (!statCfg) {
      return res.status(400).json({ success: false, error: `invalid stat: ${stat}` });
    }

    const today = new Date().toISOString().slice(0, 10);

    // ── A. Today's slate teams (ESPN)
    const espn = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard')
      .then((r) => {
        if (!r.ok) {
          console.error(`[getPerfectStreaks] ESPN scoreboard returned ${r.status}`);
          return null;
        }
        return r.json();
      })
      .catch((err) => {
        console.error('[getPerfectStreaks] ESPN scoreboard fetch failed:', err?.message ?? err);
        return null;
      });
    const slateTeams = new Set<string>();
    for (const ev of (((espn as any)?.events) ?? [])) {
      for (const c of (ev.competitions?.[0]?.competitors ?? [])) {
        const abbr = c.team?.abbreviation?.toUpperCase();
        if (abbr) slateTeams.add(abbr);
      }
    }
    if (slateTeams.size === 0) {
      console.warn('[getPerfectStreaks] no teams on today\'s ESPN slate — returning empty rows');
      return res.json({ success: true, data: { stat, window, rows: [] } });
    }

    // ── B. Today's games + out players
    const { data: games } = await supabaseAdmin
      .from('games')
      .select('id,home_team_id,away_team_id')
      .eq('game_date', today)
      .eq('league_id', 1);
    const gameIds = (games ?? []).map((g: any) => g.id);

    const outIds = new Set<number>();
    if (gameIds.length > 0) {
      const { data: outRows } = await supabaseAdmin
        .from('player_availability')
        .select('player_id')
        .eq('status', 'out')
        .in('game_id', gameIds);
      for (const r of (outRows ?? [])) outIds.add(r.player_id);
    }

    // ── C. Candidates: today's lines ≤ 0.80 implied prob for this stat
    const { data: lines } = await supabaseAdmin
      .from('daily_lines')
      .select('entity_id,stat,implied_prob,line')
      .eq('game_date', today)
      .eq('prop_type', 'player')
      .eq('stat', stat)
      .lte('implied_prob', 0.80);
    const linesByPlayer = new Map<number, { line: number; implied_prob: number }>();
    for (const l of (lines ?? [])) {
      const existing = linesByPlayer.get(l.entity_id);
      if (!existing || l.implied_prob < existing.implied_prob) {
        linesByPlayer.set(l.entity_id, { line: l.line, implied_prob: l.implied_prob });
      }
    }
    const candidateIds = [...linesByPlayer.keys()].filter((id) => !outIds.has(id));
    if (candidateIds.length === 0) {
      return res.json({ success: true, data: { stat, window, rows: [] } });
    }

    // ── D. Players meta — filter to teams on slate
    const { data: players } = await supabaseAdmin
      .from('players')
      .select('id,name,team,position')
      .in('id', candidateIds);
    const candidates = (players ?? []).filter((p: any) =>
      slateTeams.has((p.team ?? '').toUpperCase())
    );
    if (candidates.length === 0) {
      return res.json({ success: true, data: { stat, window, rows: [] } });
    }

    // ── E. For each candidate: fetch last `window` games + season avg → keep if all hit
    const rows = await Promise.all(candidates.map(async (p: any) => {
      const { data: statRows } = await supabaseAdmin
        .from('nba_player_stats')
        .select(`game_date,${statCfg.col}`)
        .eq('player_id', p.id)
        .order('game_date', { ascending: false })
        .limit(window);
      if (!statRows || statRows.length < window) return null;

      const { data: trend } = await supabaseAdmin
        .from('nba_trends')
        .select('season_avg')
        .eq('player_id', p.id)
        .eq('stat', statCfg.statId)
        .eq('window_size', 10)
        .limit(1)
        .maybeSingle();
      const seasonAvg: number | null = trend?.season_avg ?? null;
      if (seasonAvg == null) return null;

      const values: number[] = statRows
        .map((r: any) => r[statCfg.col])
        .filter((v: any) => v != null);
      if (values.length < window) return null;

      const threshold = stat === 'fg3m' ? Math.max(2, seasonAvg - 1) : seasonAvg;
      const allHit = values.every((v: number) => v >= threshold);
      if (!allHit) return null;

      const rollingAvg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
      const line = linesByPlayer.get(p.id)!;

      return {
        player_id: p.id as number,
        player_name: p.name as string,
        team: p.team as string,
        position: p.position as string,
        season_avg: seasonAvg,
        rolling_avg: rollingAvg,
        streak_count: window,
        todays_line: line.line,
        todays_implied_prob: line.implied_prob,
      };
    }));

    const filtered = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    if (filtered.length === 0) {
      return res.json({ success: true, data: { stat, window, rows: [] } });
    }

    // ── F. Enrich with opponent + league_rank (position-based)
    const { data: teamRows } = await supabaseAdmin.from('teams').select('id,abbreviation');
    const abbrToId = new Map<string, number>();
    const idToAbbr = new Map<number, string>();
    for (const t of (teamRows ?? [])) {
      abbrToId.set((t.abbreviation ?? '').toUpperCase(), t.id);
      idToAbbr.set(t.id, t.abbreviation);
    }

    const opponentByTeamId = new Map<number, number>();
    for (const g of (games ?? [])) {
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

    const enriched = filtered.map((r) => {
      const teamAbbr = (r.team ?? '').toUpperCase();
      const teamId = abbrToId.get(teamAbbr);
      const opponentId = teamId != null ? opponentByTeamId.get(teamId) : undefined;
      const opponentAbbr = opponentId != null ? (idToAbbr.get(opponentId) ?? null) : null;
      const pos = (r.position ?? '').toUpperCase();
      const positionGroup = pos.startsWith('G') ? 'G' : pos.startsWith('F') ? 'F' : 'C';
      const leagueRank =
        opponentId != null ? (latestOppDef.get(`${opponentId}-${positionGroup}`) ?? null) : null;
      return {
        ...r,
        opponent: opponentAbbr ? { team: opponentAbbr, league_rank: leagueRank } : null,
      };
    });

    // ── G. Sort by opponent league_rank DESC, then season_avg DESC, top 10
    enriched.sort((a, b) => {
      const ar = a.opponent?.league_rank ?? -1;
      const br = b.opponent?.league_rank ?? -1;
      if (br !== ar) return br - ar;
      return (b.season_avg ?? 0) - (a.season_avg ?? 0);
    });

    res.json({
      success: true,
      data: { stat, window, rows: enriched.slice(0, 10) },
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

async function getGamePerfectStreaks(req: any, res: any, stat: string, window: number) {
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
