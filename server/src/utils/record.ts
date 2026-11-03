import { supabaseAdmin } from '../config/supabaseAdmin';

export interface Record { w: number; l: number }

/**
 * Cumulative W-L over graded pick_results rows. `shownOnly` limits to what was put
 * in front of people (Picks: featured, or featured and later replaced), so the
 * record never counts rows that only existed for a game view.
 */
export async function gradedRecord(leagueId: number, pickTypes: string[], shownOnly = false): Promise<Record> {
  const count = async (hit: boolean) => {
    let q = supabaseAdmin
      .from('pick_results')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .in('pick_type', pickTypes)
      .eq('did_hit', hit);
    if (shownOnly) q = q.or('modifiers->>featured.eq.true,modifiers->>replaced_at.not.is.null');
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };
  const [w, l] = await Promise.all([count(true), count(false)]);
  return { w, l };
}
