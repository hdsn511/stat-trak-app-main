# Filterable, Matchup-Aware Player View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a filterable, matchup-aware player view that works across NBA, MLB, NHL, and NFL from one set of components — window/opponent/home-away filters, a draggable prop line with hit rates, and an opponent matchup breakdown.

**Architecture:** The server gains NFL/NHL league configs, a full-season game log option, an upcoming-game field, and an opponent-defense endpoint. The client gains a role-based stat registry (`client/src/config/playerStats.ts`) plus a pure derivation module (`client/src/ember/player/derive.ts`) that computes every displayed number from `(games, filters, config)`. One `PlayerView` component renders in both the SportQuery side panel and a new full-screen route.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind (client), Express 5 + TypeScript + Supabase (server), Vitest on both sides.

**Spec:** `docs/superpowers/specs/2026-07-31-player-view-filterability-design.md`

## Global Constraints

- **No sport-specific stat names in UI code.** `PlayerView`, `derive.ts`, and all components under `client/src/ember/player/components/` must read stats from `PlayerStatConfig`. A literal `'points'` or `'rebounds'` in those files is a defect.
- **Ember design tokens only.** This view lives under `EmberLayout`. Use `font-chakra` (italic display), `font-martian` (data mono), `font-schibsted` (body), ember `#FF6B3D`, chalk `#EFEBE9`, muted `#9A918F`, card `#1B1715` with border `#2C2624`. Glyphs are typographic (`//`, `>_`, `→`) — no icons, no emoji.
- **Every displayed number carries a visible label.** Per the standing UI-clarity backlog item, no bare colored badge without the figure behind it.
- **Row Level Security is out of scope.** Do not enable RLS or write RLS policies in this work.
- **Existing routes stay working.** `/player/:id`, `/mlb/player/:id`, `/game/:id`, `/team/:id` under `LegacyLayout` must not change behavior.
- **Existing API callers stay working.** `getPlayerGames` defaults must not change; new behavior is opt-in via query params.
- **Client test command:** `cd client && npm test`. **Server test command:** `cd server && npm test`.

## File Structure

**Server**

| File | Responsibility |
|---|---|
| `server/src/config/leagues.ts` (modify) | Add `nfl` + `nhl` LeagueConfig entries; make `trendsTable` optional |
| `server/src/server.ts` (modify) | Mount `/api/nfl` and `/api/nhl` |
| `server/src/controllers/nbaController.ts` (modify) | `?window=all`; `upcoming` field; guard trends for leagues without a trends table |
| `server/src/controllers/defenseController.ts` (create) | Opponent position-defense lookup |
| `server/src/routes/nba.ts` (modify) | Register the defense route |
| `server/src/config/leagues.test.ts` (create) | League registry coverage |
| `server/src/controllers/defenseController.test.ts` (create) | Defense endpoint shaping |

**Client**

| File | Responsibility |
|---|---|
| `client/src/config/playerStats.ts` (create) | Role-based stat registry for all four leagues |
| `client/src/config/playerStats.test.ts` (create) | Registry + role-resolution coverage |
| `client/src/ember/player/types.ts` (create) | `GameRow`, `PlayerFilters`, `DerivedView` shared types |
| `client/src/ember/player/derive.ts` (create) | Pure derivation: filter, hit rate, splits, signal |
| `client/src/ember/player/derive.test.ts` (create) | Derivation coverage |
| `client/src/services/api.ts` (modify) | `getPlayerLog`, `getTeamDefense` on the league factory |
| `client/src/ember/player/usePlayerData.ts` (create) | Fetch + loading/error state |
| `client/src/ember/player/usePlayerFilters.ts` (create) | Filter reducer with line-touch tracking |
| `client/src/ember/player/components/FilterBar.tsx` (create) | Window / opponent / home-away / stat controls |
| `client/src/ember/player/components/LineControl.tsx` (create) | Line stepper + hit-rate readout |
| `client/src/ember/player/components/GameLogChart.tsx` (create) | Bars + draggable threshold line |
| `client/src/ember/player/components/StatLineCards.tsx` (create) | Per-stat filtered-window cards |
| `client/src/ember/player/components/GameLogTable.tsx` (create) | Filtered log with volume column |
| `client/src/ember/player/components/MatchupPanel.tsx` (create) | Splits, chips, signal, H2H |
| `client/src/ember/player/PlayerView.tsx` (create) | Shell composing the above; `mode` prop |
| `client/src/ember/player/PlayerPage.tsx` (create) | Route wrapper for `/player/:league/:id` |
| `client/src/App.tsx` (modify) | Register the new route |
| `client/src/ember/sportquery/DetailPane.tsx` (modify) | Swap fixture PlayerDetail for PlayerView |

---

### Task 1: NFL and NHL league configs on the server

**Files:**
- Modify: `server/src/config/leagues.ts`
- Modify: `server/src/server.ts:30-41`
- Test: `server/src/config/leagues.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LeagueSlug` widened to `'nba' | 'mlb' | 'nfl' | 'nhl'`; `LEAGUES.nfl` and `LEAGUES.nhl` of type `LeagueConfig`; `LeagueConfig.trendsTable` becomes `string | null`.

- [ ] **Step 1: Write the failing test**

Create `server/src/config/leagues.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LEAGUES, league } from './leagues';
import type { Response } from 'express';

describe('league registry', () => {
  it('registers all four leagues', () => {
    expect(Object.keys(LEAGUES).sort()).toEqual(['mlb', 'nba', 'nfl', 'nhl']);
  });

  it('maps each league to its own stats table and league id', () => {
    expect(LEAGUES.nba.statsTable).toBe('nba_player_stats');
    expect(LEAGUES.mlb.statsTable).toBe('mlb_player_stats');
    expect(LEAGUES.nhl.statsTable).toBe('nhl_player_stats');
    expect(LEAGUES.nfl.statsTable).toBe('nfl_player_stats');
    expect(LEAGUES.nba.leagueId).toBe(1);
    expect(LEAGUES.mlb.leagueId).toBe(2);
    expect(LEAGUES.nfl.leagueId).toBe(3);
    expect(LEAGUES.nhl.leagueId).toBe(4);
  });

  it('has no trends table for nfl and nhl', () => {
    expect(LEAGUES.nfl.trendsTable).toBeNull();
    expect(LEAGUES.nhl.trendsTable).toBeNull();
    expect(LEAGUES.nba.trendsTable).toBe('nba_trends');
  });

  it('gates nhl on time on ice and nfl on no gate column', () => {
    expect(LEAGUES.nhl.playedGate.col).toBe('toi_seconds');
    expect(LEAGUES.nfl.playedGate).toBeNull();
  });

  it('selects game_date and team_id in every playerGameSelect', () => {
    for (const cfg of Object.values(LEAGUES)) {
      expect(cfg.playerGameSelect).toContain('game_date');
      expect(cfg.playerGameSelect).toContain('team_id');
    }
  });

  it('falls back to nba when no league is on res.locals', () => {
    expect(league({ locals: {} } as Response).slug).toBe('nba');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/config/leagues.test.ts`
Expected: FAIL — `LEAGUES.nfl` is undefined and `playedGate` is not nullable.

- [ ] **Step 3: Widen the config type**

In `server/src/config/leagues.ts`, change the type and interface:

```ts
export type LeagueSlug = 'nba' | 'mlb' | 'nfl' | 'nhl';

export interface LeagueConfig {
  slug: LeagueSlug;
  leagueId: number;
  playerLeagueTag: string;
  /** null for leagues with no computed trends table (nfl, nhl). */
  trendsTable: string | null;
  statsTable: string;
  dailyConditionsTable: string | null;
  statLabels: Record<string, string>;
  trendStatNames: Record<number, string>;
  validStatIds: number[];
  statConfig: Record<string, { col: string; statId: number }>;
  streakStats: string[];
  streakStartDate: string;
  streakGateTierIndex: number;
  streakLineFloor?: number;
  /** null when the league has no single "appeared" column. */
  playedGate: { col: string; min: number } | null;
  playerGameSelect: string;
}
```

Then update the existing NBA and MLB entries: add `trendsTable` unchanged (they keep their string values), and change nothing else about them. Add `dailyConditionsTable: null` handling is not needed — NBA and MLB already set it.

- [ ] **Step 4: Add the NHL config**

Append to `server/src/config/leagues.ts`, before the `LEAGUES` export:

```ts
// ── NHL ─────────────────────────────────────────────────────────────────────────
// Skaters and goalies live in the same table, distinguished by position_type.
// Volume is time on ice, stored in seconds.
const NHL: LeagueConfig = {
  slug: 'nhl',
  leagueId: 4,
  playerLeagueTag: 'nhl',
  trendsTable: null,
  statsTable: 'nhl_player_stats',
  dailyConditionsTable: null,
  statLabels: { g: 'G', a: 'A', p: 'PTS', sog: 'SOG', blk: 'BLK', hits: 'HITS' },
  trendStatNames: {},
  validStatIds: [],
  statConfig: {
    g:    { col: 'goals',          statId: 0 },
    a:    { col: 'assists',        statId: 1 },
    p:    { col: 'points',         statId: 2 },
    sog:  { col: 'shots_on_goal',  statId: 3 },
    blk:  { col: 'blocks',         statId: 4 },
    hits: { col: 'hits',           statId: 5 },
  },
  streakStats: [],
  streakStartDate: '2025-10-01',
  streakGateTierIndex: 0,
  playedGate: { col: 'toi_seconds', min: 0 },
  playerGameSelect:
    'game_id, team_id, game_date, position_type, goals, assists, points, shots_on_goal, ' +
    'blocks, hits, plus_minus, pim, takeaways, giveaways, toi_seconds, pp_toi_seconds, ' +
    'saves, shots_against, goals_against, save_pct, goalie_toi_seconds, games!inner(game_type)',
};
```

- [ ] **Step 5: Add the NFL config**

Append immediately after NHL:

```ts
// ── NFL ─────────────────────────────────────────────────────────────────────────
// No single "appeared" column exists — a QB has attempts, a WR has targets, a
// linebacker has tackles. playedGate is null and the controller skips the gate.
const NFL: LeagueConfig = {
  slug: 'nfl',
  leagueId: 3,
  playerLeagueTag: 'nfl',
  trendsTable: null,
  statsTable: 'nfl_player_stats',
  dailyConditionsTable: null,
  statLabels: {
    payds: 'PASS YDS', patd: 'PASS TD', ruyds: 'RUSH YDS', rutd: 'RUSH TD',
    recyds: 'REC YDS', rec: 'REC', rectd: 'REC TD', tkl: 'TKL',
  },
  trendStatNames: {},
  validStatIds: [],
  statConfig: {
    payds:  { col: 'passing_yards',   statId: 0 },
    patd:   { col: 'passing_tds',     statId: 1 },
    ruyds:  { col: 'rushing_yards',   statId: 2 },
    rutd:   { col: 'rushing_tds',     statId: 3 },
    recyds: { col: 'receiving_yards', statId: 4 },
    rec:    { col: 'receptions',      statId: 5 },
    rectd:  { col: 'receiving_tds',   statId: 6 },
    tkl:    { col: 'tackles_total',   statId: 7 },
  },
  streakStats: [],
  streakStartDate: '2025-09-01',
  streakGateTierIndex: 0,
  playedGate: null,
  playerGameSelect:
    'game_id, team_id, game_date, completions, attempts, passing_yards, passing_tds, ' +
    'interceptions, carries, rushing_yards, rushing_tds, receptions, targets, ' +
    'receiving_yards, receiving_tds, fumbles_lost, tackles_total, sacks, ' +
    'fg_made, fg_att, games!inner(game_type)',
};

export const LEAGUES: Record<LeagueSlug, LeagueConfig> = { nba: NBA, mlb: MLB, nfl: NFL, nhl: NHL };
```

Delete the old single-line `LEAGUES` export that only listed nba and mlb.

- [ ] **Step 6: Make the played gate optional in the controller**

In `server/src/controllers/nbaController.ts`, the `getPlayerGames` query currently always calls `.gt(gate.col, gate.min)`. Find this block (around line 297-320) and make the gate conditional. Replace:

```ts
    const select = isPitcher ? MLB_PITCHER_SELECT : lg.playerGameSelect;
    const gate = isPitcher ? { col: 'batters_faced', min: 0 } : lg.playedGate;
```

with:

```ts
    const select = isPitcher ? MLB_PITCHER_SELECT : lg.playerGameSelect;
    const gate = isPitcher ? { col: 'batters_faced', min: 0 } : lg.playedGate;

    // NFL has no single "appeared" column, so its gate is null and every row
    // for the player counts as an appearance.
    const applyGate = <T extends { gt: (c: string, v: number) => T }>(q: T): T =>
      gate ? q.gt(gate.col, gate.min) : q;
```

Then replace both `.gt(gate.col, gate.min)` call sites in the `Promise.all` with the wrapper. The recent-games query becomes:

```ts
      applyGate(
        supabaseAdmin
          .from(lg.statsTable)
          .select(select)
          .eq('player_id', parseInt(id))
          .in('games.game_type', gameTypes)
          .order('game_date', { ascending: false })
          .limit(20) as any
      ),
```

and the season query becomes:

```ts
      applyGate(
        supabaseAdmin
          .from(lg.statsTable)
          .select(select)
          .eq('player_id', parseInt(id))
          .gte('game_date', seasonStart)
          .in('games.game_type', gameTypes) as any
      ),
```

- [ ] **Step 7: Guard the trends query for leagues without a trends table**

Still in `getPlayerGames`, the `trendsResult` entry of the `Promise.all` queries `lg.trendsTable` unconditionally. Replace that entry with:

```ts
      lg.trendsTable
        ? supabaseAdmin
            .from(lg.trendsTable)
            .select('stat, trend_val, rolling_avg, window_size')
            .eq('player_id', parseInt(id))
            .eq('window_size', 10)
        : Promise.resolve({ data: [], error: null }),
```

and change the error guard below it from `if (trendsResult.error) throw trendsResult.error;` to:

```ts
    if (lg.trendsTable && trendsResult.error) throw trendsResult.error;
```

- [ ] **Step 8: Extend the season-average column map for NHL and NFL**

In the same function, the `seasonAvgCols` ternary chain currently ends with the NBA branch. Replace the whole `const seasonAvgCols` assignment with:

```ts
    const seasonAvgCols: Record<string, string> = isPitcher
      ? {
          strikeouts_pitched: 'strikeouts_pitched',
          outs_pitched: 'outs_pitched',
          earned_runs: 'earned_runs',
          hits_allowed: 'hits_allowed',
          walks_allowed: 'walks_allowed',
        }
      : lg.slug === 'mlb'
      ? { hits: 'hits', total_bases: 'total_bases', rbi: 'rbi', runs: 'runs', home_runs: 'home_runs' }
      : lg.slug === 'nhl'
      ? { goals: 'goals', assists: 'assists', points: 'points', shots_on_goal: 'shots_on_goal',
          blocks: 'blocks', hits: 'hits', toi_seconds: 'toi_seconds' }
      : lg.slug === 'nfl'
      ? { passing_yards: 'passing_yards', rushing_yards: 'rushing_yards',
          receiving_yards: 'receiving_yards', receptions: 'receptions',
          tackles_total: 'tackles_total' }
      : { points: 'points', rebounds: 'rebounds', assists: 'assists', three_points_made: 'threes' };
```

- [ ] **Step 9: Map NHL and NFL game rows in the response**

In the `games: statsRows.map(...)` callback, the chain returns MLB pitcher, MLB batter, then NBA shapes. Insert two branches before the final NBA return:

```ts
          if (lg.slug === 'nhl') {
            return {
              ...base,
              goals: g.goals, assists: g.assists, points: g.points,
              shotsOnGoal: g.shots_on_goal, blocks: g.blocks, hits: g.hits,
              plusMinus: g.plus_minus, pim: g.pim,
              takeaways: g.takeaways, giveaways: g.giveaways,
              toiSeconds: g.toi_seconds, ppToiSeconds: g.pp_toi_seconds,
              positionType: g.position_type,
              saves: g.saves, shotsAgainst: g.shots_against,
              goalsAgainst: g.goals_against, savePct: g.save_pct,
              goalieToiSeconds: g.goalie_toi_seconds,
            };
          }
          if (lg.slug === 'nfl') {
            return {
              ...base,
              completions: g.completions, attempts: g.attempts,
              passingYards: g.passing_yards, passingTds: g.passing_tds,
              interceptions: g.interceptions,
              carries: g.carries, rushingYards: g.rushing_yards, rushingTds: g.rushing_tds,
              receptions: g.receptions, targets: g.targets,
              receivingYards: g.receiving_yards, receivingTds: g.receiving_tds,
              fumblesLost: g.fumbles_lost,
              tacklesTotal: g.tackles_total, sacks: g.sacks,
              fgMade: g.fg_made, fgAtt: g.fg_att,
            };
          }
```

- [ ] **Step 10: Mount the NFL and NHL routes**

In `server/src/server.ts`, after the existing mlb mounts (line 33), add:

```ts
app.use('/api/nhl', leagueMiddleware('nhl'), nbaRoutes);
app.use('/api/nfl', leagueMiddleware('nfl'), nbaRoutes);
```

Do NOT mount `picksRoutes` for these leagues — they have no trends or picks data.

- [ ] **Step 11: Run tests to verify they pass**

Run: `cd server && npx vitest run src/config/leagues.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 12: Verify the server still compiles**

Run: `cd server && npx tsc --noEmit`
Expected: no errors. If `applyGate`'s generic fights the Supabase builder types, widen the parameter to `any` rather than restructuring the queries.

- [ ] **Step 13: Commit**

```bash
git add server/src/config/leagues.ts server/src/config/leagues.test.ts server/src/server.ts server/src/controllers/nbaController.ts
git commit -m "feat(server): register NFL and NHL leagues

Both already have per-game stats in Supabase. Neither has a trends
table, so trendsTable is now nullable and the trends query is skipped
for them. NFL has no single appearance column, so playedGate is
nullable too."
```

---

### Task 2: Full season log and upcoming game

**Files:**
- Modify: `server/src/controllers/nbaController.ts` (`getPlayerGames`)
- Test: `server/src/controllers/playerLog.test.ts` (create)

**Interfaces:**
- Consumes: `LeagueConfig` from Task 1.
- Produces: `GET /api/{league}/players/{id}/games?window=all` returns every season row; the response gains `upcoming: UpcomingGame | null` where

```ts
interface UpcomingGame {
  gameId: number;
  date: string;          // 'YYYY-MM-DD'
  opponent: string;      // 'BOS'
  opponentTeamId: number;
  isHome: boolean;
  daysRest: number | null;
}
```

- [ ] **Step 1: Write the failing test**

Create `server/src/controllers/playerLog.test.ts`. This tests the pure helpers rather than the Supabase round trip, so extract them as named exports in the next steps.

```ts
import { describe, it, expect } from 'vitest';
import { resolveLogLimit, buildUpcoming } from './nbaController';

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
  const abbrById = { 5: 'BOS', 9: 'LAL' };

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/controllers/playerLog.test.ts`
Expected: FAIL — `resolveLogLimit` and `buildUpcoming` are not exported.

- [ ] **Step 3: Add the two helpers**

At the top of `server/src/controllers/nbaController.ts`, after the imports, add:

```ts
/** Rows to return from the player game log. `all` means the whole season. */
export function resolveLogLimit(window: unknown): number | null {
  if (window === 'all') return null;
  if (typeof window !== 'string') return 20;
  const n = parseInt(window, 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, 500);
}

interface ScheduledGame {
  id: number;
  game_date: string;
  home_team_id: number;
  away_team_id: number;
}

/**
 * Shape the player's next scheduled game. `lastPlayedDate` is the date of their
 * most recent completed game, used for days rest; null when they have none.
 */
export function buildUpcoming(
  game: ScheduledGame | null,
  playerTeamId: number | null,
  abbrById: Record<number, string>,
  lastPlayedDate: string | null
) {
  if (!game || playerTeamId == null) return null;
  const isHome = game.home_team_id === playerTeamId;
  const opponentTeamId = isHome ? game.away_team_id : game.home_team_id;
  const daysRest =
    lastPlayedDate == null
      ? null
      : Math.round(
          (Date.parse(game.game_date) - Date.parse(lastPlayedDate)) / 86_400_000
        );
  return {
    gameId: game.id,
    date: game.game_date,
    opponent: abbrById[opponentTeamId] ?? '',
    opponentTeamId,
    isHome,
    daysRest,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/controllers/playerLog.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Wire the window param into the log query**

In `getPlayerGames`, immediately after `const { id } = req.params;` add:

```ts
    const logLimit = resolveLogLimit(req.query.window);
```

Then in the recent-games query inside `Promise.all`, replace the `.limit(20)` call with a conditional. Change:

```ts
          .order('game_date', { ascending: false })
          .limit(20) as any
```

to:

```ts
          .order('game_date', { ascending: false })
          .limit(logLimit ?? 5000) as any
```

Also add `.gte('game_date', seasonStart)` to that same query so `window=all` returns the current season rather than every season on file. The recent-20 default is unaffected by the extra filter because 20 recent games are always within the season.

- [ ] **Step 6: Fetch and attach the upcoming game**

`getPlayerGames` already builds `abbrById` and `playerTeamId` inside the `if (gameIds.length > 0)` block, but both are scoped to it. Hoist `abbrById` so it is visible afterward: change the inner `const abbrById: Record<number, string> = {};` to assign to an outer `let`. Declare `let abbrById: Record<number, string> = {};` just above `if (gameIds.length > 0) {` and drop the `const` inside.

Then after that block closes and before the `res.json(...)` call, add:

```ts
    // Next scheduled game for the player's team. Most leagues are out of season
    // for much of the year, so this is frequently null and the client falls back
    // to a user-selected opponent.
    let upcoming = null;
    if (playerTeamId != null) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: nextGames } = await supabaseAdmin
        .from('games')
        .select('id, game_date, home_team_id, away_team_id')
        .eq('league_id', lg.leagueId)
        .gte('game_date', today)
        .or(`home_team_id.eq.${playerTeamId},away_team_id.eq.${playerTeamId}`)
        .order('game_date', { ascending: true })
        .limit(1);
      const next = (nextGames || [])[0];
      if (next) {
        const oppId = next.home_team_id === playerTeamId ? next.away_team_id : next.home_team_id;
        if (abbrById[oppId] == null) {
          const { data: oppTeam } = await supabaseAdmin
            .from('teams').select('id, abbreviation').eq('id', oppId).single();
          if (oppTeam) abbrById[oppTeam.id] = oppTeam.abbreviation;
        }
        const lastPlayed = statsRows.length > 0 ? (statsRows[0] as any).game_date : null;
        upcoming = buildUpcoming(next as any, playerTeamId, abbrById, lastPlayed);
      }
    }
```

- [ ] **Step 7: Add `upcoming` to the response payload**

In the `res.json({ success: true, data: { ... } })` object, add `upcoming,` as a sibling of `gamesPlayed`.

- [ ] **Step 8: Verify compilation and behavior**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

Then start the server (`npm run dev` in `server/`) and verify by hand:

```bash
curl -s "http://localhost:3000/api/nba/players/1/games" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('games:',j.data.games.length,'upcoming:',j.data.upcoming)})"
curl -s "http://localhost:3000/api/nba/players/1/games?window=all" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('all games:',j.data.games.length)})"
```

Expected: the default returns at most 20 games; `window=all` returns more (a full season for an everyday player). `upcoming` will be `null` for NBA out of season — that is correct, not a failure.

- [ ] **Step 9: Commit**

```bash
git add server/src/controllers/nbaController.ts server/src/controllers/playerLog.test.ts
git commit -m "feat(server): full-season player log and next-game lookup

?window=all returns every season row; the response gains an upcoming
field with opponent, home/away, and days rest. Null out of season."
```

---

### Task 3: Opponent defense endpoint

**Files:**
- Create: `server/src/controllers/defenseController.ts`
- Modify: `server/src/routes/nba.ts`
- Test: `server/src/controllers/defenseController.test.ts` (create)

**Interfaces:**
- Consumes: `league()` from `server/src/config/leagues.ts`.
- Produces: `GET /api/{league}/teams/:id/defense?stat={key}&position={group}` returning `{ success: true, data: DefenseSplit | null }` where

```ts
interface DefenseSplit {
  allowedPerGame: number;
  leagueRank: number;
  positionGroup: string | null;
  stat: string;
  asOf: string;
}
```

- [ ] **Step 1: Write the failing test**

Create `server/src/controllers/defenseController.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFENSE_COLUMNS, pickDefenseRow, shapeDefense } from './defenseController';

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
      position_group: 'G', snapshot_date: '2026-06-15',
      pts_allowed_pg: 26.4, league_rank: 28,
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/controllers/defenseController.test.ts`
Expected: FAIL — module `./defenseController` does not exist.

- [ ] **Step 3: Write the controller**

Create `server/src/controllers/defenseController.ts`:

```ts
import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league as resolveLeague } from '../config/leagues';

// opponent_position_defense is NBA-shaped: one row per (team, position group,
// snapshot) with a per-stat allowed average and league rank. Other leagues have
// no equivalent table yet, so the endpoint returns null for them and the client
// suppresses only the matchup-signal badge.
export const DEFENSE_COLUMNS: Record<string, { allowed: string; rank: string }> = {
  pts:  { allowed: 'pts_allowed_pg',  rank: 'league_rank' },
  reb:  { allowed: 'reb_allowed_pg',  rank: 'reb_rank' },
  ast:  { allowed: 'ast_allowed_pg',  rank: 'ast_rank' },
  fg3m: { allowed: 'fg3m_allowed_pg', rank: 'fg3m_rank' },
};

type DefenseRow = Record<string, any>;

/** Newest snapshot for the requested position group, or any group when null. */
export function pickDefenseRow(rows: DefenseRow[], positionGroup: string | null): DefenseRow | null {
  const scoped = positionGroup ? rows.filter((r) => r.position_group === positionGroup) : rows;
  if (scoped.length === 0) return null;
  return scoped.reduce((newest, r) =>
    String(r.snapshot_date) > String(newest.snapshot_date) ? r : newest
  );
}

export function shapeDefense(row: DefenseRow | null, stat: string) {
  const cols = DEFENSE_COLUMNS[stat];
  if (!row || !cols) return null;
  const allowed = row[cols.allowed];
  if (allowed == null) return null;
  return {
    allowedPerGame: allowed,
    leagueRank: row[cols.rank] ?? null,
    positionGroup: row.position_group ?? null,
    stat,
    asOf: row.snapshot_date,
  };
}

// Short in-process cache — this is a season aggregate that changes at most daily.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; rows: DefenseRow[] }>();

export async function getTeamDefense(req: Request<{ id: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const stat = String(req.query.stat ?? 'pts');
    const positionGroup = req.query.position ? String(req.query.position) : null;
    const teamId = parseInt(req.params.id, 10);

    if (!Number.isFinite(teamId)) {
      return res.status(400).json({ success: false, error: 'invalid team id' });
    }
    // Only NBA has a defense table, and only these stats are stored.
    if (lg.slug !== 'nba' || !DEFENSE_COLUMNS[stat]) {
      return res.json({ success: true, data: null });
    }

    const key = `${lg.slug}:${teamId}`;
    const hit = cache.get(key);
    let rows: DefenseRow[];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      rows = hit.rows;
    } else {
      const { data, error } = await supabaseAdmin
        .from('opponent_position_defense')
        .select('position_group, snapshot_date, pts_allowed_pg, reb_allowed_pg, ast_allowed_pg, fg3m_allowed_pg, league_rank, reb_rank, ast_rank, fg3m_rank')
        .eq('team_id', teamId);
      if (error) throw error;
      rows = data || [];
      cache.set(key, { at: Date.now(), rows });
    }

    res.json({ success: true, data: shapeDefense(pickDefenseRow(rows, positionGroup), stat) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
```

- [ ] **Step 4: Register the route**

In `server/src/routes/nba.ts`, add the import and the route. The route must be declared **before** `router.get('/teams/:id', getTeamById)` so the more specific path wins:

```ts
import { getTeamDefense } from '../controllers/defenseController';
```

```ts
router.get('/teams/:id/defense', getTeamDefense);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/controllers/defenseController.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify against the real table**

With the server running:

```bash
curl -s "http://localhost:3000/api/nba/teams/1/defense?stat=pts&position=G"
curl -s "http://localhost:3000/api/nhl/teams/1/defense?stat=pts"
```

Expected: the first returns a `DefenseSplit` object with a rank and an `asOf` date; the second returns `{"success":true,"data":null}` because NHL has no defense table.

- [ ] **Step 7: Commit**

```bash
git add server/src/controllers/defenseController.ts server/src/controllers/defenseController.test.ts server/src/routes/nba.ts
git commit -m "feat(server): opponent position-defense endpoint

Reads the existing opponent_position_defense snapshot table for NBA,
returns null for leagues without an equivalent. Cached 10 minutes."
```

---

### Task 4: Role-based player stat registry (client)

**Files:**
- Create: `client/src/config/playerStats.ts`
- Test: `client/src/config/playerStats.test.ts`

**Interfaces:**
- Consumes: `LeagueSlug` from `client/src/config/leagues.ts`.
- Produces:

```ts
export interface StatDef {
  key: string
  label: string
  get: (g: GameRow) => number | null
  format?: (v: number) => string
  decimals?: number
}
export interface PlayerStatConfig {
  slug: LeagueSlug
  windows: number[]
  roleOf: (p: { position?: string | null }, sample?: GameRow) => string
  volumeFor: (role: string) => StatDef | null
  statsFor: (role: string) => StatDef[]
  combosFor: (role: string) => StatDef[]
}
export function getPlayerStatConfig(slug: LeagueSlug): PlayerStatConfig
export function allStatsFor(cfg: PlayerStatConfig, role: string): StatDef[]  // stats + combos
export function formatVolume(def: StatDef | null, v: number | null): string
```

`GameRow` is `Record<string, number | string | boolean | null | undefined>` — the raw shape the API returns per game.

- [ ] **Step 1: Write the failing test**

Create `client/src/config/playerStats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getPlayerStatConfig, allStatsFor, formatVolume } from './playerStats'

describe('nba stat config', () => {
  const cfg = getPlayerStatConfig('nba')

  it('uses game-count windows ending in 0 for all', () => {
    expect(cfg.windows).toEqual([5, 10, 20, 0])
  })

  it('gives every player the same role', () => {
    expect(cfg.roleOf({ position: 'G' })).toBe('player')
    expect(cfg.roleOf({ position: 'C' })).toBe('player')
  })

  it('uses minutes as the volume stat', () => {
    const v = cfg.volumeFor('player')
    expect(v?.key).toBe('minutes')
    expect(v?.label).toBe('MIN')
    expect(v?.get({ minutes: 34 })).toBe(34)
  })

  it('exposes pts, reb, ast, threes', () => {
    expect(cfg.statsFor('player').map((s) => s.key)).toEqual(['points', 'rebounds', 'assists', 'threes'])
  })

  it('derives PRA as the sum of points, rebounds, assists', () => {
    const pra = cfg.combosFor('player').find((c) => c.key === 'pra')
    expect(pra?.get({ points: 30, rebounds: 8, assists: 6 })).toBe(44)
  })

  it('returns null for PRA when a component is missing', () => {
    const pra = cfg.combosFor('player').find((c) => c.key === 'pra')
    expect(pra?.get({ points: 30, rebounds: null, assists: 6 })).toBeNull()
  })
})

describe('mlb stat config', () => {
  const cfg = getPlayerStatConfig('mlb')

  it('separates pitchers from batters by position', () => {
    expect(cfg.roleOf({ position: 'SP' })).toBe('pitcher')
    expect(cfg.roleOf({ position: 'RP' })).toBe('pitcher')
    expect(cfg.roleOf({ position: 'CF' })).toBe('batter')
    expect(cfg.roleOf({ position: null })).toBe('batter')
  })

  it('gives batters plate appearances and pitchers outs', () => {
    expect(cfg.volumeFor('batter')?.key).toBe('plateAppearances')
    expect(cfg.volumeFor('pitcher')?.key).toBe('outsPitched')
  })

  it('gives the two roles disjoint stat sets', () => {
    const b = cfg.statsFor('batter').map((s) => s.key)
    const p = cfg.statsFor('pitcher').map((s) => s.key)
    expect(b.some((k) => p.includes(k))).toBe(false)
  })
})

describe('nhl stat config', () => {
  const cfg = getPlayerStatConfig('nhl')

  it('reads the role off the game row position type', () => {
    expect(cfg.roleOf({ position: 'G' }, { positionType: 'goalie' })).toBe('goalie')
    expect(cfg.roleOf({ position: 'C' }, { positionType: 'skater' })).toBe('skater')
  })

  it('defaults to skater with no sample row', () => {
    expect(cfg.roleOf({ position: 'C' })).toBe('skater')
  })

  it('formats time on ice as minutes and seconds', () => {
    const toi = cfg.volumeFor('skater')
    expect(toi?.key).toBe('toiSeconds')
    expect(formatVolume(toi, 1122)).toBe('18:42')
    expect(formatVolume(toi, 605)).toBe('10:05')
  })

  it('gives goalies saves rather than goals', () => {
    const keys = cfg.statsFor('goalie').map((s) => s.key)
    expect(keys).toContain('saves')
    expect(keys).not.toContain('goals')
  })
})

describe('nfl stat config', () => {
  const cfg = getPlayerStatConfig('nfl')

  it('uses a 17-game season shaped window set', () => {
    expect(cfg.windows).toEqual([3, 6, 17, 0])
  })

  it('buckets positions into roles', () => {
    expect(cfg.roleOf({ position: 'QB' })).toBe('qb')
    expect(cfg.roleOf({ position: 'RB' })).toBe('rb')
    expect(cfg.roleOf({ position: 'FB' })).toBe('rb')
    expect(cfg.roleOf({ position: 'WR' })).toBe('receiver')
    expect(cfg.roleOf({ position: 'TE' })).toBe('receiver')
    expect(cfg.roleOf({ position: 'LB' })).toBe('defense')
    expect(cfg.roleOf({ position: 'PK' })).toBe('kicker')
    expect(cfg.roleOf({ position: null })).toBe('defense')
  })

  it('varies the volume stat by role', () => {
    expect(cfg.volumeFor('qb')?.key).toBe('attempts')
    expect(cfg.volumeFor('rb')?.key).toBe('carries')
    expect(cfg.volumeFor('receiver')?.key).toBe('targets')
    expect(cfg.volumeFor('kicker')).toBeNull()
  })

  it('gives receivers a scrimmage-yards combo', () => {
    const combo = cfg.combosFor('receiver').find((c) => c.key === 'scrimmageYards')
    expect(combo?.get({ receivingYards: 80, rushingYards: 12 })).toBe(92)
  })
})

describe('allStatsFor', () => {
  it('concatenates single stats and combos', () => {
    const cfg = getPlayerStatConfig('nba')
    const keys = allStatsFor(cfg, 'player').map((s) => s.key)
    expect(keys).toContain('points')
    expect(keys).toContain('pra')
  })
})

describe('formatVolume', () => {
  it('renders a dash for a null value', () => {
    expect(formatVolume(getPlayerStatConfig('nba').volumeFor('player'), null)).toBe('—')
  })

  it('renders a plain number when the def has no formatter', () => {
    expect(formatVolume(getPlayerStatConfig('nba').volumeFor('player'), 34)).toBe('34')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/config/playerStats.test.ts`
Expected: FAIL — module `./playerStats` does not exist.

- [ ] **Step 3: Write the shared types**

Create `client/src/ember/player/types.ts`:

```ts
/** One row from GET /api/{league}/players/{id}/games. Shape varies by league. */
export type GameRow = Record<string, string | number | boolean | null | undefined>

export interface UpcomingGame {
  gameId: number
  date: string
  opponent: string
  opponentTeamId: number
  isHome: boolean
  daysRest: number | null
}

export interface DefenseSplit {
  allowedPerGame: number
  leagueRank: number | null
  positionGroup: string | null
  stat: string
  asOf: string
}

export interface PlayerLogResponse {
  player: { id: number; name: string; team: string; position: string | null }
  teamId: number | null
  games: GameRow[]
  seasonAvgs: Record<string, number>
  gamesPlayed: number
  upcoming: UpcomingGame | null
}

export type HomeAway = 'all' | 'home' | 'away'

export interface PlayerFilters {
  /** Game count; 0 means the whole season. */
  window: number
  /** Opponent abbreviation, or null for all teams. */
  vsTeam: string | null
  homeAway: HomeAway
  /** Stat key from the league config. */
  stat: string
  line: number
  /** True once the user has moved the line off the computed average. */
  lineTouched: boolean
}
```

- [ ] **Step 4: Write the registry**

Create `client/src/config/playerStats.ts`:

```ts
import type { LeagueSlug } from './leagues'
import type { GameRow } from '@/ember/player/types'

// Player stat registry. Stats are resolved from a player's ROLE, not from the
// league alone: an NFL quarterback and a receiver share no columns, and NHL
// skaters and goalies share none. Every consumer reads stats from here so no
// UI code names a sport-specific column.

export interface StatDef {
  key: string
  label: string
  get: (g: GameRow) => number | null
  /** Display transform, e.g. TOI seconds → "18:42". */
  format?: (v: number) => string
  /** Decimal places for averages. Defaults to 1. */
  decimals?: number
}

export interface PlayerStatConfig {
  slug: LeagueSlug
  /** Game-count windows offered in the filter bar. 0 means the whole season. */
  windows: number[]
  roleOf: (p: { position?: string | null }, sample?: GameRow) => string
  volumeFor: (role: string) => StatDef | null
  statsFor: (role: string) => StatDef[]
  combosFor: (role: string) => StatDef[]
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Build a StatDef reading one numeric field. */
const field = (key: string, label: string, extra: Partial<StatDef> = {}): StatDef => ({
  key,
  label,
  get: (g) => num(g[key]),
  ...extra,
})

/** Build a StatDef summing several fields; null if any component is missing. */
const sum = (key: string, label: string, parts: string[]): StatDef => ({
  key,
  label,
  get: (g) => {
    let total = 0
    for (const p of parts) {
      const v = num(g[p])
      if (v == null) return null
      total += v
    }
    return total
  },
})

const mmss = (v: number): string => {
  const m = Math.floor(v / 60)
  const s = Math.round(v % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── NBA ───────────────────────────────────────────────────────────────────────
const NBA_STATS = [
  field('points', 'PTS'),
  field('rebounds', 'REB'),
  field('assists', 'AST'),
  field('threes', '3PM'),
]
const NBA_COMBOS = [
  sum('pra', 'PRA', ['points', 'rebounds', 'assists']),
  sum('pr', 'PTS+REB', ['points', 'rebounds']),
  sum('pa', 'PTS+AST', ['points', 'assists']),
  sum('ra', 'REB+AST', ['rebounds', 'assists']),
]
const NBA: PlayerStatConfig = {
  slug: 'nba',
  windows: [5, 10, 20, 0],
  roleOf: () => 'player',
  volumeFor: () => field('minutes', 'MIN'),
  statsFor: () => NBA_STATS,
  combosFor: () => NBA_COMBOS,
}

// ── MLB ───────────────────────────────────────────────────────────────────────
const MLB_BATTER = [
  field('hits', 'H'),
  field('totalBases', 'TB'),
  field('rbi', 'RBI'),
  field('runs', 'R'),
  field('homeRuns', 'HR'),
  field('strikeouts', 'K'),
]
const MLB_PITCHER = [
  field('strikeoutsPitched', 'K'),
  field('earnedRuns', 'ER'),
  field('hitsAllowed', 'H'),
  field('walksAllowed', 'BB'),
]
const MLB: PlayerStatConfig = {
  slug: 'mlb',
  windows: [5, 10, 20, 0],
  roleOf: (p) => (/^(p|sp|rp|lhp|rhp)$/i.test((p.position || '').trim()) ? 'pitcher' : 'batter'),
  volumeFor: (role) =>
    role === 'pitcher' ? field('outsPitched', 'OUTS') : field('plateAppearances', 'PA'),
  statsFor: (role) => (role === 'pitcher' ? MLB_PITCHER : MLB_BATTER),
  combosFor: (role) =>
    role === 'pitcher' ? [] : [sum('hrr', 'H+R+RBI', ['hits', 'runs', 'rbi'])],
}

// ── NHL ───────────────────────────────────────────────────────────────────────
const NHL_SKATER = [
  field('goals', 'G'),
  field('assists', 'A'),
  field('points', 'PTS'),
  field('shotsOnGoal', 'SOG'),
  field('blocks', 'BLK'),
  field('hits', 'HITS'),
]
const NHL_GOALIE = [
  field('saves', 'SV'),
  field('shotsAgainst', 'SA'),
  field('goalsAgainst', 'GA'),
  field('savePct', 'SV%', { decimals: 3 }),
]
const NHL: PlayerStatConfig = {
  slug: 'nhl',
  windows: [5, 10, 20, 0],
  // position_type on the stat row is authoritative; the roster position is a
  // fallback for players with no games in the current filter.
  roleOf: (p, sample) => {
    const t = sample?.positionType
    if (t === 'goalie' || t === 'skater') return t
    return (p.position || '').trim().toUpperCase() === 'G' ? 'goalie' : 'skater'
  },
  volumeFor: (role) =>
    role === 'goalie'
      ? field('goalieToiSeconds', 'TOI', { format: mmss })
      : field('toiSeconds', 'TOI', { format: mmss }),
  statsFor: (role) => (role === 'goalie' ? NHL_GOALIE : NHL_SKATER),
  combosFor: (role) => (role === 'goalie' ? [] : [sum('ga', 'G+A', ['goals', 'assists'])]),
}

// ── NFL ───────────────────────────────────────────────────────────────────────
const NFL_QB = [
  field('passingYards', 'PASS YDS'),
  field('passingTds', 'PASS TD'),
  field('completions', 'CMP'),
  field('interceptions', 'INT'),
  field('rushingYards', 'RUSH YDS'),
]
const NFL_RB = [
  field('rushingYards', 'RUSH YDS'),
  field('rushingTds', 'RUSH TD'),
  field('receptions', 'REC'),
  field('receivingYards', 'REC YDS'),
]
const NFL_RECEIVER = [
  field('receptions', 'REC'),
  field('receivingYards', 'REC YDS'),
  field('receivingTds', 'REC TD'),
  field('targets', 'TGT'),
]
const NFL_DEFENSE = [
  field('tacklesTotal', 'TKL'),
  field('sacks', 'SACK'),
]
const NFL_KICKER = [field('fgMade', 'FGM'), field('fgAtt', 'FGA')]

const NFL_ROLE_BY_POSITION: Record<string, string> = {
  QB: 'qb',
  RB: 'rb', FB: 'rb',
  WR: 'receiver', TE: 'receiver',
  PK: 'kicker', K: 'kicker',
}

const NFL: PlayerStatConfig = {
  slug: 'nfl',
  // A 17-game regular season — a 20-game window would exceed it.
  windows: [3, 6, 17, 0],
  roleOf: (p) => NFL_ROLE_BY_POSITION[(p.position || '').trim().toUpperCase()] ?? 'defense',
  volumeFor: (role) => {
    if (role === 'qb') return field('attempts', 'ATT')
    if (role === 'rb') return field('carries', 'CAR')
    if (role === 'receiver') return field('targets', 'TGT')
    return null
  },
  statsFor: (role) => {
    if (role === 'qb') return NFL_QB
    if (role === 'rb') return NFL_RB
    if (role === 'receiver') return NFL_RECEIVER
    if (role === 'kicker') return NFL_KICKER
    return NFL_DEFENSE
  },
  combosFor: (role) =>
    role === 'rb' || role === 'receiver'
      ? [sum('scrimmageYards', 'SCRIM YDS', ['receivingYards', 'rushingYards'])]
      : [],
}

const CONFIGS: Record<LeagueSlug, PlayerStatConfig> = { nba: NBA, mlb: MLB, nhl: NHL, nfl: NFL }

export function getPlayerStatConfig(slug: LeagueSlug): PlayerStatConfig {
  return CONFIGS[slug] ?? NBA
}

/** Single stats followed by derived combos, the order shown in the stat picker. */
export function allStatsFor(cfg: PlayerStatConfig, role: string): StatDef[] {
  return [...cfg.statsFor(role), ...cfg.combosFor(role)]
}

export function formatVolume(def: StatDef | null, v: number | null): string {
  if (def == null || v == null) return '—'
  return def.format ? def.format(v) : String(v)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/config/playerStats.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/config/playerStats.ts client/src/config/playerStats.test.ts client/src/ember/player/types.ts
git commit -m "feat(client): role-based player stat registry

Stats resolve from a player's role rather than their league, so NFL
quarterbacks and receivers, and NHL skaters and goalies, get disjoint
stat sets from one config."
```

---

### Task 5: Derivation module

**Files:**
- Create: `client/src/ember/player/derive.ts`
- Test: `client/src/ember/player/derive.test.ts`

**Interfaces:**
- Consumes: `StatDef`, `PlayerStatConfig` from Task 4; `GameRow`, `PlayerFilters`, `DefenseSplit`, `UpcomingGame` from `types.ts`.
- Produces:

```ts
export function filterGames(games: GameRow[], filters: PlayerFilters): GameRow[]
export function averageOf(games: GameRow[], def: StatDef): number | null
export function defaultLine(games: GameRow[], def: StatDef): number
export function hitRate(games: GameRow[], def: StatDef, line: number): HitRate
export function opponentsOf(games: GameRow[]): string[]
export function splitsFor(all: GameRow[], vs: GameRow[], defs: StatDef[]): Split[]
export function gamesVersus(games: GameRow[], team: string): GameRow[]
export function matchupSignal(d: DefenseSplit | null, teamCount: number): Signal | null
export function resolveMatchupOpponent(u: UpcomingGame | null, vsTeam: string | null): MatchupTarget | null

export interface HitRate { over: number; under: number; push: number; total: number; pct: number | null }
export interface Split { key: string; label: string; season: number | null; versus: number | null; delta: number | null }
export interface Signal { rank: number; allowed: number; positionGroup: string | null; bucket: 'GREAT'|'GOOD'|'NEUTRAL'|'TOUGH'|'BRUTAL'; asOf: string }
export interface MatchupTarget { team: string; source: 'schedule' | 'filter'; upcoming: UpcomingGame | null }
```

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  filterGames, averageOf, defaultLine, hitRate, opponentsOf,
  splitsFor, gamesVersus, matchupSignal, resolveMatchupOpponent,
} from './derive'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { GameRow, PlayerFilters } from './types'

const pts = getPlayerStatConfig('nba').statsFor('player')[0]

// Most recent first, matching the API's ordering.
const GAMES: GameRow[] = [
  { date: '2026-04-10', opponent: 'BOS', isHome: true,  points: 30, rebounds: 5, assists: 4, minutes: 36 },
  { date: '2026-04-08', opponent: 'LAL', isHome: false, points: 20, rebounds: 7, assists: 6, minutes: 33 },
  { date: '2026-04-06', opponent: 'BOS', isHome: false, points: 25, rebounds: 4, assists: 5, minutes: 31 },
  { date: '2026-04-04', opponent: 'MIA', isHome: true,  points: 10, rebounds: 9, assists: 2, minutes: 22 },
  { date: '2026-04-02', opponent: 'BOS', isHome: true,  points: 40, rebounds: 3, assists: 8, minutes: 38 },
]

const base: PlayerFilters = {
  window: 0, vsTeam: null, homeAway: 'all', stat: 'points', line: 25, lineTouched: false,
}

describe('filterGames', () => {
  it('returns everything when the window is 0', () => {
    expect(filterGames(GAMES, base)).toHaveLength(5)
  })

  it('slices the most recent N for a window', () => {
    const out = filterGames(GAMES, { ...base, window: 3 })
    expect(out.map((g) => g.date)).toEqual(['2026-04-10', '2026-04-08', '2026-04-06'])
  })

  it('returns the whole log when the window exceeds it', () => {
    expect(filterGames(GAMES, { ...base, window: 50 })).toHaveLength(5)
  })

  it('filters by opponent', () => {
    expect(filterGames(GAMES, { ...base, vsTeam: 'BOS' })).toHaveLength(3)
  })

  it('applies the window before the opponent filter', () => {
    // Last 3 games contain two BOS games, not all three.
    const out = filterGames(GAMES, { ...base, window: 3, vsTeam: 'BOS' })
    expect(out).toHaveLength(2)
  })

  it('filters by home and away', () => {
    expect(filterGames(GAMES, { ...base, homeAway: 'home' })).toHaveLength(3)
    expect(filterGames(GAMES, { ...base, homeAway: 'away' })).toHaveLength(2)
  })

  it('combines opponent and venue filters', () => {
    const out = filterGames(GAMES, { ...base, vsTeam: 'BOS', homeAway: 'away' })
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-04-06')
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterGames(GAMES, { ...base, vsTeam: 'NYK' })).toEqual([])
  })
})

describe('averageOf', () => {
  it('averages the stat across games', () => {
    expect(averageOf(GAMES, pts)).toBe(25)
  })

  it('ignores games missing the stat', () => {
    expect(averageOf([{ points: 10 }, { points: null }], pts)).toBe(10)
  })

  it('returns null with no usable games', () => {
    expect(averageOf([], pts)).toBeNull()
    expect(averageOf([{ points: null }], pts)).toBeNull()
  })
})

describe('defaultLine', () => {
  it('rounds the average to the nearest half', () => {
    expect(defaultLine([{ points: 20 }, { points: 21 }], pts)).toBe(20.5)
    expect(defaultLine([{ points: 20 }, { points: 20 }, { points: 21 }], pts)).toBe(20.5)
  })

  it('returns 0 when there is no data', () => {
    expect(defaultLine([], pts)).toBe(0)
  })
})

describe('hitRate', () => {
  it('counts over, under, and push as three outcomes', () => {
    const r = hitRate(GAMES, pts, 25)
    expect(r).toMatchObject({ over: 2, under: 2, push: 1, total: 5 })
  })

  it('does not fold pushes into overs', () => {
    expect(hitRate([{ points: 25 }], pts, 25)).toMatchObject({ over: 0, push: 1 })
  })

  it('computes percentage over non-push games only', () => {
    // 2 over, 2 under, 1 push → 2/4 = 50%
    expect(hitRate(GAMES, pts, 25).pct).toBe(50)
  })

  it('returns a null percentage when every game pushed', () => {
    expect(hitRate([{ points: 25 }], pts, 25).pct).toBeNull()
  })

  it('handles an empty set', () => {
    expect(hitRate([], pts, 25)).toEqual({ over: 0, under: 0, push: 0, total: 0, pct: null })
  })
})

describe('opponentsOf', () => {
  it('lists unique opponents alphabetically', () => {
    expect(opponentsOf(GAMES)).toEqual(['BOS', 'LAL', 'MIA'])
  })

  it('ignores rows with no opponent', () => {
    expect(opponentsOf([{ opponent: null }, { opponent: 'BOS' }])).toEqual(['BOS'])
  })
})

describe('gamesVersus', () => {
  it('selects only games against the team', () => {
    expect(gamesVersus(GAMES, 'BOS')).toHaveLength(3)
  })
})

describe('splitsFor', () => {
  const defs = getPlayerStatConfig('nba').statsFor('player').slice(0, 2)

  it('reports season and versus averages side by side with a delta', () => {
    const out = splitsFor(GAMES, gamesVersus(GAMES, 'BOS'), defs)
    const p = out.find((s) => s.key === 'points')!
    expect(p.season).toBe(25)
    expect(p.versus).toBeCloseTo(31.67, 1)
    expect(p.delta).toBeCloseTo(6.67, 1)
  })

  it('returns a null versus and delta when there are no meetings', () => {
    const out = splitsFor(GAMES, [], defs)
    expect(out[0].versus).toBeNull()
    expect(out[0].delta).toBeNull()
    expect(out[0].season).not.toBeNull()
  })
})

describe('matchupSignal', () => {
  const split = { allowedPerGame: 26.4, leagueRank: 28, positionGroup: 'G', stat: 'pts', asOf: '2026-06-15' }

  it('grades a high rank as a good matchup for the player', () => {
    // Rank 28 of 30 in points allowed = a soft defense.
    expect(matchupSignal(split, 30)?.bucket).toBe('GREAT')
  })

  it('grades a low rank as a tough matchup', () => {
    expect(matchupSignal({ ...split, leagueRank: 2 }, 30)?.bucket).toBe('BRUTAL')
  })

  it('grades the middle of the league as neutral', () => {
    expect(matchupSignal({ ...split, leagueRank: 15 }, 30)?.bucket).toBe('NEUTRAL')
  })

  it('carries the underlying number through for display', () => {
    const s = matchupSignal(split, 30)!
    expect(s.allowed).toBe(26.4)
    expect(s.rank).toBe(28)
    expect(s.asOf).toBe('2026-06-15')
  })

  it('returns null with no defense data', () => {
    expect(matchupSignal(null, 30)).toBeNull()
  })

  it('returns null when the rank is missing', () => {
    expect(matchupSignal({ ...split, leagueRank: null }, 30)).toBeNull()
  })
})

describe('resolveMatchupOpponent', () => {
  const upcoming = {
    gameId: 1, date: '2026-08-02', opponent: 'BOS',
    opponentTeamId: 5, isHome: true, daysRest: 2,
  }

  it('prefers the scheduled opponent', () => {
    expect(resolveMatchupOpponent(upcoming, null)).toEqual({
      team: 'BOS', source: 'schedule', upcoming,
    })
  })

  it('falls back to the filter selection out of season', () => {
    expect(resolveMatchupOpponent(null, 'MIA')).toEqual({
      team: 'MIA', source: 'filter', upcoming: null,
    })
  })

  it('lets an explicit filter override the schedule', () => {
    const out = resolveMatchupOpponent(upcoming, 'MIA')
    expect(out).toEqual({ team: 'MIA', source: 'filter', upcoming: null })
  })

  it('returns null when there is neither', () => {
    expect(resolveMatchupOpponent(null, null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/derive.test.ts`
Expected: FAIL — module `./derive` does not exist.

- [ ] **Step 3: Write the derivation module**

Create `client/src/ember/player/derive.ts`:

```ts
import type { StatDef } from '@/config/playerStats'
import type { DefenseSplit, GameRow, PlayerFilters, UpcomingGame } from './types'

export interface HitRate {
  over: number
  under: number
  push: number
  total: number
  /** Share of decided (non-push) games that went over. Null if none decided. */
  pct: number | null
}

export interface Split {
  key: string
  label: string
  season: number | null
  versus: number | null
  delta: number | null
}

export type SignalBucket = 'GREAT' | 'GOOD' | 'NEUTRAL' | 'TOUGH' | 'BRUTAL'

export interface Signal {
  rank: number
  allowed: number
  positionGroup: string | null
  bucket: SignalBucket
  asOf: string
}

export interface MatchupTarget {
  team: string
  source: 'schedule' | 'filter'
  /** Only populated when the target came from the schedule. */
  upcoming: UpcomingGame | null
}

/**
 * Window first, then opponent and venue. Order matters: "last 10 vs BOS" means
 * BOS games within the last 10 played, not the last 10 BOS games.
 */
export function filterGames(games: GameRow[], filters: PlayerFilters): GameRow[] {
  const windowed = filters.window > 0 ? games.slice(0, filters.window) : games
  return windowed.filter((g) => {
    if (filters.vsTeam && g.opponent !== filters.vsTeam) return false
    if (filters.homeAway === 'home' && g.isHome !== true) return false
    if (filters.homeAway === 'away' && g.isHome !== false) return false
    return true
  })
}

export function averageOf(games: GameRow[], def: StatDef): number | null {
  let total = 0
  let n = 0
  for (const g of games) {
    const v = def.get(g)
    if (v == null) continue
    total += v
    n += 1
  }
  return n === 0 ? null : total / n
}

/** The filtered average, rounded to the nearest half — a natural prop line. */
export function defaultLine(games: GameRow[], def: StatDef): number {
  const avg = averageOf(games, def)
  return avg == null ? 0 : Math.round(avg * 2) / 2
}

export function hitRate(games: GameRow[], def: StatDef, line: number): HitRate {
  let over = 0
  let under = 0
  let push = 0
  for (const g of games) {
    const v = def.get(g)
    if (v == null) continue
    if (v > line) over += 1
    else if (v < line) under += 1
    else push += 1
  }
  const decided = over + under
  return {
    over,
    under,
    push,
    total: over + under + push,
    pct: decided === 0 ? null : Math.round((over / decided) * 100),
  }
}

export function opponentsOf(games: GameRow[]): string[] {
  const seen = new Set<string>()
  for (const g of games) {
    if (typeof g.opponent === 'string' && g.opponent) seen.add(g.opponent)
  }
  return [...seen].sort()
}

export function gamesVersus(games: GameRow[], team: string): GameRow[] {
  return games.filter((g) => g.opponent === team)
}

/**
 * Season average and versus-opponent average as separate figures. They are never
 * blended — the point is to compare them.
 */
export function splitsFor(all: GameRow[], vs: GameRow[], defs: StatDef[]): Split[] {
  return defs.map((d) => {
    const season = averageOf(all, d)
    const versus = averageOf(vs, d)
    return {
      key: d.key,
      label: d.label,
      season,
      versus,
      delta: season == null || versus == null ? null : versus - season,
    }
  })
}

/**
 * Translate an opponent's defensive rank into a favorability bucket. A HIGH rank
 * in "allowed per game" means the defense gives up a lot, which is GOOD for the
 * player. Buckets split the league into fifths.
 */
export function matchupSignal(d: DefenseSplit | null, teamCount: number): Signal | null {
  if (!d || d.leagueRank == null) return null
  const pct = d.leagueRank / teamCount
  const bucket: SignalBucket =
    pct > 0.8 ? 'GREAT' : pct > 0.6 ? 'GOOD' : pct > 0.4 ? 'NEUTRAL' : pct > 0.2 ? 'TOUGH' : 'BRUTAL'
  return {
    rank: d.leagueRank,
    allowed: d.allowedPerGame,
    positionGroup: d.positionGroup,
    bucket,
    asOf: d.asOf,
  }
}

/**
 * Which opponent the matchup section describes. An explicit filter selection
 * wins over the schedule, because the user asking about MIA should see MIA even
 * if the next game is BOS. Most leagues are out of season most of the year, so
 * the filter path is the common one.
 */
export function resolveMatchupOpponent(
  upcoming: UpcomingGame | null,
  vsTeam: string | null
): MatchupTarget | null {
  if (vsTeam) return { team: vsTeam, source: 'filter', upcoming: null }
  if (upcoming) return { team: upcoming.opponent, source: 'schedule', upcoming }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/derive.test.ts`
Expected: PASS, 30 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/ember/player/derive.ts client/src/ember/player/derive.test.ts
git commit -m "feat(client): pure derivation for player view filters

Windowing, opponent and venue filters, hit rate with pushes as a
distinct outcome, season-vs-opponent splits, and matchup grading.
No React, no league-specific stat names."
```

---

### Task 6: API client methods and data hook

**Files:**
- Modify: `client/src/services/api.ts:452-505`
- Create: `client/src/ember/player/usePlayerData.ts`
- Test: `client/src/ember/player/usePlayerData.test.ts`

**Interfaces:**
- Consumes: `PlayerLogResponse`, `DefenseSplit` from `types.ts`; the server endpoints from Tasks 2 and 3.
- Produces:
  - `createLeagueApi(slug).getPlayerLog(id: number, window?: 'all' | number): Promise<PlayerLogResponse>`
  - `createLeagueApi(slug).getTeamDefense(teamId: number, stat: string, position?: string | null): Promise<DefenseSplit | null>`
  - `usePlayerData(slug, id): { data, loading, error, reload }`

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/usePlayerData.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlayerData } from './usePlayerData'

const ok = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) })

const PROFILE = {
  player: { id: 1, name: 'Test Player', team: 'OKC', position: 'G' },
  teamId: 9, games: [{ opponent: 'BOS', points: 20 }],
  seasonAvgs: { points: 20 }, gamesPlayed: 1, upcoming: null,
}

describe('usePlayerData', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('requests the full season log', async () => {
    ;(fetch as any).mockResolvedValue(ok(PROFILE))
    const { result } = renderHook(() => usePlayerData('nba', 1))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect((fetch as any).mock.calls[0][0]).toContain('/api/nba/players/1/games?window=all')
    expect(result.current.data?.player.name).toBe('Test Player')
    expect(result.current.error).toBeNull()
  })

  it('surfaces a fetch failure as an error, not a crash', async () => {
    ;(fetch as any).mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => usePlayerData('nba', 1))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network down')
    expect(result.current.data).toBeNull()
  })

  it('refetches when the player id changes', async () => {
    ;(fetch as any).mockResolvedValue(ok(PROFILE))
    const { result, rerender } = renderHook(({ id }) => usePlayerData('nba', id), {
      initialProps: { id: 1 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ id: 2 })
    await waitFor(() => expect((fetch as any).mock.calls.length).toBe(2))
    expect((fetch as any).mock.calls[1][0]).toContain('/players/2/games')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/usePlayerData.test.ts`
Expected: FAIL — module `./usePlayerData` does not exist.

- [ ] **Step 3: Add the API methods**

In `client/src/services/api.ts`, inside the object returned by `createLeagueApi`, add these two methods after `getPlayerProfile`:

```ts
    /** Full season game log plus the next scheduled game. */
    getPlayerLog: (id: number, window: 'all' | number = 'all'): Promise<PlayerLogResponse> =>
      get(`${BASE}/${slug}/players/${id}/games?window=${window}`),

    /** Opponent defensive split; null for leagues with no defense table. */
    getTeamDefense: (
      teamId: number,
      stat: string,
      position?: string | null
    ): Promise<DefenseSplit | null> => {
      const q = new URLSearchParams({ stat })
      if (position) q.set('position', position)
      return get(`${BASE}/${slug}/teams/${teamId}/defense?${q}`)
    },
```

Add the type import at the top of the file:

```ts
import type { DefenseSplit, PlayerLogResponse } from '@/ember/player/types'
```

- [ ] **Step 4: Write the hook**

Create `client/src/ember/player/usePlayerData.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { LeagueSlug } from '@/config/leagues'
import { createLeagueApi } from '@/services/api'
import type { PlayerLogResponse } from './types'

// One API client per league, created once rather than per render.
const apis = new Map<string, ReturnType<typeof createLeagueApi>>()
const apiFor = (slug: LeagueSlug) => {
  let a = apis.get(slug)
  if (!a) {
    a = createLeagueApi(slug)
    apis.set(slug, a)
  }
  return a
}

export function usePlayerData(slug: LeagueSlug, id: number) {
  const [data, setData] = useState<PlayerLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFor(slug)
      .getPlayerLog(id, 'all')
      .then((d) => {
        if (cancelled) return
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setData(null)
        setError(e.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, id, nonce])

  return { data, loading, error, reload }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/usePlayerData.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/services/api.ts client/src/ember/player/usePlayerData.ts client/src/ember/player/usePlayerData.test.ts
git commit -m "feat(client): player log and team defense API methods"
```

---

### Task 7: Filter state hook

**Files:**
- Create: `client/src/ember/player/usePlayerFilters.ts`
- Test: `client/src/ember/player/usePlayerFilters.test.ts`

**Interfaces:**
- Consumes: `PlayerFilters` from `types.ts`; `defaultLine`, `filterGames` from `derive.ts`; `StatDef` from `playerStats.ts`.
- Produces: `usePlayerFilters({ games, statDefs, initial })` returning `{ filters, setWindow, setVsTeam, setHomeAway, setStat, setLine, resetLine }`.

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/usePlayerFilters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePlayerFilters } from './usePlayerFilters'
import { getPlayerStatConfig, allStatsFor } from '@/config/playerStats'
import type { GameRow } from './types'

const statDefs = allStatsFor(getPlayerStatConfig('nba'), 'player')
const games: GameRow[] = [
  { opponent: 'BOS', isHome: true,  points: 30 },
  { opponent: 'LAL', isHome: false, points: 20 },
  { opponent: 'BOS', isHome: false, points: 10 },
]

const setup = (initial?: Partial<import('./types').PlayerFilters>) =>
  renderHook(() => usePlayerFilters({ games, statDefs, initial }))

describe('usePlayerFilters', () => {
  it('defaults the line to the average of the unfiltered log', () => {
    const { result } = setup()
    expect(result.current.filters.line).toBe(20)
    expect(result.current.filters.lineTouched).toBe(false)
  })

  it('seeds from initial filters', () => {
    const { result } = setup({ window: 10, vsTeam: 'BOS', stat: 'rebounds' })
    expect(result.current.filters.window).toBe(10)
    expect(result.current.filters.vsTeam).toBe('BOS')
    expect(result.current.filters.stat).toBe('rebounds')
  })

  it('recomputes the line when the opponent filter changes', () => {
    const { result } = setup()
    act(() => result.current.setVsTeam('BOS'))
    // BOS games are 30 and 10 → average 20 → rounds to 20
    expect(result.current.filters.line).toBe(20)
    act(() => result.current.setVsTeam('LAL'))
    expect(result.current.filters.line).toBe(20)
  })

  it('preserves a manually set line across filter changes', () => {
    const { result } = setup()
    act(() => result.current.setLine(27.5))
    expect(result.current.filters.lineTouched).toBe(true)
    act(() => result.current.setVsTeam('BOS'))
    expect(result.current.filters.line).toBe(27.5)
  })

  it('resetLine restores the computed average and clears the touched flag', () => {
    const { result } = setup()
    act(() => result.current.setLine(99))
    act(() => result.current.resetLine())
    expect(result.current.filters.line).toBe(20)
    expect(result.current.filters.lineTouched).toBe(false)
  })

  it('recomputes the line when the stat changes even if touched', () => {
    // A line of 27.5 points is meaningless once the stat becomes rebounds.
    const { result } = setup()
    act(() => result.current.setLine(27.5))
    act(() => result.current.setStat('rebounds'))
    expect(result.current.filters.lineTouched).toBe(false)
  })

  it('ignores an unknown stat key', () => {
    const { result } = setup()
    act(() => result.current.setStat('not_a_stat'))
    expect(result.current.filters.stat).toBe('points')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/usePlayerFilters.test.ts`
Expected: FAIL — module `./usePlayerFilters` does not exist.

- [ ] **Step 3: Write the hook**

Create `client/src/ember/player/usePlayerFilters.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StatDef } from '@/config/playerStats'
import { defaultLine, filterGames } from './derive'
import type { GameRow, HomeAway, PlayerFilters } from './types'

interface Args {
  games: GameRow[]
  statDefs: StatDef[]
  initial?: Partial<PlayerFilters>
}

/**
 * Filter state for the player view. The line auto-tracks the filtered average
 * until the user moves it, after which their value survives filter changes —
 * except when the stat itself changes, where the old number is meaningless.
 */
export function usePlayerFilters({ games, statDefs, initial }: Args) {
  const firstStat = statDefs[0]?.key ?? ''
  const [filters, setFilters] = useState<PlayerFilters>(() => ({
    window: initial?.window ?? 0,
    vsTeam: initial?.vsTeam ?? null,
    homeAway: initial?.homeAway ?? 'all',
    stat: statDefs.some((s) => s.key === initial?.stat) ? initial!.stat! : firstStat,
    line: initial?.line ?? 0,
    lineTouched: initial?.line != null,
  }))

  const defFor = useCallback(
    (key: string) => statDefs.find((s) => s.key === key) ?? statDefs[0],
    [statDefs]
  )

  // Recompute the untouched line whenever the slice or stat changes.
  const sig = `${filters.window}|${filters.vsTeam}|${filters.homeAway}|${filters.stat}`
  const lastSig = useRef<string | null>(null)
  useEffect(() => {
    if (lastSig.current === sig) return
    lastSig.current = sig
    setFilters((f) => {
      if (f.lineTouched) return f
      const def = defFor(f.stat)
      if (!def) return f
      return { ...f, line: defaultLine(filterGames(games, f), def) }
    })
  }, [sig, games, defFor])

  const setWindow = useCallback((window: number) => setFilters((f) => ({ ...f, window })), [])
  const setVsTeam = useCallback((vsTeam: string | null) => setFilters((f) => ({ ...f, vsTeam })), [])
  const setHomeAway = useCallback((homeAway: HomeAway) => setFilters((f) => ({ ...f, homeAway })), [])
  const setLine = useCallback(
    (line: number) => setFilters((f) => ({ ...f, line, lineTouched: true })),
    []
  )

  const setStat = useCallback(
    (stat: string) =>
      setFilters((f) => {
        if (!statDefs.some((s) => s.key === stat)) return f
        // A line carried over from another stat is meaningless.
        return { ...f, stat, lineTouched: false }
      }),
    [statDefs]
  )

  const resetLine = useCallback(
    () =>
      setFilters((f) => {
        const def = defFor(f.stat)
        return def
          ? { ...f, line: defaultLine(filterGames(games, f), def), lineTouched: false }
          : { ...f, lineTouched: false }
      }),
    [games, defFor]
  )

  return { filters, setWindow, setVsTeam, setHomeAway, setStat, setLine, resetLine }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/usePlayerFilters.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/ember/player/usePlayerFilters.ts client/src/ember/player/usePlayerFilters.test.ts
git commit -m "feat(client): player view filter state with line tracking"
```

---

### Task 8: Filter bar and line control

**Files:**
- Create: `client/src/ember/player/components/FilterBar.tsx`
- Create: `client/src/ember/player/components/LineControl.tsx`
- Test: `client/src/ember/player/components/FilterBar.test.tsx`

**Interfaces:**
- Consumes: `PlayerFilters`, `HomeAway` from `types.ts`; `StatDef` from `playerStats.ts`; `HitRate` from `derive.ts`.
- Produces: `<FilterBar filters statDefs windows opponents onWindow onVsTeam onHomeAway onStat />` and `<LineControl label line hitRate versusHitRate versusTeam touched onLine onReset />`.

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/components/FilterBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterBar from './FilterBar'
import { getPlayerStatConfig, allStatsFor } from '@/config/playerStats'
import type { PlayerFilters } from '../types'

const statDefs = allStatsFor(getPlayerStatConfig('nba'), 'player')
const filters: PlayerFilters = {
  window: 10, vsTeam: null, homeAway: 'all', stat: 'points', line: 25, lineTouched: false,
}

const setup = (over: Partial<PlayerFilters> = {}, handlers = {}) => {
  const props = {
    filters: { ...filters, ...over },
    statDefs,
    windows: [5, 10, 20, 0],
    opponents: ['BOS', 'LAL'],
    onWindow: vi.fn(), onVsTeam: vi.fn(), onHomeAway: vi.fn(), onStat: vi.fn(),
    ...handlers,
  }
  render(<FilterBar {...props} />)
  return props
}

describe('FilterBar', () => {
  it('renders a button per window with ALL for 0', () => {
    setup()
    expect(screen.getByRole('button', { name: 'L5' })).toBeInTheDocument()
    // Window "ALL" and venue "ANY" must not share a label, or these queries
    // become ambiguous and throw.
    expect(screen.getByRole('button', { name: 'ALL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ANY' })).toBeInTheDocument()
  })

  it('marks the active window as pressed', () => {
    setup()
    expect(screen.getByRole('button', { name: 'L10' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'L5' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports a window change', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'L5' }))
    expect(p.onWindow).toHaveBeenCalledWith(5)
  })

  it('lists every opponent plus an all-teams option', () => {
    setup()
    const select = screen.getByLabelText('Opponent') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['', 'BOS', 'LAL'])
  })

  it('reports an opponent change as null for all teams', () => {
    const p = setup({ vsTeam: 'BOS' })
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: '' } })
    expect(p.onVsTeam).toHaveBeenCalledWith(null)
  })

  it('reports a stat change', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'REB' }))
    expect(p.onStat).toHaveBeenCalledWith('rebounds')
  })

  it('shows a removable chip for each active filter', () => {
    setup({ vsTeam: 'BOS', homeAway: 'away' })
    // Chips are queried by their aria-label. Their visible text ("AWAY")
    // collides with the venue buttons, so the label is what disambiguates.
    expect(screen.getByRole('button', { name: 'Clear VS BOS filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear AWAY filter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear LAST 10 filter' })).toBeInTheDocument()
  })

  it('clears a filter when its chip is clicked', () => {
    const p = setup({ vsTeam: 'BOS' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear VS BOS filter' }))
    expect(p.onVsTeam).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/components/FilterBar.test.tsx`
Expected: FAIL — module `./FilterBar` does not exist.

- [ ] **Step 3: Write FilterBar**

Create `client/src/ember/player/components/FilterBar.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { StatDef } from '@/config/playerStats'
import type { HomeAway, PlayerFilters } from '../types'

interface FilterBarProps {
  filters: PlayerFilters
  statDefs: StatDef[]
  windows: number[]
  opponents: string[]
  onWindow: (w: number) => void
  onVsTeam: (t: string | null) => void
  onHomeAway: (h: HomeAway) => void
  onStat: (s: string) => void
}

const windowLabel = (w: number) => (w === 0 ? 'ALL' : `L${w}`)

const BTN =
  'font-martian font-medium text-[9px] px-[11px] py-[6px] cursor-pointer whitespace-nowrap transition-colors'
const ON = 'bg-[#EFE9E0] text-[#14100F]'
const OFF = 'bg-transparent text-[#9A918F] hover:text-[#EFEBE9]'

function Group({ children }: { children: ReactNode }) {
  return <div className="flex border border-[#2C2624] rounded-md overflow-hidden">{children}</div>
}

function Label({ children }: { children: string }) {
  return (
    <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] self-center">
      {children}
    </span>
  )
}

/**
 * A removable summary of one active filter. The aria-label disambiguates it
 * from the filter buttons above, which share its visible text.
 */
function Chip({ text, onClear }: { text: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Clear ${text} filter`}
      onClick={onClear}
      className="font-martian font-medium text-[9px] tracking-[0.5px] px-[10px] py-[4px] rounded-xl border border-[rgba(255,107,61,0.5)] bg-[rgba(255,107,61,0.08)] text-[#FF6B3D] hover:bg-[rgba(255,107,61,0.16)] cursor-pointer"
    >
      {text} ✕
    </button>
  )
}

export default function FilterBar({
  filters, statDefs, windows, opponents, onWindow, onVsTeam, onHomeAway, onStat,
}: FilterBarProps) {
  // "ANY" rather than "ALL" so it never collides with the window group's ALL.
  const venues: [string, HomeAway][] = [['ANY', 'all'], ['HOME', 'home'], ['AWAY', 'away']]

  return (
    <div className="flex flex-col gap-[10px] px-[18px] py-[13px] border-b border-[#27221F]">
      <div className="flex items-center gap-3 flex-wrap">
        <Label>WINDOW</Label>
        <Group>
          {windows.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={filters.window === w}
              onClick={() => onWindow(w)}
              className={`${BTN} ${filters.window === w ? ON : OFF}`}
            >
              {windowLabel(w)}
            </button>
          ))}
        </Group>

        <Label>VS</Label>
        <select
          aria-label="Opponent"
          value={filters.vsTeam ?? ''}
          onChange={(e) => onVsTeam(e.target.value || null)}
          className="font-martian text-[9px] bg-[#221D1A] text-[#EFEBE9] border border-[#2C2624] rounded-md px-[10px] py-[6px] cursor-pointer"
        >
          <option value="">ALL TEAMS</option>
          {opponents.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>

        <Label>VENUE</Label>
        <Group>
          {venues.map(([label, v]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filters.homeAway === v}
              onClick={() => onHomeAway(v)}
              className={`${BTN} ${filters.homeAway === v ? ON : OFF}`}
            >
              {label}
            </button>
          ))}
        </Group>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Label>STAT</Label>
        <Group>
          {statDefs.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={filters.stat === s.key}
              onClick={() => onStat(s.key)}
              className={`${BTN} ${filters.stat === s.key ? ON : OFF}`}
            >
              {s.label}
            </button>
          ))}
        </Group>
      </div>

      {(filters.vsTeam || filters.homeAway !== 'all' || filters.window !== 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          <Label>ACTIVE</Label>
          {filters.window !== 0 && (
            <Chip text={`LAST ${filters.window}`} onClear={() => onWindow(0)} />
          )}
          {filters.vsTeam && <Chip text={`VS ${filters.vsTeam}`} onClear={() => onVsTeam(null)} />}
          {filters.homeAway !== 'all' && (
            <Chip text={filters.homeAway.toUpperCase()} onClear={() => onHomeAway('all')} />
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write LineControl**

Create `client/src/ember/player/components/LineControl.tsx`:

```tsx
import type { HitRate } from '../derive'

interface LineControlProps {
  label: string
  line: number
  hitRate: HitRate
  versusHitRate: HitRate | null
  versusTeam: string | null
  touched: boolean
  onLine: (v: number) => void
  onReset: () => void
}

function Rate({ caption, r }: { caption: string; r: HitRate }) {
  const tone = r.pct == null ? 'text-[#9A918F]' : r.pct >= 50 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'
  return (
    <div>
      <div className="font-martian text-[7px] text-[#665F5D] tracking-[1px]">{caption}</div>
      <div className={`font-martian font-bold text-[15px] mt-[3px] ${tone}`}>
        {r.over}/{r.over + r.under} OVER
        {r.pct != null && <span className="text-[11px] ml-[6px]">{r.pct}%</span>}
      </div>
      {r.push > 0 && (
        <div className="font-martian text-[7px] text-[#9A918F] mt-[2px] tracking-[0.5px]">
          {r.push} PUSH{r.push > 1 ? 'ES' : ''} EXCLUDED
        </div>
      )}
    </div>
  )
}

export default function LineControl({
  label, line, hitRate, versusHitRate, versusTeam, touched, onLine, onReset,
}: LineControlProps) {
  const step = (d: number) => onLine(Math.max(0, Math.round((line + d) * 2) / 2))

  return (
    <div className="flex items-end gap-[18px] flex-wrap px-[18px] py-[14px] border-b border-[#27221F]">
      <div>
        <div className="font-martian text-[7px] text-[#665F5D] tracking-[1px]">
          {label} LINE {touched ? '· MANUAL' : '· AVG'}
        </div>
        <div className="flex items-center gap-2 mt-[5px]">
          <button
            type="button"
            aria-label="Lower line"
            onClick={() => step(-0.5)}
            className="font-martian font-bold text-[12px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md w-[26px] h-[26px] cursor-pointer"
          >
            −
          </button>
          <input
            aria-label="Line value"
            type="number"
            step={0.5}
            min={0}
            value={line}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) onLine(v)
            }}
            className="font-martian font-bold text-[20px] text-[#EFEBE9] bg-[#221D1A] border border-[#2E2724] rounded-md w-[84px] px-[9px] py-[3px] text-center"
          />
          <button
            type="button"
            aria-label="Raise line"
            onClick={() => step(0.5)}
            className="font-martian font-bold text-[12px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md w-[26px] h-[26px] cursor-pointer"
          >
            +
          </button>
          {touched && (
            <button
              type="button"
              onClick={onReset}
              className="font-martian text-[8px] text-[#9A918F] hover:text-[#FF6B3D] tracking-[0.5px] underline cursor-pointer ml-1"
            >
              RESET TO AVG
            </button>
          )}
        </div>
      </div>

      <Rate caption="FILTERED SLICE" r={hitRate} />
      {versusHitRate && versusTeam && (
        <Rate caption={`VS ${versusTeam.toUpperCase()}`} r={versusHitRate} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/components/FilterBar.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/ember/player/components/FilterBar.tsx client/src/ember/player/components/LineControl.tsx client/src/ember/player/components/FilterBar.test.tsx
git commit -m "feat(client): player view filter bar and line control

Every active filter renders as a removable chip so the current slice is
never implicit. Pushes are reported separately from over/under."
```

---

### Task 9: Chart, stat cards, and game log table

**Files:**
- Create: `client/src/ember/player/components/GameLogChart.tsx`
- Create: `client/src/ember/player/components/StatLineCards.tsx`
- Create: `client/src/ember/player/components/GameLogTable.tsx`
- Test: `client/src/ember/player/components/GameLogChart.test.tsx`

**Interfaces:**
- Consumes: `StatDef` from `playerStats.ts`; `GameRow` from `types.ts`; `averageOf` from `derive.ts`.
- Produces: `<GameLogChart games def line />`, `<StatLineCards games statDefs volumeDef activeStat />`, `<GameLogTable games statDefs volumeDef activeStat />`.

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/components/GameLogChart.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GameLogChart from './GameLogChart'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { GameRow } from '../types'

const def = getPlayerStatConfig('nba').statsFor('player')[0]
const games: GameRow[] = [
  { date: '2026-04-10', opponent: 'BOS', points: 30 },
  { date: '2026-04-08', opponent: 'LAL', points: 20 },
  { date: '2026-04-06', opponent: 'MIA', points: 10 },
]

describe('GameLogChart', () => {
  it('renders one bar per game, oldest first', () => {
    render(<GameLogChart games={games} def={def} line={25} />)
    const bars = screen.getAllByTestId('chart-bar')
    expect(bars).toHaveLength(3)
    // Chronological left-to-right: the API sends newest first, so it reverses.
    expect(bars[0]).toHaveAttribute('data-value', '10')
    expect(bars[2]).toHaveAttribute('data-value', '30')
  })

  it('marks each bar as a clear, miss, or push against the line', () => {
    render(<GameLogChart games={games} def={def} line={20} />)
    const bars = screen.getAllByTestId('chart-bar')
    expect(bars[0]).toHaveAttribute('data-result', 'under')
    expect(bars[1]).toHaveAttribute('data-result', 'push')
    expect(bars[2]).toHaveAttribute('data-result', 'over')
  })

  it('labels the threshold with its value', () => {
    render(<GameLogChart games={games} def={def} line={25} />)
    expect(screen.getByText(/LINE 25/)).toBeInTheDocument()
  })

  it('renders an empty state rather than an empty chart', () => {
    render(<GameLogChart games={[]} def={def} line={25} />)
    expect(screen.getByText(/NO GAMES MATCH/)).toBeInTheDocument()
    expect(screen.queryAllByTestId('chart-bar')).toHaveLength(0)
  })

  it('skips games with no value for the stat', () => {
    render(<GameLogChart games={[{ points: null }, { points: 12 }]} def={def} line={10} />)
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/components/GameLogChart.test.tsx`
Expected: FAIL — module `./GameLogChart` does not exist.

- [ ] **Step 3: Write GameLogChart**

Create `client/src/ember/player/components/GameLogChart.tsx`:

```tsx
import type { StatDef } from '@/config/playerStats'
import type { GameRow } from '../types'

interface GameLogChartProps {
  games: GameRow[]
  def: StatDef
  line: number
}

const H = 120

export default function GameLogChart({ games, def, line }: GameLogChartProps) {
  // The API returns newest first; a chart reads left-to-right chronologically.
  const points = games
    .map((g) => ({ v: def.get(g), opp: typeof g.opponent === 'string' ? g.opponent : '' }))
    .filter((p): p is { v: number; opp: string } => p.v != null)
    .reverse()

  if (points.length === 0) {
    return (
      <div className="px-[18px] py-9 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
        NO GAMES MATCH THESE FILTERS
      </div>
    )
  }

  const max = Math.max(...points.map((p) => p.v), line, 1)
  const linePct = (line / max) * 100

  return (
    <div className="relative px-[18px] pt-[18px] pb-3">
      <div
        className="absolute left-[18px] right-[18px] z-[1] pointer-events-none"
        style={{ borderTop: '1px dashed rgba(255,107,61,0.75)', bottom: `${28 + (linePct / 100) * H}px` }}
      >
        <span className="absolute right-0 top-[-14px] font-martian font-medium text-[7px] text-[#FF6B3D] tracking-[0.5px] bg-[#1B1715] px-[3px]">
          LINE {line}
        </span>
      </div>

      <div className="flex items-end gap-[6px]" style={{ height: `${H + 28}px` }}>
        {points.map((p, i) => {
          const result = p.v > line ? 'over' : p.v < line ? 'under' : 'push'
          const color =
            result === 'over' ? '#3FBF7F' : result === 'under' ? '#4A403C' : '#9A918F'
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
              <span className="font-martian font-medium text-[8px] text-[#9A918F]">
                {def.format ? def.format(p.v) : p.v}
              </span>
              <div
                data-testid="chart-bar"
                data-value={p.v}
                data-result={result}
                title={`${p.opp || '—'}: ${p.v}`}
                className="w-full max-w-[30px] rounded-t-[3px]"
                style={{ height: `${Math.max(3, (p.v / max) * H)}px`, background: color }}
              />
              <span className="font-martian text-[7px] text-[#665F5D] overflow-hidden max-w-full whitespace-nowrap">
                {p.opp}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write StatLineCards**

Create `client/src/ember/player/components/StatLineCards.tsx`:

```tsx
import { formatVolume, type StatDef } from '@/config/playerStats'
import { averageOf } from '../derive'
import type { GameRow } from '../types'

interface StatLineCardsProps {
  games: GameRow[]
  statDefs: StatDef[]
  volumeDef: StatDef | null
  activeStat: string
}

function Card({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div
      className={`border rounded-lg pt-3 px-[13px] pb-[11px] ${
        active ? 'bg-[#EFE9E0] border-[#EFE9E0]' : 'bg-[#221D1A] border-[#2E2724]'
      }`}
    >
      <div className={`font-martian text-[8px] tracking-[1px] ${active ? 'text-[#504A44]' : 'text-[#665F5D]'}`}>
        {label}
      </div>
      <div className={`font-martian font-bold text-[20px] mt-[5px] ${active ? 'text-[#14100F]' : 'text-[#EFEBE9]'}`}>
        {value}
      </div>
    </div>
  )
}

export default function StatLineCards({ games, statDefs, volumeDef, activeStat }: StatLineCardsProps) {
  const fmt = (d: StatDef) => {
    const avg = averageOf(games, d)
    if (avg == null) return '—'
    return d.format ? d.format(avg) : avg.toFixed(d.decimals ?? 1)
  }

  return (
    <div className="grid [grid-template-columns:repeat(auto-fit,minmax(96px,1fr))] gap-2 px-[18px] pt-[14px] pb-4">
      {volumeDef && (
        <Card label={volumeDef.label} value={formatVolume(volumeDef, averageOf(games, volumeDef))} active={false} />
      )}
      {statDefs.map((d) => (
        <Card key={d.key} label={d.label} value={fmt(d)} active={d.key === activeStat} />
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Write GameLogTable**

Create `client/src/ember/player/components/GameLogTable.tsx`:

```tsx
import { formatVolume, type StatDef } from '@/config/playerStats'
import type { GameRow } from '../types'

interface GameLogTableProps {
  games: GameRow[]
  statDefs: StatDef[]
  volumeDef: StatDef | null
  activeStat: string
}

const cell = 'font-martian text-[10px] px-2 py-[7px] whitespace-nowrap'
const head = 'font-martian text-[8px] text-[#665F5D] tracking-[1px] px-2 py-[7px] whitespace-nowrap'

export default function GameLogTable({ games, statDefs, volumeDef, activeStat }: GameLogTableProps) {
  if (games.length === 0) {
    return (
      <div className="px-[18px] py-8 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
        NO GAMES MATCH THESE FILTERS
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#27221F]">
            <th className={`${head} text-left`}>DATE</th>
            <th className={`${head} text-left`}>OPP</th>
            {volumeDef && <th className={`${head} text-right`}>{volumeDef.label}</th>}
            {statDefs.map((d) => (
              <th
                key={d.key}
                className={`${head} text-right ${d.key === activeStat ? 'text-[#FF6B3D]' : ''}`}
              >
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((g, i) => (
            <tr key={i} className="border-t border-[#221D1A] hover:bg-[#211C1A]">
              <td className={`${cell} text-[#665F5D]`}>{String(g.date ?? '')}</td>
              <td className="font-schibsted font-bold text-[11px] text-[#EFEBE9] px-2 py-[7px]">
                {g.isHome === false ? '@' : ''}
                {String(g.opponent ?? '—')}
              </td>
              {volumeDef && (
                <td className={`${cell} text-right text-[#9A918F]`}>
                  {formatVolume(volumeDef, volumeDef.get(g))}
                </td>
              )}
              {statDefs.map((d) => {
                const v = d.get(g)
                return (
                  <td
                    key={d.key}
                    className={`${cell} font-bold text-right ${
                      d.key === activeStat ? 'text-[#FF6B3D]' : 'text-[#EFEBE9]'
                    }`}
                  >
                    {v == null ? '—' : d.format ? d.format(v) : v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/components/GameLogChart.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add client/src/ember/player/components/GameLogChart.tsx client/src/ember/player/components/StatLineCards.tsx client/src/ember/player/components/GameLogTable.tsx client/src/ember/player/components/GameLogChart.test.tsx
git commit -m "feat(client): player chart, stat cards, and filtered game log

Bars recolor against the line; the volume stat gets its own column
wherever the league config defines one."
```

---

### Task 10: Matchup panel

**Files:**
- Create: `client/src/ember/player/components/MatchupPanel.tsx`
- Test: `client/src/ember/player/components/MatchupPanel.test.tsx`

**Interfaces:**
- Consumes: `Split`, `Signal`, `MatchupTarget` from `derive.ts`; `StatDef` from `playerStats.ts`; `GameRow` from `types.ts`.
- Produces: `<MatchupPanel target splits signal h2h statDefs volumeDef />`.

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/components/MatchupPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MatchupPanel from './MatchupPanel'
import { getPlayerStatConfig } from '@/config/playerStats'
import type { MatchupTarget, Signal, Split } from '../derive'

const cfg = getPlayerStatConfig('nba')
const statDefs = cfg.statsFor('player')
const volumeDef = cfg.volumeFor('player')

const splits: Split[] = [
  { key: 'points', label: 'PTS', season: 25, versus: 31.7, delta: 6.7 },
  { key: 'rebounds', label: 'REB', season: 5.6, versus: 4, delta: -1.6 },
]
const signal: Signal = {
  rank: 28, allowed: 26.4, positionGroup: 'G', bucket: 'GREAT', asOf: '2026-06-15',
}
const scheduleTarget: MatchupTarget = {
  team: 'BOS',
  source: 'schedule',
  upcoming: { gameId: 1, date: '2026-08-02', opponent: 'BOS', opponentTeamId: 5, isHome: true, daysRest: 2 },
}
const filterTarget: MatchupTarget = { team: 'MIA', source: 'filter', upcoming: null }

const base = { splits, signal, h2h: [], statDefs, volumeDef }

describe('MatchupPanel', () => {
  it('prompts for an opponent when there is no target', () => {
    render(<MatchupPanel {...base} target={null} />)
    expect(screen.getByText(/SELECT AN OPPONENT/)).toBeInTheDocument()
  })

  it('labels a scheduled matchup as the next game with its date', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText(/NEXT/)).toBeInTheDocument()
    expect(screen.getByText(/2026-08-02/)).toBeInTheDocument()
  })

  it('labels a filter-driven matchup differently from a scheduled one', () => {
    render(<MatchupPanel {...base} target={filterTarget} />)
    expect(screen.getByText(/MATCHUP/)).toBeInTheDocument()
    expect(screen.queryByText(/NEXT/)).not.toBeInTheDocument()
  })

  it('shows season and versus averages as separate figures', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText('25.0')).toBeInTheDocument()
    expect(screen.getByText('31.7')).toBeInTheDocument()
  })

  it('signs the delta in both directions', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText('+6.7')).toBeInTheDocument()
    expect(screen.getByText('-1.6')).toBeInTheDocument()
  })

  it('shows the number behind the signal, never a bare grade', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText('GREAT')).toBeInTheDocument()
    expect(screen.getByText(/28TH/)).toBeInTheDocument()
    expect(screen.getByText(/26\.4/)).toBeInTheDocument()
  })

  it('omits the signal when defense data is missing', () => {
    render(<MatchupPanel {...base} signal={null} target={scheduleTarget} />)
    expect(screen.queryByText('GREAT')).not.toBeInTheDocument()
    // The rest of the panel still renders.
    expect(screen.getByText('31.7')).toBeInTheDocument()
  })

  it('reports no meetings rather than an empty table', () => {
    render(<MatchupPanel {...base} target={scheduleTarget} />)
    expect(screen.getByText(/NO MEETINGS/)).toBeInTheDocument()
  })

  it('flags a thin head-to-head sample', () => {
    const h2h = [{ date: '2026-04-10', opponent: 'BOS', points: 30 }]
    render(<MatchupPanel {...base} h2h={h2h} target={scheduleTarget} />)
    expect(screen.getByText(/SMALL SAMPLE/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/components/MatchupPanel.test.tsx`
Expected: FAIL — module `./MatchupPanel` does not exist.

- [ ] **Step 3: Write MatchupPanel**

Create `client/src/ember/player/components/MatchupPanel.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { StatDef } from '@/config/playerStats'
import type { MatchupTarget, Signal, Split } from '../derive'
import type { GameRow } from '../types'
import GameLogTable from './GameLogTable'

interface MatchupPanelProps {
  target: MatchupTarget | null
  splits: Split[]
  signal: Signal | null
  h2h: GameRow[]
  statDefs: StatDef[]
  volumeDef: StatDef | null
}

const SMALL_SAMPLE = 3

const BUCKET_COLOR: Record<Signal['bucket'], string> = {
  GREAT: '#3FBF7F',
  GOOD: '#3FBF7F',
  NEUTRAL: '#9A918F',
  TOUGH: '#FF6B5C',
  BRUTAL: '#FF6B5C',
}

const ord = (n: number): string => {
  const t = n % 10
  const h = n % 100
  if (t === 1 && h !== 11) return `${n}ST`
  if (t === 2 && h !== 12) return `${n}ND`
  if (t === 3 && h !== 13) return `${n}RD`
  return `${n}TH`
}

function Title({ children }: { children: ReactNode }) {
  return (
    <span className="font-chakra italic font-bold text-[13px] tracking-[0.5px] text-[#EFEBE9]">
      <span className="text-[#FF6B3D]">{'//'}</span> {children}
    </span>
  )
}

export default function MatchupPanel({
  target, splits, signal, h2h, statDefs, volumeDef,
}: MatchupPanelProps) {
  if (!target) {
    return (
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px] px-[18px] py-9 text-center">
        <div className="font-martian text-[10px] text-[#665F5D] tracking-[1px]">
          SELECT AN OPPONENT TO SEE MATCHUP DETAIL
        </div>
        <div className="font-martian text-[8px] text-[#4A403C] tracking-[0.5px] mt-2">
          NO SCHEDULED GAME — USE THE VS FILTER ABOVE
        </div>
      </div>
    )
  }

  const u = target.upcoming
  const thin = h2h.length > 0 && h2h.length < SMALL_SAMPLE

  return (
    <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px]">
      <div className="flex items-center gap-3 px-[18px] py-[13px] border-b border-[#27221F] flex-wrap">
        {/* One template string, not several JSX children — a text matcher
            cannot match across sibling text nodes. */}
        <Title>{`${target.source === 'schedule' ? 'NEXT' : 'MATCHUP'}: VS ${target.team}`}</Title>
        {u && (
          <span className="font-martian text-[8px] text-[#9A918F] tracking-[1px]">
            {`${u.date} · ${u.isHome ? 'HOME' : 'AWAY'}${u.daysRest != null ? ` · ${u.daysRest}D REST` : ''}`}
          </span>
        )}
        {signal && (
          <span
            className="ml-auto font-martian font-bold text-[9px] tracking-[0.5px] px-[11px] py-[5px] rounded-xl border"
            style={{
              color: BUCKET_COLOR[signal.bucket],
              borderColor: BUCKET_COLOR[signal.bucket],
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            {signal.bucket}
          </span>
        )}
      </div>

      {signal && (
        <div className="px-[18px] py-[10px] border-b border-[#221D1A] font-martian text-[9px] text-[#9A918F] tracking-[0.5px]">
          {`${target.team} RANKS ${ord(signal.rank)}${
            signal.positionGroup ? ` VS ${signal.positionGroup}` : ''
          } · ${signal.allowed} ALLOWED PER GAME`}
          <span className="text-[#4A403C]">{` · AS OF ${signal.asOf}`}</span>
        </div>
      )}

      {/* Splits: season and versus side by side, never blended. */}
      <div className="px-[18px] pt-[14px] pb-3">
        <div className="grid grid-cols-[1fr_72px_72px_64px] gap-2 pb-[6px] border-b border-[#27221F]">
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">STAT</span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">SEASON</span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">
            VS {target.team}
          </span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">DIFF</span>
        </div>
        {splits.map((s) => (
          <div key={s.key} className="grid grid-cols-[1fr_72px_72px_64px] gap-2 py-[7px] border-b border-[#221D1A] items-center">
            <span className="font-martian text-[9px] text-[#9A918F] tracking-[0.5px]">{s.label}</span>
            <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right">
              {s.season == null ? '—' : s.season.toFixed(1)}
            </span>
            <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right">
              {s.versus == null ? '—' : s.versus.toFixed(1)}
            </span>
            <span
              className="font-martian font-medium text-[11px] text-right"
              style={{ color: s.delta == null ? '#665F5D' : s.delta >= 0 ? '#3FBF7F' : '#FF6B5C' }}
            >
              {s.delta == null ? '—' : `${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(1)}`}
            </span>
          </div>
        ))}
        {volumeDef && (
          <div className="font-martian text-[7px] text-[#4A403C] tracking-[0.5px] pt-2">
            {`VOLUME (${volumeDef.label}) INCLUDED ABOVE WHERE AVAILABLE`}
          </div>
        )}
      </div>

      {/* Head-to-head log */}
      <div className="border-t border-[#27221F]">
        <div className="flex items-baseline px-[18px] py-[11px] gap-3">
          <Title>HEAD TO HEAD</Title>
          {thin && (
            <span className="font-martian text-[8px] text-[#FF6B3D] tracking-[1px]">
              {`SMALL SAMPLE · ${h2h.length} GAME${h2h.length > 1 ? 'S' : ''}`}
            </span>
          )}
        </div>
        {h2h.length === 0 ? (
          <div className="px-[18px] pb-8 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
            NO MEETINGS THIS SEASON
          </div>
        ) : (
          <GameLogTable games={h2h} statDefs={statDefs} volumeDef={volumeDef} activeStat="" />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/components/MatchupPanel.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/ember/player/components/MatchupPanel.tsx client/src/ember/player/components/MatchupPanel.test.tsx
git commit -m "feat(client): matchup panel with splits, H2H, and signal

Season and versus-opponent averages stay separate figures. The
favorability badge always shows the rank and allowed-per-game behind it."
```

---

### Task 11: PlayerView shell

**Files:**
- Create: `client/src/ember/player/PlayerView.tsx`
- Test: `client/src/ember/player/PlayerView.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 4–10.
- Produces: `<PlayerView slug data mode initialFilters? />` where `mode: 'panel' | 'full'`.

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/PlayerView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlayerView from './PlayerView'
import type { PlayerLogResponse } from './types'

const DATA: PlayerLogResponse = {
  player: { id: 1, name: 'Test Player', team: 'OKC', position: 'G' },
  teamId: 9,
  games: [
    { date: '2026-04-10', opponent: 'BOS', isHome: true,  points: 30, rebounds: 5, assists: 4, threes: 3, minutes: 36 },
    { date: '2026-04-08', opponent: 'LAL', isHome: false, points: 20, rebounds: 7, assists: 6, threes: 2, minutes: 33 },
    { date: '2026-04-06', opponent: 'BOS', isHome: false, points: 10, rebounds: 4, assists: 5, threes: 1, minutes: 31 },
  ],
  seasonAvgs: { points: 20 },
  gamesPlayed: 3,
  upcoming: null,
}

describe('PlayerView', () => {
  beforeEach(() =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: null }) }))
  )
  afterEach(() => vi.unstubAllGlobals())

  it('renders the player identity', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    expect(screen.getByText('Test Player')).toBeInTheDocument()
  })

  it('offers every opponent the player has faced', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    const select = screen.getByLabelText('Opponent') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['', 'BOS', 'LAL'])
  })

  it('narrows the log when an opponent is chosen', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: 'BOS' } })
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(2)
  })

  it('seeds filters from an initial query filter', () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" initialFilters={{ vsTeam: 'BOS', window: 5 }} />)
    expect((screen.getByLabelText('Opponent') as HTMLSelectElement).value).toBe('BOS')
    expect(screen.getByRole('button', { name: 'L5' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('drives the matchup panel from the opponent filter when nothing is scheduled', async () => {
    render(<PlayerView slug="nba" data={DATA} mode="full" />)
    expect(screen.getByText(/SELECT AN OPPONENT/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: 'BOS' } })
    await waitFor(() => expect(screen.getByText(/MATCHUP: VS BOS/)).toBeInTheDocument())
  })

  it('renders a no-games state for an empty log', () => {
    render(<PlayerView slug="nba" data={{ ...DATA, games: [] }} mode="full" />)
    expect(screen.getByText(/NO GAMES LOGGED/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/PlayerView.test.tsx`
Expected: FAIL — module `./PlayerView` does not exist.

- [ ] **Step 3: Write PlayerView**

Create `client/src/ember/player/PlayerView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { LeagueSlug } from '@/config/leagues'
import { allStatsFor, getPlayerStatConfig } from '@/config/playerStats'
import { createLeagueApi } from '@/services/api'
import {
  filterGames, gamesVersus, hitRate, matchupSignal,
  opponentsOf, resolveMatchupOpponent, splitsFor,
} from './derive'
import { usePlayerFilters } from './usePlayerFilters'
import FilterBar from './components/FilterBar'
import LineControl from './components/LineControl'
import GameLogChart from './components/GameLogChart'
import StatLineCards from './components/StatLineCards'
import GameLogTable from './components/GameLogTable'
import MatchupPanel from './components/MatchupPanel'
import type { DefenseSplit, PlayerFilters, PlayerLogResponse } from './types'

interface PlayerViewProps {
  slug: LeagueSlug
  data: PlayerLogResponse
  mode: 'panel' | 'full'
  initialFilters?: Partial<PlayerFilters>
}

/** Teams per league, for turning a defensive rank into a percentile. */
const TEAM_COUNT: Record<LeagueSlug, number> = { nba: 30, mlb: 30, nhl: 32, nfl: 32 }

export default function PlayerView({ slug, data, mode, initialFilters }: PlayerViewProps) {
  const cfg = getPlayerStatConfig(slug)
  const games = data.games
  const role = cfg.roleOf(data.player, games[0])
  const statDefs = useMemo(() => allStatsFor(cfg, role), [cfg, role])
  const volumeDef = useMemo(() => cfg.volumeFor(role), [cfg, role])

  const { filters, setWindow, setVsTeam, setHomeAway, setStat, setLine, resetLine } =
    usePlayerFilters({ games, statDefs, initial: initialFilters })

  const activeDef = statDefs.find((s) => s.key === filters.stat) ?? statDefs[0]
  const filtered = useMemo(() => filterGames(games, filters), [games, filters])
  const opponents = useMemo(() => opponentsOf(games), [games])

  const target = resolveMatchupOpponent(data.upcoming, filters.vsTeam)
  const h2h = useMemo(() => (target ? gamesVersus(games, target.team) : []), [games, target])

  // Defensive split for the matchup signal. Null for leagues with no table.
  const [defense, setDefense] = useState<DefenseSplit | null>(null)
  const oppTeamId = target?.upcoming?.opponentTeamId ?? null
  useEffect(() => {
    if (oppTeamId == null) {
      setDefense(null)
      return
    }
    let cancelled = false
    createLeagueApi(slug)
      .getTeamDefense(oppTeamId, filters.stat, data.player.position)
      .then((d) => !cancelled && setDefense(d))
      .catch(() => !cancelled && setDefense(null))
    return () => {
      cancelled = true
    }
  }, [slug, oppTeamId, filters.stat, data.player.position])

  if (games.length === 0) {
    return (
      <div className="px-[28px] py-16 text-center">
        <div className="font-chakra italic font-bold text-[24px] text-[#EFEBE9]">
          {data.player.name}
        </div>
        <div className="font-martian text-[10px] text-[#665F5D] tracking-[1px] mt-4">
          NO GAMES LOGGED THIS SEASON
        </div>
      </div>
    )
  }

  const pad = mode === 'full' ? 'px-[28px]' : 'px-[18px]'

  return (
    <div className={`${pad} pt-6 pb-11`}>
      {/* Identity */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-chakra italic font-bold text-[clamp(22px,3vw,34px)] tracking-[-1px] leading-none text-[#EFEBE9]">
            {data.player.name}
          </div>
          <div className="font-martian text-[10px] text-[#9A918F] mt-[7px] tracking-[0.5px]">
            {`${data.player.team} · ${data.player.position ?? '—'} · ${data.gamesPlayed} GP`.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Filters + line + chart */}
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-5">
        <FilterBar
          filters={filters}
          statDefs={statDefs}
          windows={cfg.windows}
          opponents={opponents}
          onWindow={setWindow}
          onVsTeam={setVsTeam}
          onHomeAway={setHomeAway}
          onStat={setStat}
        />
        <LineControl
          label={activeDef?.label ?? ''}
          line={filters.line}
          hitRate={hitRate(filtered, activeDef, filters.line)}
          versusHitRate={target ? hitRate(h2h, activeDef, filters.line) : null}
          versusTeam={target?.team ?? null}
          touched={filters.lineTouched}
          onLine={setLine}
          onReset={resetLine}
        />
        <StatLineCards
          games={filtered}
          statDefs={statDefs}
          volumeDef={volumeDef}
          activeStat={filters.stat}
        />
        <GameLogChart games={filtered} def={activeDef} line={filters.line} />
      </div>

      <MatchupPanel
        target={target}
        splits={splitsFor(games, h2h, [...(volumeDef ? [volumeDef] : []), ...statDefs])}
        signal={matchupSignal(defense, TEAM_COUNT[slug])}
        h2h={h2h}
        statDefs={statDefs}
        volumeDef={volumeDef}
      />

      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px] overflow-hidden">
        <div className="px-[18px] py-[13px] border-b border-[#27221F]">
          <span className="font-chakra italic font-bold text-[13px] tracking-[0.5px] text-[#EFEBE9]">
            <span className="text-[#FF6B3D]">{'//'}</span> GAME LOG · {filtered.length} GAMES
          </span>
        </div>
        <GameLogTable
          games={filtered}
          statDefs={statDefs}
          volumeDef={volumeDef}
          activeStat={filters.stat}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/PlayerView.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/ember/player/PlayerView.tsx client/src/ember/player/PlayerView.test.tsx
git commit -m "feat(client): PlayerView shell composing filters and matchup"
```

---

### Task 12: Full-screen route

**Files:**
- Create: `client/src/ember/player/PlayerPage.tsx`
- Modify: `client/src/App.tsx:39-47`
- Test: `client/src/ember/player/PlayerPage.test.tsx`

**Interfaces:**
- Consumes: `usePlayerData` from Task 6; `PlayerView` from Task 11.
- Produces: route `/player/:league/:id` rendering `PlayerPage`.

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/player/PlayerPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PlayerPage from './PlayerPage'

const PROFILE = {
  player: { id: 1, name: 'Test Player', team: 'OKC', position: 'G' },
  teamId: 9,
  games: [{ date: '2026-04-10', opponent: 'BOS', isHome: true, points: 30, rebounds: 5, assists: 4, threes: 3, minutes: 36 }],
  seasonAvgs: {}, gamesPlayed: 1, upcoming: null,
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/player/:league/:id" element={<PlayerPage />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>
  )

describe('PlayerPage', () => {
  beforeEach(() =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: PROFILE }) }))
  )
  afterEach(() => vi.unstubAllGlobals())

  it('shows a loading state before data arrives', () => {
    at('/player/nba/1')
    expect(screen.getByText(/LOADING/)).toBeInTheDocument()
  })

  it('renders the player once loaded', async () => {
    at('/player/nba/1')
    await waitFor(() => expect(screen.getByText('Test Player')).toBeInTheDocument())
  })

  it('redirects an unknown league to home', async () => {
    at('/player/cricket/1')
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })

  it('redirects a non-numeric player id to home', async () => {
    at('/player/nba/abc')
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })

  it('shows an error with a retry when the fetch fails', async () => {
    ;(fetch as any).mockRejectedValue(new Error('boom'))
    at('/player/nba/1')
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /RETRY/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/player/PlayerPage.test.tsx`
Expected: FAIL — module `./PlayerPage` does not exist.

- [ ] **Step 3: Write PlayerPage**

Create `client/src/ember/player/PlayerPage.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { LEAGUES, type LeagueSlug } from '@/config/leagues'
import PlayerView from './PlayerView'
import { usePlayerData } from './usePlayerData'

const isLeague = (s: string | undefined): s is LeagueSlug =>
  LEAGUES.some((l) => l.slug === s)

function Centered({ children }: { children: ReactNode }) {
  return <div className="px-[28px] py-20 text-center">{children}</div>
}

export default function PlayerPage() {
  const { league, id } = useParams<{ league: string; id: string }>()
  const playerId = Number(id)

  if (!isLeague(league) || !Number.isFinite(playerId) || playerId <= 0) {
    return <Navigate to="/" replace />
  }
  return <PlayerPageInner slug={league} id={playerId} />
}

function PlayerPageInner({ slug, id }: { slug: LeagueSlug; id: number }) {
  const { data, loading, error, reload } = usePlayerData(slug, id)

  if (loading) {
    return (
      <Centered>
        <span className="font-martian text-[10px] text-[#665F5D] tracking-[1px]">LOADING PLAYER…</span>
      </Centered>
    )
  }

  if (error || !data) {
    return (
      <Centered>
        <div className="font-martian text-[10px] text-[#FF6B5C] tracking-[1px]">
          {`COULD NOT LOAD PLAYER — ${error ?? 'no data'}`}
        </div>
        <button
          type="button"
          onClick={reload}
          className="font-martian text-[9px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md px-[14px] py-[7px] mt-4 cursor-pointer"
        >
          RETRY
        </button>
      </Centered>
    )
  }

  return <PlayerView slug={slug} data={data} mode="full" />
}
```

- [ ] **Step 4: Register the route**

In `client/src/App.tsx`, add the import:

```tsx
import PlayerPage from '@/ember/player/PlayerPage'
```

and add this route inside the `EmberLayout` `<Route element={...}>` block, after the `/sportquery/:sessionId` line:

```tsx
        <Route path="/player/:league/:id" element={<PlayerPage />} />
```

The three-segment path cannot collide with the two-segment legacy `/player/:id` under `LegacyLayout`, which stays exactly as it is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/player/PlayerPage.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify both routes still resolve**

Run the dev server (`npm run dev:both` from the repo root) and visit:
- `http://localhost:5173/player/nba/<a real player id>` — new Ember full-screen view
- `http://localhost:5173/player/<same id>` — legacy view, unchanged

Expected: both render their own UI; neither 404s.

- [ ] **Step 7: Commit**

```bash
git add client/src/ember/player/PlayerPage.tsx client/src/ember/player/PlayerPage.test.tsx client/src/App.tsx
git commit -m "feat(client): deep-linkable /player/:league/:id route

Three segments, so the legacy two-segment /player/:id route is
untouched."
```

---

### Task 13: SportQuery panel integration and query-driven filters

**Files:**
- Modify: `client/src/ember/sportquery/DetailPane.tsx`
- Modify: `client/src/ember/sportquery/data.ts`
- Create: `client/src/ember/sportquery/queryFilters.ts`
- Test: `client/src/ember/sportquery/queryFilters.test.ts`

**Interfaces:**
- Consumes: `PlayerFilters` from `types.ts`.
- Produces: `parseQueryFilters(query: string, statKeys: string[]): Partial<PlayerFilters>` and `sanitizeQueryFilters(raw: unknown, statKeys: string[]): Partial<PlayerFilters>`.

- [ ] **Step 1: Write the failing test**

Create `client/src/ember/sportquery/queryFilters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseQueryFilters, sanitizeQueryFilters } from './queryFilters'

const STATS = ['points', 'rebounds', 'assists', 'threes', 'pra']

describe('parseQueryFilters', () => {
  it('reads a game window', () => {
    expect(parseQueryFilters('last 10 games', STATS).window).toBe(10)
    expect(parseQueryFilters('over his last 5', STATS).window).toBe(5)
  })

  it('reads an opponent', () => {
    expect(parseQueryFilters('luka vs BOS this year', STATS).vsTeam).toBe('BOS')
    expect(parseQueryFilters('against LAL', STATS).vsTeam).toBe('LAL')
  })

  it('reads a line', () => {
    expect(parseQueryFilters('over 27.5 points', STATS).line).toBe(27.5)
  })

  it('reads a venue', () => {
    expect(parseQueryFilters('at home', STATS).homeAway).toBe('home')
    expect(parseQueryFilters('on the road', STATS).homeAway).toBe('away')
  })

  it('maps stat words to config keys', () => {
    expect(parseQueryFilters('points', STATS).stat).toBe('points')
    expect(parseQueryFilters('who rebounds best', STATS).stat).toBe('rebounds')
    expect(parseQueryFilters('pra leaders', STATS).stat).toBe('pra')
  })

  it('returns an empty object when nothing matches', () => {
    expect(parseQueryFilters('tell me something interesting', STATS)).toEqual({})
  })

  it('does not invent a team from a lowercase word', () => {
    expect(parseQueryFilters('vs the best defenses', STATS).vsTeam).toBeUndefined()
  })

  it('combines everything in one query', () => {
    expect(parseQueryFilters('luka over 27.5 points vs BOS in his last 10 at home', STATS)).toEqual({
      window: 10, vsTeam: 'BOS', line: 27.5, homeAway: 'home', stat: 'points',
    })
  })
})

describe('sanitizeQueryFilters', () => {
  it('passes through a valid object', () => {
    expect(sanitizeQueryFilters({ window: 10, vsTeam: 'BOS', stat: 'points' }, STATS)).toEqual({
      window: 10, vsTeam: 'BOS', stat: 'points',
    })
  })

  it('drops an unknown stat', () => {
    expect(sanitizeQueryFilters({ stat: 'touchdowns' }, STATS)).toEqual({})
  })

  it('drops a negative or absurd window', () => {
    expect(sanitizeQueryFilters({ window: -3 }, STATS)).toEqual({})
    expect(sanitizeQueryFilters({ window: 9999 }, STATS)).toEqual({})
  })

  it('drops a malformed team', () => {
    expect(sanitizeQueryFilters({ vsTeam: 42 }, STATS)).toEqual({})
    expect(sanitizeQueryFilters({ vsTeam: 'NOT A TEAM' }, STATS)).toEqual({})
  })

  it('drops a non-numeric line', () => {
    expect(sanitizeQueryFilters({ line: 'high' }, STATS)).toEqual({})
  })

  it('tolerates null and non-object input', () => {
    expect(sanitizeQueryFilters(null, STATS)).toEqual({})
    expect(sanitizeQueryFilters('nope', STATS)).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/ember/sportquery/queryFilters.test.ts`
Expected: FAIL — module `./queryFilters` does not exist.

- [ ] **Step 3: Write the parser**

Create `client/src/ember/sportquery/queryFilters.ts`:

```ts
import type { HomeAway, PlayerFilters } from '@/ember/player/types'

// Turns a natural-language query into player-view filters. Two entry points:
// parseQueryFilters for the local regex path, sanitizeQueryFilters for the LLM
// path, which is not a trusted source of well-formed enums.

/** Words a user might use for a stat, mapped to config keys. */
const STAT_WORDS: [RegExp, string][] = [
  [/\bpra\b|points.*rebounds.*assists/i, 'pra'],
  [/\brebound|\bboard|\bglass\b/i, 'rebounds'],
  [/\bassist|\bdime|playmak/i, 'assists'],
  [/\bthree|\b3pm\b|\b3-p|from deep/i, 'threes'],
  [/\bpoint|\bscor|\bppg\b/i, 'points'],
]

const TEAM_RE = /\b(?:vs\.?|against|versus)\s+([A-Z]{2,3})\b/
const WINDOW_RE = /\blast\s+(\d{1,2})\b/i
const LINE_RE = /\b(?:over|under|above|below)\s+(\d{1,3}(?:\.\d)?)\b/i

export function parseQueryFilters(query: string, statKeys: string[]): Partial<PlayerFilters> {
  const out: Partial<PlayerFilters> = {}

  const w = query.match(WINDOW_RE)
  if (w) {
    const n = parseInt(w[1], 10)
    if (n > 0 && n <= 82) out.window = n
  }

  // Team codes are uppercase by convention; matching case-insensitively would
  // turn "vs the league" into a team named THE.
  const t = query.match(TEAM_RE)
  if (t) out.vsTeam = t[1]

  const l = query.match(LINE_RE)
  if (l) out.line = parseFloat(l[1])

  if (/\bat home\b|\bhome games?\b/i.test(query)) out.homeAway = 'home'
  else if (/\bon the road\b|\baway games?\b|\broad games?\b/i.test(query)) out.homeAway = 'away'

  for (const [re, key] of STAT_WORDS) {
    if (re.test(query) && statKeys.includes(key)) {
      out.stat = key
      break
    }
  }

  return out
}

const VENUES: HomeAway[] = ['all', 'home', 'away']

/** Validate an untrusted filters object from the LLM. Unknown values are dropped. */
export function sanitizeQueryFilters(raw: unknown, statKeys: string[]): Partial<PlayerFilters> {
  if (raw == null || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: Partial<PlayerFilters> = {}

  if (typeof r.window === 'number' && Number.isInteger(r.window) && r.window > 0 && r.window <= 82) {
    out.window = r.window
  }
  if (typeof r.vsTeam === 'string' && /^[A-Z]{2,3}$/.test(r.vsTeam)) {
    out.vsTeam = r.vsTeam
  }
  if (typeof r.stat === 'string' && statKeys.includes(r.stat)) {
    out.stat = r.stat
  }
  if (typeof r.line === 'number' && Number.isFinite(r.line) && r.line >= 0) {
    out.line = r.line
  }
  if (typeof r.homeAway === 'string' && VENUES.includes(r.homeAway as HomeAway)) {
    out.homeAway = r.homeAway as HomeAway
  }

  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/ember/sportquery/queryFilters.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Point the detail pane at the real player view**

`DetailPane.tsx` currently renders the fixture-backed `PlayerDetail`. Replace the player branch with the real view, fetching by player id. Rewrite `client/src/ember/sportquery/DetailPane.tsx`:

```tsx
import GameDetail from './GameDetail'
import PlayerDetail from './PlayerDetail'
import PlayerView from '@/ember/player/PlayerView'
import { usePlayerData } from '@/ember/player/usePlayerData'
import { parseQueryFilters } from './queryFilters'
import { allStatsFor, getPlayerStatConfig } from '@/config/playerStats'
import { GAMES, STATLBL, type Selection } from './data'

interface DetailPaneProps {
  sel: Selection
  onClose: () => void
  onChange: (sel: Selection) => void
}

/** Real player panel, filters seeded from the query that produced the result. */
function PlayerPanel({ playerId, query }: { playerId: number; query: string }) {
  const { data, loading, error, reload } = usePlayerData('nba', playerId)
  const statKeys = allStatsFor(getPlayerStatConfig('nba'), 'player').map((s) => s.key)

  if (loading) {
    return (
      <div className="px-[18px] py-16 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
        LOADING PLAYER…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="px-[18px] py-16 text-center">
        <div className="font-martian text-[10px] text-[#FF6B5C] tracking-[1px]">
          {`COULD NOT LOAD PLAYER — ${error ?? 'no data'}`}
        </div>
        <button
          type="button"
          onClick={reload}
          className="font-martian text-[9px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md px-[14px] py-[7px] mt-4 cursor-pointer"
        >
          RETRY
        </button>
      </div>
    )
  }
  return (
    <PlayerView
      slug="nba"
      data={data}
      mode="panel"
      initialFilters={parseQueryFilters(query, statKeys)}
    />
  )
}

export default function DetailPane({ sel, onClose, onChange }: DetailPaneProps) {
  const chip = sel.type === 'player' ? `FOCUS: ${STATLBL[sel.stat]}` : GAMES[sel.id].live ? 'LIVE' : 'FINAL'
  // Fixture selections carry a string key, not a database id. Real ids arrive
  // once the chat pane is wired to the backend; until then those fall back to
  // the fixture panel.
  const realId = sel.type === 'player' ? Number(sel.id) : NaN

  return (
    <div className="flex-1 min-w-0 bg-[#171310] text-[#EFEBE9] overflow-y-auto animate-rise">
      <div className="sticky top-0 z-[5] flex items-center gap-3 px-[28px] py-[11px] border-b border-[#2A2320] bg-[#1D1815]">
        <span className="font-martian font-bold text-[10px] text-[#FF6B3D] shrink-0">&gt;_</span>
        <span className="font-martian text-[10px] text-[#9A918F] whitespace-nowrap overflow-hidden text-ellipsis flex-auto min-w-[72px]">
          FROM: “{sel.query}”
        </span>
        <div className="flex gap-[6px] shrink-0">
          <span className="font-martian font-medium text-[9px] tracking-[0.5px] px-[11px] py-1 rounded-xl border border-[#EFE9E0] bg-[#EFE9E0] text-[#14100F] whitespace-nowrap">
            {chip}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-martian font-bold text-[10px] text-[#9A918F] hover:text-[#EFEBE9] cursor-pointer px-[10px] py-[5px] border border-[#2C2624] hover:border-[#665F5D] rounded-md shrink-0"
        >
          ✕ CLOSE
        </button>
      </div>
      {sel.type === 'player' ? (
        Number.isFinite(realId) && realId > 0 ? (
          <PlayerPanel playerId={realId} query={sel.query} />
        ) : (
          <PlayerDetail sel={sel} onChange={onChange} />
        )
      ) : (
        <GameDetail sel={sel} onChange={onChange} />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run the full client suite**

Run: `cd client && npm test`
Expected: every suite passes, including the pre-existing `leagues.test.ts` and `api.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add client/src/ember/sportquery/queryFilters.ts client/src/ember/sportquery/queryFilters.test.ts client/src/ember/sportquery/DetailPane.tsx
git commit -m "feat(client): seed player view filters from the query

The regex path parses window, opponent, line, venue, and stat. The LLM
path is validated on receipt since it is not a trusted enum source.
Fixture-keyed selections still fall back to the fixture panel."
```

---

### Task 14: Full verification

**Files:** none modified — this task verifies the whole feature.

- [ ] **Step 1: Run every test**

```bash
cd client && npm test
cd ../server && npm test
```

Expected: all suites pass. Record the counts.

- [ ] **Step 2: Typecheck and lint both sides**

```bash
cd client && npm run build
cd ../server && npx tsc --noEmit
cd ../client && npm run lint
```

Expected: clean build, no type errors, zero lint warnings (`--max-warnings 0` is configured).

- [ ] **Step 3: Exercise the new endpoints by hand**

Start the server, then:

```bash
curl -s "http://localhost:3000/api/nhl/players/1/games?window=all" | head -c 400
curl -s "http://localhost:3000/api/nfl/players/1/games?window=all" | head -c 400
```

Expected: both return `success: true` with league-appropriate columns — `toiSeconds`/`goals` for NHL, `passingYards`/`carries` for NFL. If a given player id has no rows, try another id from that league rather than assuming a failure.

- [ ] **Step 4: Walk the UI**

Run `npm run dev:both` from the repo root and confirm each of these by hand:

1. `/player/nba/<id>` loads with filters, a chart, and a game log.
2. Changing the window to L5 shrinks the chart to five bars.
3. Selecting an opponent narrows the log and switches the matchup panel header to `MATCHUP: VS <TEAM>`.
4. The ± buttons move the line and the hit rate updates; `RESET TO AVG` appears and works.
5. Switching the stat to REB re-labels the line and recomputes the default.
6. The minutes column is present in the game log.
7. `/player/<id>` (two segments) still renders the legacy view.
8. `/sportquery` still loads and opening a player result renders a panel.

- [ ] **Step 5: Commit any fixes**

If steps 1–4 surfaced defects, fix them and commit. If everything passed, there is nothing to commit — say so explicitly rather than creating an empty commit.

---

## Deferred Follow-Ups

Not part of this plan; capture as separate work:

- Populate position-defense tables for MLB, NHL, and NFL so the matchup signal works beyond NBA.
- Richer context chips. The spec lists opponent record, pace, and usage rate alongside home/away and days rest. Only the latter two ship here, because record/pace/usage are not in the player log payload — `player_game_conditions` carries `usg_pct` and `pace` for NBA, and `getPlayerGames` would need to join and return them.
- Wire the SportQuery chat pane to real player ids so the panel stops falling back to fixtures.
- Have the LLM path emit a `filters` object; `sanitizeQueryFilters` already exists to receive it.
- Enable Row Level Security with policies — explicitly excluded here.
- Migrate the legacy `/player/:id` and `/mlb/player/:id` views onto `PlayerView`, then retire them.
