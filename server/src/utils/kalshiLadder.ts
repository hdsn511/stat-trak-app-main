// Kalshi lists NBA (and NFL, below) player props as "X+" rungs on a fixed ladder (checked against
// daily_lines, Oct-Nov 2026): points step by 5 from 10, rebounds and assists by 2,
// threes/steals/blocks by 1. A suggestion is only useful at a rung that exists,
// so averages and streak floors snap onto this ladder. Leagues without a ladder
// get no suggestion rather than an invented line.

const NBA: Record<string, number[]> = {
  pts: [10, 15, 20, 25, 30, 35, 40],
  reb: [2, 4, 6, 8, 10, 12, 14, 16],
  ast: [2, 4, 6, 8, 10, 12, 14],
  fg3m: [1, 2, 3, 4, 5],
  stl: [1, 2, 3],
  blk: [1, 2, 3],
};
// NFL rungs as KXNFLPASS / KXNFLREC / KXNFLRSH list them (daily_lines, Nov 2026):
// yardage steps by 5 up to 60, then 10s (with a 75); receptions and TDs by 1.
const yards = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150];
const NFL: Record<string, number[]> = {
  payds: [100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400],
  patd: [1, 2, 3, 4],
  ruyds: yards,
  recyds: yards.filter((y) => y >= 10),
  rec: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};
const LADDERS: Record<string, Record<string, number[]>> = { nba: NBA, nfl: NFL };

// Trends name stats in full; streaks and pick_results use the short keys.
const TREND_KEY: Record<string, string> = {
  points: 'pts', rebounds: 'reb', assists: 'ast', threes: 'fg3m',
  passing_yards: 'payds', passing_tds: 'patd', rushing_yards: 'ruyds',
  receiving_yards: 'recyds', receptions: 'rec',
};

/** Whether Kalshi lists player props for this league at all. */
export function hasLadder(league: string): boolean {
  return league in LADDERS;
}

export interface Suggestion {
  /** The Kalshi rung, e.g. 10 for "10+". */
  rung: number;
  /** The equivalent over line, rung - 0.5. */
  line: number;
  side: 'over';
}

export function ladder(league: string, stat: string): number[] | null {
  return LADDERS[league]?.[TREND_KEY[stat] ?? stat] ?? null;
}

export function statKey(stat: string): string {
  return TREND_KEY[stat] ?? stat;
}

const at = (rung: number): Suggestion => ({ rung, line: rung - 0.5, side: 'over' });

/** Closest rung to an average (8.7 pts -> 10, 26 -> 25, 2.3 ast -> 2). Ties go to the
 *  lower rung, the likelier over. Values below the ladder take its first rung. */
export function nearestRung(league: string, stat: string, avg: number): Suggestion | null {
  const l = ladder(league, stat);
  if (!l || !Number.isFinite(avg)) return null;
  let best = l[0]!;
  for (const r of l) if (Math.abs(r - avg) < Math.abs(best - avg)) best = r;
  return at(best);
}

/** Highest rung a streak floor still clears (min of 17 pts -> 15). None below the ladder:
 *  a market the streak doesn't cover is not a streak pick. */
export function rungAtOrBelow(league: string, stat: string, floor: number): Suggestion | null {
  const l = ladder(league, stat);
  if (!l || !Number.isFinite(floor)) return null;
  const fit = l.filter((r) => r <= floor);
  return fit.length ? at(fit[fit.length - 1]!) : null;
}
