import { describe, expect, it } from 'vitest';
import { gamePhase, selectLockedCard, selectProjects, type ProjectRow } from '../src/utils/projects';

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

import { onCardChanges } from '../src/utils/projects';

describe('onCardChanges', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const games = new Map([
    [1, { status: 0, game_time: '2026-11-08T18:00:00Z' }],   // upcoming
    [2, { status: 2, game_time: '2026-11-06T01:15:00Z' }],   // started
  ]);
  const row = (id: number, game_id: number, on_card: boolean | null) =>
    ({ id, prop_type: 'player', entity_id: id, model_prob: 0.55, game_id, on_card });

  it('marks shown rows and clears displaced ones on unstarted games', () => {
    const out = onCardChanges([row(1, 1, null), row(2, 1, true), row(3, 1, true)], new Set([1, 3]), games, now);
    expect(out).toEqual([{ id: 1, on_card: true }, { id: 2, on_card: false }]);
  });
  it('never touches a started game, so the flag freezes at kickoff', () => {
    expect(onCardChanges([row(4, 2, true), row(5, 2, null)], new Set(), games, now)).toEqual([]);
  });
});

describe('selectLockedCard', () => {
  const lockNow = new Date('2026-11-08T23:30:00Z');
  const lg = new Map([
    [10, { status: 2, game_time: '2026-11-08T20:30:00Z', game_date: '2026-11-08' }], // final
    [11, { status: 1, game_time: '2026-11-08T23:00:00Z', game_date: '2026-11-08' }], // live
    [12, { status: 0, game_time: '2026-11-09T02:00:00Z', game_date: '2026-11-08' }], // tonight
    [20, { status: 0, game_time: '2026-11-10T00:00:00Z', game_date: '2026-11-09' }], // tomorrow
  ]);
  const r = (o: Partial<ProjectRow> & { modifiers?: Record<string, unknown> }) =>
    row({ game_date: '2026-11-08', game_id: 12, ...o });

  it('keeps started picks on a final card and pulls nothing in to replace them', () => {
    const out = selectLockedCard(
      [
        r({ game_id: 10, modifiers: { featured: true } }),
        r({ game_id: 11, modifiers: { featured: true } }),
        r({ game_id: 12, model_prob: 0.69 }), // not featured: never funneled in
        r({ game_id: 20, game_date: '2026-11-09', modifiers: { featured: true } }),
      ],
      lg, lockNow,
    );
    expect(out.date).toBe('2026-11-08');
    expect(out.locked).toBe(true);
    expect(out.locksAt).toBe(new Date('2026-11-08T19:30:00Z').getTime());
    expect(out.props.map((p) => p.game_id)).toEqual([10, 11]);
  });

  it('keeps a voided featured pick on a final card rather than replacing it', () => {
    const out = selectLockedCard(
      [r({ modifiers: { featured: true, void: 'injury' } }), r({ model_prob: 0.69 })],
      lg, lockNow,
    );
    expect(out.props).toHaveLength(1);
    expect(out.props[0].modifiers?.void).toBe('injury');
  });

  it('lists the swaps on the card date in time order, out before in', () => {
    const out = selectLockedCard(
      [
        r({ modifiers: { featured: true, added_at: '2026-11-08T17:00:00Z' } }),
        r({ modifiers: { replaced_at: '2026-11-08T17:00:00Z', replaced_reason: 'player on the injury report' } }),
        r({ modifiers: { featured: true } }),
      ],
      lg, lockNow,
    );
    expect(out.changes.map((c) => [c.kind, c.reason])).toEqual([
      ['out', 'player on the injury report'],
      ['in', null],
    ]);
  });

  it('keeps each game\'s own picks visible after its tip', () => {
    const out = selectLockedCard([r({ game_id: 11 }), r({ game_id: 11, modifiers: { void: 'injury' } })], lg, lockNow);
    expect(out.byGame.get(11)?.props).toHaveLength(1);
  });

  it('labels a game upcoming, started or final', () => {
    expect(gamePhase(lg.get(10), lockNow)).toBe('final');
    expect(gamePhase(lg.get(11), lockNow)).toBe('started');
    expect(gamePhase(lg.get(12), lockNow)).toBe('upcoming');
  });
});
