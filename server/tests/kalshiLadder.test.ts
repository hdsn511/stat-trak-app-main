import { describe, expect, it } from 'vitest';
import { nearestRung, rungAtOrBelow } from '../src/utils/kalshiLadder';

const rung = (s: { rung: number } | null) => s?.rung ?? null;

describe('nearestRung', () => {
  it('snaps averages to the rung Kalshi actually lists', () => {
    expect(rung(nearestRung('nba', 'points', 8.7))).toBe(10);
    expect(rung(nearestRung('nba', 'points', 26))).toBe(25);
    expect(rung(nearestRung('nba', 'points', 16))).toBe(15);
    expect(rung(nearestRung('nba', 'assists', 2.3))).toBe(2);
    expect(rung(nearestRung('nba', 'ast', 3.7))).toBe(4);
    expect(rung(nearestRung('nba', 'threes', 2.6))).toBe(3);
  });
  it('breaks ties toward the lower rung, the likelier over', () => {
    expect(rung(nearestRung('nba', 'ast', 3))).toBe(2);
    expect(rung(nearestRung('nba', 'pts', 17.5))).toBe(15);
  });
  it('returns the over line half a point under the rung', () => {
    expect(nearestRung('nba', 'pts', 21)).toEqual({ rung: 20, line: 19.5, side: 'over' });
  });
  it('gives no suggestion for a league or stat without a ladder', () => {
    expect(nearestRung('mlb', 'hits', 1.2)).toBeNull();
    expect(nearestRung('nba', 'minutes', 30)).toBeNull();
  });
});

describe('rungAtOrBelow', () => {
  it('takes the highest rung the floor still clears', () => {
    expect(rung(rungAtOrBelow('nba', 'pts', 17))).toBe(15);
    expect(rung(rungAtOrBelow('nba', 'pts', 15))).toBe(15);
    expect(rung(rungAtOrBelow('nba', 'reb', 5))).toBe(4);
  });
  it('returns none when the floor sits below the ladder', () => {
    expect(rungAtOrBelow('nba', 'pts', 8)).toBeNull();
  });
});

describe('NFL ladder', () => {
  it('snaps NFL trend averages onto Kalshi rungs', () => {
    expect(nearestRung('nfl', 'receiving_yards', 39)?.rung).toBe(40);
    expect(nearestRung('nfl', 'receptions', 4.4)?.rung).toBe(4);
    expect(nearestRung('nfl', 'passing_yards', 239)?.rung).toBe(250);
    expect(nearestRung('nfl', 'tackles', 6)).toBeNull();
  });
});
