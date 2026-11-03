import { describe, expect, it } from 'vitest';
import { bestStreak, selectWatch, type Candidate } from '../src/services/nbaWatch';

const rungs = (...r: number[]) => r.map((rung) => ({ rung, price: rung / 100 }));

describe('bestStreak', () => {
  it('keeps the highest rung with a real run, not the trivial one', () => {
    // 26+ in every one of the last 8: the 25 rung, not 10.
    const c = bestStreak('pts', [31, 26, 28, 27, 30, 29, 26, 33], rungs(10, 15, 20, 25, 30), true)!;
    expect(c.rung).toBe(25);
    expect(c.depth).toBe(8);
    expect(c.margin).toBe(1);
    expect(c.price).toBe(0.25);
  });
  it('needs a run of at least five games', () => {
    expect(bestStreak('reb', [9, 8, 2, 9, 9, 9], rungs(4, 6, 8), true)).toBeNull();
  });
  it('orders the sparkline oldest first', () => {
    expect(bestStreak('ast', [6, 5, 4, 7, 8], rungs(4), false)!.last10).toEqual([8, 7, 4, 5, 6]);
  });
});

const cand = (o: Partial<Candidate>): Candidate => ({
  player_id: 1, stat: 'pts', rung: 20, depth: 6, margin: 1, l10_avg: 22, last10: [], price: null, listed: true, ...o,
});

describe('selectWatch', () => {
  it('ranks deeper runs first, then tighter ones', () => {
    const out = selectWatch([cand({ player_id: 1, depth: 6 }), cand({ player_id: 2, depth: 9, stat: 'reb' }),
      cand({ player_id: 3, depth: 6, margin: 0, stat: 'ast' })]);
    expect(out.map((c) => c.player_id)).toEqual([2, 3, 1]);
  });
  it('caps each stat so the list mixes stats', () => {
    const many = Array.from({ length: 6 }, (_, i) => cand({ player_id: i + 1, depth: 15 - i }));
    const out = selectWatch([...many, cand({ player_id: 99, stat: 'fg3m', depth: 5 })], 10, 3);
    expect(out.filter((c) => c.stat === 'pts')).toHaveLength(3);
    expect(out.some((c) => c.stat === 'fg3m')).toBe(true);
  });
  it('prefers lines Kalshi actually lists', () => {
    const out = selectWatch([cand({ player_id: 1, depth: 12, listed: false }), cand({ player_id: 2, depth: 6, stat: 'reb' })]);
    expect(out[0]!.player_id).toBe(2);
  });
});
