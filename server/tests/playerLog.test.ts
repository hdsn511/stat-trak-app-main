import { describe, it, expect } from 'vitest';
import { resolveLogLimit, buildUpcoming } from '../src/controllers/nbaController';

describe('resolveLogLimit', () => {
  it('defaults to 20 when no window is given', () => {
    expect(resolveLogLimit(undefined)).toBe(20);
  });

  it('returns null (no limit) for window=all', () => {
    expect(resolveLogLimit('all')).toBeNull();
  });

  it('accepts a numeric window', () => {
    expect(resolveLogLimit('50')).toBe(50);
  });

  it('falls back to 20 for garbage input', () => {
    expect(resolveLogLimit('abc')).toBe(20);
    expect(resolveLogLimit('-5')).toBe(20);
    expect(resolveLogLimit('0')).toBe(20);
  });

  it('caps absurd windows at 500', () => {
    expect(resolveLogLimit('99999')).toBe(500);
  });
});

describe('buildUpcoming', () => {
  const abbrById: Record<number, string> = { 5: 'BOS', 9: 'LAL' };

  it('returns null when there is no scheduled game', () => {
    expect(buildUpcoming(null, 9, abbrById, '2026-07-20')).toBeNull();
  });

  it('resolves the opponent as the team that is not the players team', () => {
    const g = { id: 77, game_date: '2026-08-02', home_team_id: 9, away_team_id: 5 };
    expect(buildUpcoming(g, 9, abbrById, '2026-07-30')).toEqual({
      gameId: 77,
      date: '2026-08-02',
      opponent: 'BOS',
      opponentTeamId: 5,
      isHome: true,
      daysRest: 3,
    });
  });

  it('marks the player away when their team is the away side', () => {
    const g = { id: 78, game_date: '2026-08-02', home_team_id: 5, away_team_id: 9 };
    const out = buildUpcoming(g, 9, abbrById, '2026-08-01');
    expect(out?.isHome).toBe(false);
    expect(out?.opponent).toBe('BOS');
    expect(out?.daysRest).toBe(1);
  });

  it('returns null days rest when the last game date is unknown', () => {
    const g = { id: 79, game_date: '2026-08-02', home_team_id: 5, away_team_id: 9 };
    expect(buildUpcoming(g, 9, abbrById, null)?.daysRest).toBeNull();
  });

  it('returns null when the player has no team', () => {
    const g = { id: 80, game_date: '2026-08-02', home_team_id: 5, away_team_id: 9 };
    expect(buildUpcoming(g, null, abbrById, '2026-08-01')).toBeNull();
  });
});
