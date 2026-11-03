import { describe, expect, it } from 'vitest';
import { selectProjects, type ProjectRow } from '../src/utils/projects';

const now = new Date('2026-11-01T18:00:00Z');
const future = { status: 0, game_time: '2026-11-01T21:00:00Z' };
const games = new Map([
  [1, future],
  [2, { status: 0, game_time: '2026-11-01T17:00:00Z' }], // kicked off, status not yet synced
  [3, { status: 1, game_time: '2026-11-01T21:00:00Z' }], // live
  [4, { status: 0, game_time: null }], // unknown start
]);
let id = 0;
const row = (o: Partial<ProjectRow>): ProjectRow => ({
  id: ++id, prop_type: 'player', entity_id: id, model_prob: 0.55, edge: 0.05, game_id: 1, ...o,
});

describe('selectProjects', () => {
  it('keeps a prop at exactly 60% and drops one above it', () => {
    const r = selectProjects([row({ model_prob: 0.6 }), row({ model_prob: 0.6001, edge: 0.5 })], games, now);
    expect(r.props.map((p) => Number(p.model_prob))).toEqual([0.6]);
  });
  it('drops a moneyline at exactly 70% and keeps one below it', () => {
    const r = selectProjects(
      [row({ prop_type: 'winner', model_prob: 0.7, edge: 0.5 }), row({ prop_type: 'winner', model_prob: 0.6999, edge: 0.02 })],
      games, now,
    );
    expect(Number(r.moneyline?.model_prob)).toBe(0.6999);
  });
  it('returns no moneyline rather than one over the cap', () => {
    expect(selectProjects([row({ prop_type: 'winner', model_prob: 0.8 })], games, now).moneyline).toBeNull();
  });
  it('ranks by edge, caps at 3, and takes one line per player', () => {
    const r = selectProjects(
      [row({ edge: 0.03 }), row({ edge: 0.09, entity_id: 500 }), row({ edge: 0.08, entity_id: 500 }), row({ edge: 0.07 }), row({ edge: 0.06 })],
      games, now,
    );
    expect(r.props.map((p) => Number(p.edge))).toEqual([0.09, 0.07, 0.06]);
  });
  it('returns fewer than 3 instead of filling slots', () => {
    expect(selectProjects([row({})], games, now).props).toHaveLength(1);
    expect(selectProjects([], games, now)).toEqual({ props: [], moneyline: null });
  });
  it('hides started, live, unknown-start and voided picks', () => {
    const r = selectProjects(
      [row({ game_id: 2 }), row({ game_id: 3 }), row({ game_id: 4 }), row({ game_id: null }), row({ modifiers: { void: 'injury' } })],
      games, now,
    );
    expect(r.props).toEqual([]);
  });
  it('ignores non-positive edge', () => {
    expect(selectProjects([row({ edge: 0 }), row({ edge: -0.01 })], games, now).props).toEqual([]);
  });
});
