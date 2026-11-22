import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league as resolveLeague } from '../config/leagues';
import { ML_BAND, PROP_BAND, onCardChanges, selectProjects, type GameState } from '../utils/projects';
import { gradedRecord, gradedUnits, unitsOf } from '../utils/record';

/** Calendar date in US Eastern: game_date is local, so UTC would roll over early. */
function easternDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function getProjects(_req: Request, res: Response) {
  try {
    const lg = resolveLeague(res);
    const bands = { prop: PROP_BAND, moneyline: ML_BAND };
    if (lg.projectsWindowDays == null) {
      return res.json({
        success: true,
        data: { supported: false, bands, props: [], moneyline: null, games: [], upcoming_games: 0 },
      });
    }

    const now = new Date();
    const from = easternDate(now);
    const to = easternDate(new Date(now.getTime() + lg.projectsWindowDays * 86400000));

    const [{ data: gameRows, error: gErr }, { data: pickRows, error: pErr }] = await Promise.all([
      supabaseAdmin
        .from('games')
        .select('id,status,game_time,home_team_id,away_team_id,game_date')
        .eq('league_id', lg.leagueId)
        .gte('game_date', from)
        .lte('game_date', to),
      supabaseAdmin
        .from('pick_results')
        .select(
          'id,prop_type,entity_id,stat,recommended_line,model_prob,implied_prob,edge,' +
            'game_id,game_date,modifiers,price_source,on_card,on_card_changed_at',
        )
        .eq('league_id', lg.leagueId)
        .eq('pick_type', 'project')
        .is('actual_result', null)
        .gte('game_date', from)
        .lte('game_date', to),
    ]);
    if (gErr) throw gErr;
    if (pErr) throw pErr;

    const games = (gameRows ?? []) as any[];
    const gameMap = new Map<number, GameState>(games.map((g) => [g.id, g]));
    const { props, moneyline, byGame } = selectProjects((pickRows ?? []) as any[], gameMap, now);

    // Stamp what the card shows now; frozen at each game's kickoff, it is what gets graded.
    const shownIds = new Set([...props, ...(moneyline ? [moneyline] : [])].map((r: any) => r.id));
    const changes = onCardChanges((pickRows ?? []) as any[], shownIds, gameMap, now);
    // A swap is a flag flipping on a row that already had one; first appearances are not changes.
    const priorOf = new Map((pickRows ?? []).map((r: any) => [r.id, r.on_card]));
    const stampedAt = now.toISOString();
    await Promise.all(
      [true, false].flatMap((v) => {
        const ids = changes.filter((c) => c.on_card === v).map((c) => c.id);
        const swapped = ids.filter((id) => priorOf.get(id) != null);
        const fresh = ids.filter((id) => priorOf.get(id) == null);
        return [
          fresh.length ? supabaseAdmin.from('pick_results').update({ on_card: v }).in('id', fresh) : null,
          swapped.length
            ? supabaseAdmin.from('pick_results').update({ on_card: v, on_card_changed_at: stampedAt }).in('id', swapped)
            : null,
        ];
      }),
    ).catch((e) => console.error('[getProjects] on_card stamp failed', e));
    for (const c of changes) {
      const row: any = (pickRows ?? []).find((r: any) => r.id === c.id);
      if (row && row.on_card != null) row.on_card_changed_at = stampedAt;
      if (row) row.on_card = c.on_card;
    }
    const changedToday = (pickRows ?? []).filter(
      (r: any) => r.on_card_changed_at && easternDate(new Date(r.on_card_changed_at)) === from,
    ) as any[];

    // The latest graded slate before today: the card's "Yesterday's picks" dropdown.
    // Two small queries (latest date, then its rows) instead of paging all history.
    const { data: lastRow } = await supabaseAdmin
      .from('pick_results')
      .select('game_date')
      .eq('league_id', lg.leagueId)
      .eq('pick_type', 'project')
      .eq('on_card', true)
      .not('did_hit', 'is', null)
      .lt('game_date', from)
      .order('game_date', { ascending: false })
      .limit(1);
    const ydayDate: string | null = lastRow?.[0]?.game_date ?? null;
    const { data: ydayData } = ydayDate
      ? await supabaseAdmin
          .from('pick_results')
          .select('id,game_id,game_date,prop_type,entity_id,stat,recommended_line,implied_prob,did_hit,actual_result,modifiers')
          .eq('league_id', lg.leagueId)
          .eq('pick_type', 'project')
          .eq('on_card', true)
          .eq('game_date', ydayDate)
          .not('did_hit', 'is', null)
          .order('id')
      : { data: [] as any[] };
    const ydayRows = (ydayData ?? []) as any[];

    const { data: teams } = await supabaseAdmin
      .from('teams')
      .select('id,abbreviation,name')
      .eq('league_id', lg.leagueId);
    const teamById = new Map((teams ?? []).map((t: any) => [t.id, t]));
    const gameById = new Map(games.map((g) => [g.id, g]));

    const playerIds = [
      ...[...byGame.values()].flatMap((g) => g.props.map((p: any) => p.entity_id)),
      ...changedToday.filter((r) => r.prop_type !== 'winner').map((r) => r.entity_id),
      ...ydayRows.filter((r) => r.prop_type === 'player').map((r) => r.entity_id),
    ];
    const { data: players } = playerIds.length
      ? await supabaseAdmin.from('players').select('id,name,team,ext_id').in('id', playerIds)
      : { data: [] as any[] };
    const playerById = new Map((players ?? []).map((p: any) => [p.id, p]));

    const shape = (p: any, kind: 'prop' | 'moneyline') => {
      const g: any = gameById.get(p.game_id);
      const home: any = teamById.get(g.home_team_id);
      const away: any = teamById.get(g.away_team_id);
      const mods = p.modifiers ?? {};
      const pickedTeam = kind === 'moneyline' ? (teamById.get(mods.team_id) as any) : null;
      const player: any = playerById.get(p.entity_id);
      return {
        id: p.id,
        kind,
        entity_id: kind === 'prop' ? p.entity_id : p.game_id,
        name: kind === 'prop' ? (player?.name ?? 'Unknown') : (pickedTeam?.name ?? mods.team_abbr),
        team: mods.team_abbr ?? null,
        // Headshot id (players.ext_id), props only.
        ext_id: kind === 'prop' ? (player?.ext_id ?? null) : null,
        stat: kind === 'prop' ? p.stat : null,
        stat_label: kind === 'prop' ? (lg.statLabels[p.stat] ?? p.stat) : null,
        side: mods.side,
        line: p.recommended_line == null ? null : Number(p.recommended_line),
        model_prob: Number(p.model_prob),
        implied_prob: Number(p.implied_prob),
        edge: Number(p.edge),
        price_source: p.price_source,
        book_prob: mods.book_prob ?? null,
        featured: !!mods.featured,
        // Why we like it: recent form for props, the Elo check for winners.
        context:
          kind === 'prop'
            ? {
                avg20: mods.avg20 ?? null,
                avg5: mods.avg5 ?? null,
                last: mods.last ?? null,
                hit10: mods.hit10 ?? null,
                form_supports: !!mods.belief,
                b2b: !!mods.b2b,
              }
            : { elo_prob: mods.elo_prob ?? null, elo_agrees: mods.elo_agrees ?? null },
        game: {
          id: p.game_id,
          date: g.game_date,
          time: g.game_time,
          matchup: `${away?.abbreviation ?? '?'} @ ${home?.abbreviation ?? '?'}`,
          away: away?.abbreviation ?? null,
          home: home?.abbreviation ?? null,
        },
      };
    };

    /** A graded straight from the last slate: what was picked, the result, and what it paid. */
    const ydayShape = (r: any) => {
      const mods = r.modifiers ?? {};
      const isProp = r.prop_type === 'player';
      const player: any = isProp ? playerById.get(r.entity_id) : null;
      const team: any = isProp ? null : teamById.get(mods.team_id);
      const price = Number(r.implied_prob);
      return {
        id: r.id,
        kind: isProp ? 'prop' : 'moneyline',
        entity_id: isProp ? r.entity_id : r.game_id,
        name: isProp ? (player?.name ?? 'Unknown') : (team?.name ?? mods.team_abbr ?? 'Unknown'),
        team: mods.team_abbr ?? null,
        ext_id: isProp ? (player?.ext_id ?? null) : null,
        stat_label: isProp ? (lg.statLabels[r.stat] ?? r.stat) : null,
        side: mods.side ?? null,
        line: r.recommended_line == null ? null : Number(r.recommended_line),
        price: Number.isFinite(price) ? price : null,
        actual: r.actual_result == null ? null : Number(r.actual_result),
        did_hit: !!r.did_hit,
        units: Math.round(unitsOf([{ did_hit: !!r.did_hit, implied_prob: price }]) * 100) / 100,
      };
    };
    const yesterday = ydayDate
      ? {
          date: ydayDate,
          record: {
            w: ydayRows.filter((r) => r.did_hit).length,
            l: ydayRows.filter((r) => !r.did_hit).length,
            units: Math.round(unitsOf(ydayRows) * 100) / 100,
          },
          rows: ydayRows.map(ydayShape),
        }
      : null;

    return res.json({
      success: true,
      data: {
        supported: true,
        yesterday,
        bands,
        // Graded picks that were on the card when their game started (on_card).
        record: {
          ...(await gradedRecord(lg.leagueId, ['project'], true)),
          units: await gradedUnits(lg.leagueId, ['project']),
        },
        props: props.map((p) => shape(p, 'prop')),
        moneyline: moneyline ? shape(moneyline, 'moneyline') : null,
        // Every upcoming game's predicted winner and top props, for the game view.
        games: [...byGame.entries()].map(([gameId, g]) => ({
          game_id: gameId,
          winner: g.winner ? shape(g.winner, 'moneyline') : null,
          props: g.props.map((p) => shape(p, 'prop')),
        })),
        // Picks that swapped on/off the card today (Eastern), for the "Changes today" dropdown.
        changes: changedToday
          .filter((r) => gameById.has(r.game_id))
          .map((r) => ({
            ...shape(r, r.prop_type === 'winner' ? 'moneyline' : 'prop'),
            change: r.on_card ? 'added' : 'removed',
            at: r.on_card_changed_at,
          })),
        upcoming_games: games.filter((g) => gameMap.has(g.id) && g.status === 0 && g.game_time && new Date(g.game_time) > now).length,
      },
    });
  } catch (err: any) {
    console.error('[getProjects]', err);
    return res.status(500).json({ success: false, error: err?.message ?? 'Failed to load projects' });
  }
}
