import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league as resolveLeague } from '../config/leagues';
import { sportsDay } from '../utils/dateQueries';

// Yesterday's results for the Trending Players and Streak Watch suggestions.
// The rows are the morning snapshot of what each card suggested
// (analytics/batch/snapshot_suggestions.py, pick_type sugg_trending / sugg_streak), graded overnight
// by reconcile_projects, so the W-L is exactly what was shown: today's lists can't be
// used, because a player whose streak broke yesterday is no longer on them.

export interface SuggestionResult {
  player_id: number;
  name: string;
  team: string | null;
  ext_id: string | null;
  stat: string;
  stat_label: string;
  rung: number;
  actual: number;
  did_hit: boolean;
}

export async function getSuggestionResults(_req: Request, res: Response) {
  try {
    const lg = resolveLeague(res);
    const today = sportsDay();
    // The most recent slate with graded suggestions, before today.
    const { data: last, error: lErr } = await supabaseAdmin
      .from('pick_results')
      .select('game_date')
      .eq('league_id', lg.leagueId)
      .in('pick_type', ['sugg_trending', 'sugg_streak'])
      .lt('game_date', today)
      .not('did_hit', 'is', null)
      .order('game_date', { ascending: false })
      .limit(1);
    if (lErr) throw lErr;
    const date = last?.[0]?.game_date ?? null;
    const empty = { record: { w: 0, l: 0 }, rows: [] as SuggestionResult[] };
    if (!date) return res.json({ success: true, data: { date: null, trending: empty, streak: { ...empty } } });

    const { data: rows, error } = await supabaseAdmin
      .from('pick_results')
      .select('entity_id,stat,pick_type,recommended_line,actual_result,did_hit,modifiers')
      .eq('league_id', lg.leagueId)
      .in('pick_type', ['sugg_trending', 'sugg_streak'])
      .eq('game_date', date)
      .not('did_hit', 'is', null)
      .order('id');
    if (error) throw error;
    const ids = [...new Set((rows ?? []).map((r: any) => r.entity_id))];
    const { data: players } = ids.length
      ? await supabaseAdmin.from('players').select('id,name,team,ext_id').in('id', ids)
      : { data: [] as any[] };
    const byId = new Map((players ?? []).map((p: any) => [p.id, p]));

    const out: Record<'trending' | 'streak', { record: { w: number; l: number }; rows: SuggestionResult[] }> = {
      trending: { record: { w: 0, l: 0 }, rows: [] },
      streak: { record: { w: 0, l: 0 }, rows: [] },
    };
    for (const r of (rows ?? []) as any[]) {
      const src = r.pick_type === 'sugg_trending' ? 'trending' : r.pick_type === 'sugg_streak' ? 'streak' : undefined;
      if (!src) continue;
      const p: any = byId.get(r.entity_id);
      out[src].rows.push({
        player_id: r.entity_id,
        name: p?.name ?? 'Unknown',
        team: p?.team ?? null,
        ext_id: p?.ext_id ?? null,
        stat: r.stat,
        stat_label: lg.statLabels[r.stat] ?? r.stat.toUpperCase(),
        rung: Number(r.modifiers?.rung ?? Number(r.recommended_line) + 0.5),
        actual: Number(r.actual_result),
        did_hit: !!r.did_hit,
      });
      out[src].record[r.did_hit ? 'w' : 'l']++;
    }
    return res.json({ success: true, data: { date, ...out } });
  } catch (err: any) {
    console.error('[getSuggestionResults]', err);
    return res.status(500).json({ success: false, error: 'Failed to load results' });
  }
}
