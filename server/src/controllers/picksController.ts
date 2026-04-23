import { supabaseAdmin } from '../config/supabaseAdmin';

const PICK_STAT_LABELS: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM',
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
    const allPicks = (picks ?? []) as any[];

    const playerRows = allPicks.filter((p) => p.prop_type === 'player');
    const gameRows = allPicks.filter((p) =>
      ['winner', 'spread', 'total'].includes(p.prop_type)
    );

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

    // ── Game side: one of each ML/Spread/Total, then fill by confidence
    const pickByPropType = (t: string) => gameRows.find((r: any) => r.prop_type === t);
    const featuredPicks: Array<{ row: any; featured: 'ml' | 'spread' | 'total' }> = [];
    const ml = pickByPropType('winner');
    if (ml) featuredPicks.push({ row: ml, featured: 'ml' });
    const sp = pickByPropType('spread');
    if (sp) featuredPicks.push({ row: sp, featured: 'spread' });
    const to = pickByPropType('total');
    if (to) featuredPicks.push({ row: to, featured: 'total' });

    const featuredIds = new Set(featuredPicks.map((f) => f.row.id));
    const fillers = gameRows
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
      return {
        player_id: p.entity_id,
        player_name: pl.name,
        team: pl.team,
        position: pl.position,
        stat: p.stat,
        stat_label: PICK_STAT_LABELS[p.stat] ?? String(p.stat).toUpperCase(),
        pick_type: p.pick_type,
        line: p.recommended_line,
        hit_rate: p.hit_rate,
        confidence: p.confidence_score,
        edge: p.edge,
        sample_size: p.sample_size,
        implied_prob: p.implied_prob,
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

// Stubbed for Task 6.
export async function getPerfectStreaks(_req: any, res: any) {
  res.status(501).json({ success: false, error: 'not implemented yet' });
}
