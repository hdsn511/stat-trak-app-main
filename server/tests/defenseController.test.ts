import { describe, it, expect } from 'vitest';
import {
  DEFENSE_COLUMNS,
  pickDefenseRow,
  shapeDefense,
} from '../src/controllers/defenseController';

describe('DEFENSE_COLUMNS', () => {
  it('maps nba stat keys to their allowed and rank columns', () => {
    expect(DEFENSE_COLUMNS.pts).toEqual({ allowed: 'pts_allowed_pg', rank: 'league_rank' });
    expect(DEFENSE_COLUMNS.reb).toEqual({ allowed: 'reb_allowed_pg', rank: 'reb_rank' });
    expect(DEFENSE_COLUMNS.ast).toEqual({ allowed: 'ast_allowed_pg', rank: 'ast_rank' });
    expect(DEFENSE_COLUMNS.fg3m).toEqual({ allowed: 'fg3m_allowed_pg', rank: 'fg3m_rank' });
  });

  it('has no entry for an unsupported stat', () => {
    expect(DEFENSE_COLUMNS.blocks).toBeUndefined();
  });
});

describe('pickDefenseRow', () => {
  const rows = [
    { position_group: 'G', snapshot_date: '2026-06-01', pts_allowed_pg: 24 },
    { position_group: 'G', snapshot_date: '2026-06-15', pts_allowed_pg: 26 },
    { position_group: 'F', snapshot_date: '2026-06-15', pts_allowed_pg: 19 },
  ];

  it('picks the newest snapshot for the requested position group', () => {
    expect(pickDefenseRow(rows, 'G')?.pts_allowed_pg).toBe(26);
  });

  it('picks the newest row of any group when no group is requested', () => {
    expect(pickDefenseRow(rows, null)?.snapshot_date).toBe('2026-06-15');
  });

  it('returns null when the group has no rows', () => {
    expect(pickDefenseRow(rows, 'C')).toBeNull();
  });

  it('returns null for an empty result set', () => {
    expect(pickDefenseRow([], 'G')).toBeNull();
  });
});

describe('shapeDefense', () => {
  it('projects the row onto the DefenseSplit contract', () => {
    const row = {
      position_group: 'G',
      snapshot_date: '2026-06-15',
      pts_allowed_pg: 26.4,
      league_rank: 28,
    };
    expect(shapeDefense(row, 'pts')).toEqual({
      allowedPerGame: 26.4,
      leagueRank: 28,
      positionGroup: 'G',
      stat: 'pts',
      asOf: '2026-06-15',
    });
  });

  it('returns null when the row lacks the requested stat', () => {
    expect(shapeDefense({ position_group: 'G', snapshot_date: 'x' }, 'pts')).toBeNull();
  });

  it('returns null for an unsupported stat key', () => {
    expect(shapeDefense({ pts_allowed_pg: 20, snapshot_date: 'x' }, 'blocks')).toBeNull();
  });

  it('returns null for a null row', () => {
    expect(shapeDefense(null, 'pts')).toBeNull();
  });
});
