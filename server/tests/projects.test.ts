import { describe, expect, it } from 'vitest';
import { selectProjects, type ProjectRow } from '../src/utils/projects';

const now = new Date('2026-11-01T18:00:00Z');
const future = { status: 0, game_time: '2026-11-01T21:00:00Z' };
const games = new Map([
  [1, future],
  [2, { status: 0, game_time: '2026-11-01T17:00:00Z' }], // kicked off, status not yet synced
  [3, { status: 1, game_time: '2026-11-01T21:00:00Z' }], // live
  [4, { status: 0, game_time: null }], // unknown start
  [5, future],
  [6, future],
]);
let id = 0;
const row = (o: Partial<ProjectRow>): ProjectRow => ({
  id: ++id, prop_type: 'player', entity_id: id, model_prob: 0.55, game_id: 1, game_date: '2026-11-01', ...o,
});
const feat = (o: Partial<ProjectRow>) => row({ ...o, modifiers: { featured: true, belief: true, ...o.modifiers } });

describe('selectProjects', () => {
  it('serves featured props first, surest first', () => {
    const r = selectProjects(
      [row({ model_prob: 0.69, game_id: 5 }), feat({ model_prob: 0.6 }), feat({ model_prob: 0.65, game_id: 5 })],
      games, now,
    );
    expect(r.props.map((p) => Number(p.model_prob))).toEqual([0.65, 0.6, 0.69]);
  });
  it('refills a voided featured slot: form support and a new game first, then the surest', () => {
    const r = selectProjects(
      [
        feat({ game_id: 1 }), feat({ game_id: 5, modifiers: { void: 'injury' } }),
        row({ model_prob: 0.68, game_id: 1 }), // same game as a featured pick
        row({ model_prob: 0.66, game_id: 6 }), // no form support
        row({ model_prob: 0.57, game_id: 6, modifiers: { belief: true } }),
      ],
      games, now,
    );
    expect(r.props.map((p) => [p.game_id, Number(p.model_prob)])).toEqual([[1, 0.55], [6, 0.57], [1, 0.68]]);
  });
  it('allows a second pick from one game only when no other game can fill the slot', () => {
    const r = selectProjects([row({ model_prob: 0.6 }), row({ model_prob: 0.58 }), row({ model_prob: 0.57 })], games, now);
    expect(r.props).toHaveLength(3);
  });
  it('takes one line per player', () => {
    const r = selectProjects([feat({ entity_id: 500 }), row({ entity_id: 500, game_id: 5, model_prob: 0.69 })], games, now);
    expect(r.props).toHaveLength(1);
  });
  it('shows the soonest slate first', () => {
    const r = selectProjects(
      [feat({ game_date: '2026-11-08', model_prob: 0.69, game_id: 5 }), feat({ game_date: '2026-11-01', model_prob: 0.55 })],
      games, now,
    );
    expect(r.props[0].game_date).toBe('2026-11-01');
  });
  it('serves the featured winner, else the best in the 60-70% band with Elo agreeing', () => {
    const w = (p: number, mods = {}) => row({ prop_type: 'winner', model_prob: p, modifiers: mods });
    expect(Number(selectProjects([w(0.62), w(0.66, { featured: true })], games, now).moneyline?.model_prob)).toBe(0.66);
    expect(Number(selectProjects([w(0.69), w(0.64, { elo_agrees: true }), w(0.8)], games, now).moneyline?.model_prob)).toBe(0.64);
    expect(selectProjects([w(0.8)], games, now).moneyline).toBeNull();
  });
  it('groups every live row by game, props in game_rank order', () => {
    const r = selectProjects(
      [row({ modifiers: { game_rank: 2 } }), row({ modifiers: { game_rank: 1 } }), row({ prop_type: 'winner', model_prob: 0.6 })],
      games, now,
    );
    const g = r.byGame.get(1)!;
    expect(g.props.map((p) => p.modifiers?.game_rank)).toEqual([1, 2]);
    expect(Number(g.winner?.model_prob)).toBe(0.6);
  });
  it('hides started, live, unknown-start and voided picks', () => {
    const r = selectProjects(
      [row({ game_id: 2 }), row({ game_id: 3 }), row({ game_id: 4 }), row({ game_id: null }), row({ modifiers: { void: 'injury' } })],
      games, now,
    );
    expect(r.props).toEqual([]);
    expect(r.byGame.size).toBe(0);
  });
});
