import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabaseAdmin', () => ({ supabaseAdmin: {} }));

import { straightUnits, tallyStraights } from '../src/utils/record';

describe('straightUnits', () => {
  it('pays (1-p)/p on a win and costs the unit on a loss', () => {
    expect(straightUnits(0.5, true)).toBeCloseTo(1);
    expect(straightUnits(0.75, true)).toBeCloseTo(1 / 3);
    expect(straightUnits(0.75, false)).toBe(-1);
  });

  it('pays nothing on a win with no usable price', () => {
    expect(straightUnits(NaN, true)).toBe(0);
    expect(straightUnits(1, true)).toBe(0);
  });
});

describe('tallyStraights', () => {
  it('counts W-L and nets units, skipping ungraded rows', () => {
    const r = tallyStraights([
      { implied_prob: 0.5, did_hit: true },
      { implied_prob: '0.8', did_hit: true },
      { implied_prob: 0.6, did_hit: false },
      { implied_prob: 0.6, did_hit: null },
    ]);
    expect(r).toEqual({ w: 2, l: 1, units: 0.25 });
  });
});
