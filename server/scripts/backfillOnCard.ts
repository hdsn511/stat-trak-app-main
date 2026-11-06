// One-off: set pick_results.on_card for Projects rows of games that already started,
// by replaying the Picks card (selectProjects) one minute before each kickoff.
// featured is reconstructed from replaced_at: a row unfeatured after that moment was
// featured then. Run: node --env-file=.env --require tsx/cjs scripts/backfillOnCard.ts [--write]
import { supabaseAdmin } from '../src/config/supabaseAdmin';
import { selectProjects, type GameState } from '../src/utils/projects';

const TRACK_START = '2026-11-03';

async function league(lid: number, write: boolean) {
  const { data: rows, error } = await supabaseAdmin
    .from('pick_results')
    .select('id,prop_type,entity_id,model_prob,game_id,game_date,modifiers,created_at,did_hit,on_card')
    .eq('league_id', lid).eq('pick_type', 'project').gte('game_date', TRACK_START);
  if (error) throw error;
  const { data: games } = await supabaseAdmin
    .from('games').select('id,game_time').eq('league_id', lid).gte('game_date', TRACK_START);
  const kickoff = new Map((games ?? []).map((g: any) => [g.id, g.game_time ? new Date(g.game_time) : null]));
  const now = new Date();
  const started = [...new Set((rows ?? []).map((r: any) => r.game_id))]
    .filter((id) => { const k = kickoff.get(id); return k && k < now; });

  const onCard = new Set<number>();
  for (const gid of started) {
    const at = new Date(kickoff.get(gid)!.getTime() - 60_000);
    const state = new Map<number, GameState>();
    for (const [id, k] of kickoff) state.set(id, { status: k && k > at ? 0 : 2, game_time: k ? k.toISOString() : null });
    const live = (rows ?? []).filter((r: any) => new Date(r.created_at) <= at).map((r: any) => {
      const m = { ...(r.modifiers ?? {}) };
      if (!m.featured && m.replaced_at && new Date(m.replaced_at) > at) m.featured = true;
      return { ...r, modifiers: m };
    });
    const { props, moneyline } = selectProjects(live as any[], state, at);
    for (const r of [...props, ...(moneyline ? [moneyline] : [])]) if (r.game_id === gid) onCard.add(r.id);
  }
  const startedSet = new Set(started);
  const target = (rows ?? []).filter((r: any) => startedSet.has(r.game_id));
  let w = 0, l = 0;
  for (const r of target as any[]) if (onCard.has(r.id) && r.did_hit != null) r.did_hit ? w++ : l++;
  console.log(`league ${lid}: ${started.length} started games, ${onCard.size} rows on card at kickoff, graded record ${w}-${l}`);
  if (!write) return;
  const yes = target.filter((r: any) => onCard.has(r.id)).map((r: any) => r.id);
  const no = target.filter((r: any) => !onCard.has(r.id)).map((r: any) => r.id);
  for (const [ids, v] of [[yes, true], [no, false]] as const) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error: e } = await supabaseAdmin.from('pick_results').update({ on_card: v }).in('id', ids.slice(i, i + 200));
      if (e) throw e;
    }
  }
}

(async () => {
  const write = process.argv.includes('--write');
  for (const lid of [1, 3]) await league(lid, write);
})();
