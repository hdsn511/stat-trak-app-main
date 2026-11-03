// Selection rules for the Projects card, kept pure so the boundaries are testable.
// Caps apply to model_prob: the calibrated probability that edge is computed from.

export const PROP_MAX_PROB = 0.6; // inclusive
export const ML_MAX_PROB = 0.7; // strict
export const PROP_SLOTS = 3;

export interface ProjectRow {
  id: number;
  prop_type: string;
  entity_id: number;
  model_prob: number | string | null;
  edge: number | string | null;
  game_id: number | null;
  modifiers?: { void?: string } | null;
}

export interface GameState {
  status: number | null;
  game_time: string | null;
}

/** Only a scheduled game with a known future start can be presented as upcoming. */
export function isUpcoming(g: GameState | undefined, now: Date): boolean {
  if (!g || g.status !== 0 || !g.game_time) return false;
  return new Date(g.game_time).getTime() > now.getTime();
}

export function selectProjects<T extends ProjectRow>(
  rows: T[],
  games: Map<number, GameState>,
  now: Date,
): { props: T[]; moneyline: T | null } {
  const live = rows.filter(
    (r) =>
      r.model_prob != null &&
      Number(r.edge) > 0 &&
      r.game_id != null &&
      !r.modifiers?.void &&
      isUpcoming(games.get(r.game_id), now),
  );
  const byEdge = (a: T, b: T) => Number(b.edge) - Number(a.edge);

  // One pick per player: two lines on one player are the same bet twice.
  const players = new Set<number>();
  const props: T[] = [];
  for (const r of live
    .filter((x) => x.prop_type === 'player' && Number(x.model_prob) <= PROP_MAX_PROB)
    .sort(byEdge)) {
    if (players.has(r.entity_id)) continue;
    players.add(r.entity_id);
    props.push(r);
    if (props.length === PROP_SLOTS) break;
  }
  const moneyline =
    live
      .filter((x) => x.prop_type === 'winner' && Number(x.model_prob) < ML_MAX_PROB)
      .sort(byEdge)[0] ?? null;
  return { props, moneyline };
}
