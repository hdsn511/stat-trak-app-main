import { supabaseAdmin } from '../config/supabaseAdmin';
import type { LeagueConfig } from '../config/leagues';

/**
 * The sportsbook spread and total for one game. Upcoming games read ESPN's
 * free core odds API live (same source as analytics/batch/odds_ingest.py);
 * finished games read the stored close from `game_odds`.
 */
export interface GameLines {
  provider: string | null;
  /** Home team's spread: negative = home favoured. */
  spread_home: number | null;
  total: number | null;
}

const CORE = 'https://sports.core.api.espn.com/v2/sports';
const PREFERRED = ['DraftKings', 'ESPN BET', 'Caesars Sportsbook'];
// ESPN sport path and the games column holding the ESPN event id. MLB's ids are MLB Stats API ids, so no lookup.
const ESPN: Record<string, { sport: string; col: 'espn_id' | 'ext_id' }> = {
  nba: { sport: 'basketball', col: 'espn_id' },
  nfl: { sport: 'football', col: 'ext_id' },
  nhl: { sport: 'hockey', col: 'ext_id' },
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** One book's line from an ESPN odds item, mirroring odds_ingest._home_spread. */
function lineOf(item: any): { name: string; spread: number; total: number | null } | null {
  const name: string = item?.provider?.name ?? '';
  if (name.toLowerCase().includes('live')) return null;
  const h = item?.homeTeamOdds ?? {};
  const pick = (block: any) => num(block?.pointSpread?.american);
  let spread = pick(h.close) ?? pick(h.current);
  if (spread == null && item?.spread != null) {
    const mag = Math.abs(num(item.spread) ?? NaN);
    if (Number.isFinite(mag)) spread = h.favorite ? -mag : mag;
  }
  if (spread == null) return null;
  return { name, spread, total: num(item?.overUnder) };
}

/** Best book's line from ESPN's odds `items`, preferring DraftKings, then ESPN BET, then Caesars. */
export function parseEspnLines(items: any[]): GameLines | null {
  const books = (items ?? []).map(lineOf).filter((b): b is NonNullable<typeof b> => b != null);
  if (books.length === 0) return null;
  const rank = (n: string) => {
    const i = PREFERRED.findIndex((p) => n.startsWith(p));
    return i === -1 ? 99 : i;
  };
  books.sort((a, b) => rank(a.name) - rank(b.name));
  const b = books[0]!;
  return { provider: b.name || null, spread_home: b.spread, total: b.total };
}

// Lines move slowly pre-game; ten minutes keeps ESPN calls to a trickle.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; lines: GameLines | null }>();

export async function fetchGameLines(
  lg: LeagueConfig,
  game: { id: number; espn_id?: string | number | null; ext_id?: string | number | null },
  isCompleted: boolean,
): Promise<GameLines | null> {
  try {
    if (isCompleted) {
      const { data } = await supabaseAdmin
        .from('game_odds')
        .select('provider, spread_home, total')
        .eq('game_id', game.id)
        .maybeSingle();
      return data ? { provider: data.provider ?? null, spread_home: num(data.spread_home), total: num(data.total) } : null;
    }
    const cfg = ESPN[lg.slug];
    const eventId = cfg ? game[cfg.col] : null;
    if (!cfg || !eventId) return null;
    const key = `${lg.slug}:${eventId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.lines;
    const r = await fetch(
      `${CORE}/${cfg.sport}/leagues/${lg.slug}/events/${eventId}/competitions/${eventId}/odds`,
      { signal: AbortSignal.timeout(4000) },
    );
    const lines = r.ok ? parseEspnLines(((await r.json()) as any)?.items ?? []) : null;
    cache.set(key, { at: Date.now(), lines });
    return lines;
  } catch {
    // Lines are garnish on the game page: a slow or failed ESPN call never blocks it.
    return null;
  }
}
