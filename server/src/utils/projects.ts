// Selection rules for the Projects card, kept pure so the boundaries are testable.
// The generator (analytics/picks/generate_projects.py) marks modifiers.featured; this
// only serves those, and refills a slot when a featured pick is voided or its game starts.

export const PROP_BAND = { min: 0.5, max: 0.7 };
export const ML_BAND = { min: 0.6, max: 0.7 };
export const PROP_SLOTS = 3;

export interface ProjectMods {
  void?: string;
  featured?: boolean;
  belief?: boolean;
  game_rank?: number | null;
  elo_agrees?: boolean;
}

export interface ProjectRow {
  id: number;
  prop_type: string;
  entity_id: number;
  model_prob: number | string | null;
  game_id: number | null;
  game_date?: string | null;
  modifiers?: ProjectMods | null;
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

const prob = (r: ProjectRow) => Number(r.model_prob);
// Soonest slate first (NFL's window spans a week), then the surest pick.
const bySlateThenProb = (a: ProjectRow, b: ProjectRow) =>
  (a.game_date ?? '').localeCompare(b.game_date ?? '') || prob(b) - prob(a);
const byBeliefThenProb = (a: ProjectRow, b: ProjectRow) =>
  Number(!!b.modifiers?.belief) - Number(!!a.modifiers?.belief) || bySlateThenProb(a, b);

export function selectProjects<T extends ProjectRow>(
  rows: T[],
  games: Map<number, GameState>,
  now: Date,
): { props: T[]; moneyline: T | null; byGame: Map<number, { winner: T | null; props: T[] }> } {
  const live = rows.filter(
    (r) => r.model_prob != null && r.game_id != null && !r.modifiers?.void && isUpcoming(games.get(r.game_id), now),
  );
  const playerRows = live.filter((r) => r.prop_type === 'player');
  const winnerRows = live.filter((r) => r.prop_type === 'winner');

  // Featured first; refill from the rest, one per player, one per game while games last.
  const props: T[] = [];
  const players = new Set<number>();
  const usedGames = new Set<number>();
  const take = (pool: T[], onePerGame: boolean) => {
    for (const r of pool) {
      if (props.length === PROP_SLOTS) return;
      if (players.has(r.entity_id) || (onePerGame && usedGames.has(r.game_id!))) continue;
      players.add(r.entity_id);
      usedGames.add(r.game_id!);
      props.push(r);
    }
  };
  const featured = playerRows.filter((r) => r.modifiers?.featured).sort(bySlateThenProb);
  const rest = playerRows.filter((r) => !r.modifiers?.featured).sort(byBeliefThenProb);
  take(featured, false);
  take(rest, true);
  take(rest, false);

  const inBand = (r: T) => prob(r) >= ML_BAND.min && prob(r) <= ML_BAND.max;
  const moneyline =
    winnerRows.filter((r) => r.modifiers?.featured).sort(bySlateThenProb)[0] ??
    winnerRows.filter((r) => inBand(r) && r.modifiers?.elo_agrees).sort(bySlateThenProb)[0] ??
    winnerRows.filter(inBand).sort(bySlateThenProb)[0] ??
    null;

  const byGame = new Map<number, { winner: T | null; props: T[] }>();
  for (const r of live) {
    const g = byGame.get(r.game_id!) ?? { winner: null, props: [] };
    if (r.prop_type === 'winner') g.winner = r;
    else g.props.push(r);
    byGame.set(r.game_id!, g);
  }
  for (const g of byGame.values()) {
    g.props.sort((a, b) => (a.modifiers?.game_rank ?? 99) - (b.modifiers?.game_rank ?? 99) || prob(b) - prob(a));
  }
  return { props, moneyline, byGame };
}
