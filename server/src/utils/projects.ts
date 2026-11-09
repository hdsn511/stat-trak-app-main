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

/**
 * The on_card flags to write after serving the card: every row of an unstarted game
 * whose flag differs from whether it is on the card now. Rows of started games are
 * left alone, so the flag freezes at kickoff to what the card showed then; the card's
 * record counts only those (see utils/record.ts).
 */
export function onCardChanges<T extends ProjectRow & { on_card?: boolean | null }>(
  rows: T[],
  shown: Set<number>,
  games: Map<number, GameState>,
  now: Date,
): { id: number; on_card: boolean }[] {
  const out: { id: number; on_card: boolean }[] = [];
  for (const r of rows) {
    if (r.game_id == null || !isUpcoming(games.get(r.game_id), now)) continue;
    const want = shown.has(r.id);
    if (!!r.on_card !== want) out.push({ id: r.id, on_card: want });
  }
  return out;
}

// ── Lock mode (leagues.projectsLock) ────────────────────────────────────────────
// The generator owns the card: it may swap featured picks until an hour before the
// date's first tip, then the card is final. The API serves it exactly as stored:
// a pick whose game has started stays on it, and nothing is pulled in to replace it.

/** A card is final this long before the date's first tip (generate_projects.LOCK_LEAD). */
export const LOCK_LEAD_MS = 60 * 60 * 1000;

export interface LockGame extends GameState {
  game_date: string;
}

export interface LockMods extends ProjectMods {
  replaced_at?: string;
  replaced_reason?: string;
  added_at?: string;
}

export interface CardChange<T> {
  at: string;
  kind: 'out' | 'in';
  row: T;
  /** Why it came off; null for a pick put on. */
  reason: string | null;
}

/** game_date -> epoch ms the date's card is final. */
export function cardLocks(games: LockGame[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of games) {
    if (!g.game_time) continue;
    const t = new Date(g.game_time).getTime() - LOCK_LEAD_MS;
    if (!out.has(g.game_date) || t < out.get(g.game_date)!) out.set(g.game_date, t);
  }
  return out;
}

const tipOf = (games: Map<number, LockGame>, r: ProjectRow) =>
  new Date(games.get(r.game_id!)?.game_time ?? 0).getTime();

export function selectLockedCard<T extends ProjectRow & { modifiers?: LockMods | null }>(
  rows: T[],
  games: Map<number, LockGame>,
  now: Date,
): {
  date: string | null;
  locksAt: number | null;
  locked: boolean;
  props: T[];
  moneyline: T | null;
  changes: CardChange<T>[];
  byGame: Map<number, { winner: T | null; props: T[] }>;
} {
  const known = rows.filter((r) => r.model_prob != null && r.game_id != null && games.has(r.game_id));
  const featured = known.filter((r) => r.modifiers?.featured);
  // The card is the soonest date that has one; its picks stay on it through tip-off.
  const date = featured.map((r) => r.game_date ?? '').filter(Boolean).sort()[0] ?? null;
  const locksAt = date ? (cardLocks([...games.values()]).get(date) ?? null) : null;
  const onCard = featured
    .filter((r) => r.game_date === date)
    .sort((a, b) => tipOf(games, a) - tipOf(games, b) || prob(b) - prob(a));
  const changes: CardChange<T>[] = [];
  for (const r of known) {
    if (r.game_date !== date) continue;
    const m = r.modifiers ?? {};
    if (m.replaced_at) changes.push({ at: m.replaced_at, kind: 'out', row: r, reason: m.replaced_reason ?? null });
    if (m.added_at && m.featured) changes.push({ at: m.added_at, kind: 'in', row: r, reason: null });
  }
  changes.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === 'out' ? -1 : 1));

  // Each game's own picks are final an hour before its tip, and stay visible after it.
  const byGame = new Map<number, { winner: T | null; props: T[] }>();
  for (const r of known) {
    if (r.modifiers?.void) continue;
    const g = byGame.get(r.game_id!) ?? { winner: null, props: [] };
    if (r.prop_type === 'winner') g.winner = r;
    else g.props.push(r);
    byGame.set(r.game_id!, g);
  }
  for (const g of byGame.values()) {
    g.props.sort((a, b) => (a.modifiers?.game_rank ?? 99) - (b.modifiers?.game_rank ?? 99) || prob(b) - prob(a));
  }
  return {
    date,
    locksAt,
    locked: locksAt != null && now.getTime() >= locksAt,
    props: onCard.filter((r) => r.prop_type === 'player').slice(0, PROP_SLOTS),
    moneyline: onCard.find((r) => r.prop_type === 'winner') ?? null,
    changes,
    byGame,
  };
}

/**
 * Where a pick's game stands, for the card. games.status is synced by the nightly
 * ingest, not live, so a game past its tip is only known to have started.
 */
export function gamePhase(g: GameState | undefined, now: Date): 'upcoming' | 'started' | 'final' {
  if (!g) return 'upcoming';
  if (g.status === 2) return 'final';
  return isUpcoming(g, now) ? 'upcoming' : 'started';
}
