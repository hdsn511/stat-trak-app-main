import { supabaseAdmin } from '../config/supabaseAdmin';

export interface Record { w: number; l: number }

/**
 * Cumulative W-L over graded pick_results rows. `shownOnly` limits to rows that were
 * on the Picks card when their game started (on_card, stamped by getProjects). A
 * pick swapped off the card before kickoff, or one only shown in a game view, never
 * counts.
 */
export async function gradedRecord(leagueId: number, pickTypes: string[], shownOnly = false): Promise<Record> {
  const count = async (hit: boolean) => {
    let q = supabaseAdmin
      .from('pick_results')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .in('pick_type', pickTypes)
      .eq('did_hit', hit);
    if (shownOnly) q = q.eq('on_card', true);
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };
  const [w, l] = await Promise.all([count(true), count(false)]);
  return { w, l };
}

/**
 * Net units over graded on-card picks: a flat 1-unit straight at the pick's implied
 * price (win pays (1-p)/p, loss costs 1). Rows without a price are left out.
 */
export async function gradedUnits(leagueId: number, pickTypes: string[]): Promise<number> {
  // shortcut: one 1000-row page (~5 on-card picks a day); paginate once history passes that.
  const { data, error } = await supabaseAdmin
    .from('pick_results')
    .select('did_hit,implied_prob')
    .eq('league_id', leagueId)
    .in('pick_type', pickTypes)
    .eq('on_card', true)
    .not('did_hit', 'is', null)
    .limit(1000);
  if (error) throw error;
  return Math.round(unitsOf((data ?? []) as any[]) * 100) / 100;
}

export function unitsOf(rows: { did_hit: boolean; implied_prob: number | null }[]): number {
  let u = 0;
  for (const r of rows) {
    const p = Number(r.implied_prob);
    if (!(p > 0 && p < 1)) continue;
    u += r.did_hit ? (1 - p) / p : -1;
  }
  return u;
}
