import { describe, expect, it } from 'vitest';
import { unitsOf } from '../src/utils/record';

describe('unitsOf', () => {
  it('pays (1-p)/p on a win, costs 1 on a loss, skips unpriced rows', () => {
    const u = unitsOf([
      { did_hit: true, implied_prob: 0.5 },   // +1
      { did_hit: true, implied_prob: 0.8 },   // +0.25
      { did_hit: false, implied_prob: 0.7 },  // -1
      { did_hit: false, implied_prob: null }, // skipped
    ]);
    expect(u).toBeCloseTo(0.25);
  });
});
