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
