import { supabaseAdmin } from '../config/supabaseAdmin';

export interface Record { w: number; l: number }
export interface UnitsRecord extends Record { units: number }

/**
 * Profit in units on a 1-unit straight bought at `price` (the YES price paid, as a
 * probability): a win returns (1 - p) / p, a loss costs the unit.
 */
export function straightUnits(price: number, hit: boolean): number {
  if (!hit) return -1;
  if (!(price > 0 && price < 1)) return 0;
  return (1 - price) / price;
}

/** W-L and net units over graded straights; ungraded rows (did_hit null) are skipped. */
export function tallyStraights(rows: { implied_prob: number | string | null; did_hit: boolean | null }[]): UnitsRecord {
  let w = 0;
  let l = 0;
  let units = 0;
  for (const r of rows) {
    if (r.did_hit == null) continue;
    if (r.did_hit) w++;
    else l++;
    units += straightUnits(Number(r.implied_prob), r.did_hit);
  }
  return { w, l, units: Math.round(units * 100) / 100 };
}

/**
 * Every graded straight that was on the Picks card when its game started (on_card).
 * A pick swapped off the card before kickoff, or one only shown in a game view,
 * never counts. Paged with a total order: .range() without one silently drops rows.
 */
export async function gradedStraights(leagueId: number): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('pick_results')
      .select('id,game_id,game_date,prop_type,entity_id,stat,recommended_line,implied_prob,did_hit,actual_result,modifiers')
      .eq('league_id', leagueId)
      .eq('pick_type', 'project')
      .eq('on_card', true)
      .not('did_hit', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
