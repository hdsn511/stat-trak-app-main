# Filterable, Matchup-Aware Player View

**Date:** 2026-07-31
**Status:** Design approved, pending spec review

## Problem

The Ember player view (`client/src/ember/sportquery/PlayerDetail.tsx`) is a static
read-only panel. It renders ten hardcoded fixture games, offers three period buttons
that only relabel stat cards, and shows nothing about the game the player is about
to play. A user who wants to know "does Luka clear 27.5 points against Boston" has to
leave the app.

This design makes the player view filterable and matchup-aware, and makes it work
for every league rather than NBA alone.

## Goals

1. Filter a player's game log by window (5 / 10 / 20 / all), by opponent, and by
   home/away.
2. Show the volume stat (minutes for basketball) as a first-class column, not an
   afterthought — a 30-point game in 24 minutes reads differently than in 40.
3. Let the user drag a prop line up and down, defaulting to the filtered average,
   and read hit rate off it.
4. Surface what matters for the *upcoming* matchup: season-vs-opponent splits,
   head-to-head log, context chips, hit rate against that opponent, and a plain
   signal for whether the matchup is favorable.
5. Run the same component in the SportQuery side panel and as a full-screen page.
6. Work for MLB, NHL, and NFL — all of which already have per-game stats in
   Supabase — from one set of components, driven by per-league configuration rather
   than per-sport branching in the UI.

## Non-Goals

- Replacing the legacy `/player/:id` and `/mlb/player/:id` views. They stay
  reachable and untouched; migrating them is separate work.
- Multi-player comparison.
- Persisting filter state across sessions.
- Betting odds integration. The line is a user-controlled threshold, not a
  sportsbook number.

## Decisions Already Made

| Question | Decision |
|---|---|
| Data source | Real backend (Express + Supabase), not extended fixtures |
| Full-screen mode | Dedicated deep-linkable route |
| Query ↔ filter coupling | Query → filters only; manual filter changes stay local |
| Matchup blocks | All four, plus a favorable/unfavorable signal |
| Architecture | Shared module + full game log, derived client-side |
| League scope | Built for all sports from the start |

## Architecture

### Route Shape

The new full-screen view mounts under `EmberLayout` at:

```
/player/:league/:id      →  /player/nba/1628983
```

Three segments, so it cannot collide with the existing two-segment legacy routes
`/player/:id` or `/mlb/player/:id`. Those keep working exactly as they do now. An
unrecognized `:league` redirects to `/`.

### Module Layout

A new `client/src/ember/player/` directory. The SportQuery panel and the
full-screen route both render `PlayerView`, differing only by a `mode` prop that
controls column density and section ordering — not by which data or filters exist.

```
client/src/ember/player/
  PlayerView.tsx          shell; mode: 'panel' | 'full'
  PlayerPage.tsx          route wrapper: parses params, fetches, renders PlayerView
  usePlayerData.ts        fetch + cache the profile payload
  usePlayerFilters.ts     filter state reducer, seeded from an optional initial filter
  leagueStats.ts          per-league stat registry (client mirror of server config)
  derive.ts               pure derivation: windowing, splits, hit rate, grading
  components/
    FilterBar.tsx         window / opponent / home-away / stat selectors
    LineControl.tsx       draggable line + hit-rate readout
    StatLineCards.tsx     per-stat cards, filtered-window values
    GameLogChart.tsx      bars + threshold line, colored by clear/miss
    MatchupPanel.tsx      splits + context chips + signal
    H2HTable.tsx          head-to-head game log
    GameLogTable.tsx      filtered full log with volume column
```

`derive.ts` and `leagueStats.ts` hold no React. Everything the UI displays is a
pure function of `(games, filters, leagueConfig)`, which is what makes the filters
feel instant and the logic testable without rendering.

### League Modularity

All four leagues already have per-game stats in Supabase — `nba_player_stats`
(124k rows), `mlb_player_stats` (189k), `nhl_player_stats` (53k), and
`nfl_player_stats` (17.5k). This view can therefore be genuinely multi-sport from
day one rather than NBA-with-stubs.

The critical structural fact is that **stats are per-player, not per-league**. An
NFL quarterback and a wide receiver share no meaningful stat columns; NHL skaters
and goalies share none; MLB already branches on pitcher-versus-batter in the
existing controller. So the registry resolves stats from the *player*, not from the
league alone:

```ts
interface StatDef {
  key: string                       // 'pts'
  label: string                     // 'PTS'
  get: (g: GameRow) => number | null
  format?: (v: number) => string    // TOI seconds → "18:42"
}

interface LeagueStatConfig {
  slug: 'nba' | 'mlb' | 'nfl' | 'nhl'
  windows: number[]                          // [5, 10, 20, 0]  (0 = all)
  /** Role bucket for a player — 'skater' | 'goalie' | 'qb' | 'rb' … */
  roleOf: (p: Player) => string
  /** Volume stat for that role: MIN, PA, TOI, or attempts/carries/targets */
  volumeFor: (role: string) => StatDef | null
  /** Line-able single stats for that role */
  statsFor: (role: string) => StatDef[]
  /** Derived sums: PRA, H+R+RBI, scrimmage yards, G+A */
  combosFor: (role: string) => StatDef[]
}
```

Per-league volume stats resolve as:

| League | Volume | Column |
|---|---|---|
| NBA | Minutes | `minutes_played` |
| MLB (batter) | Plate appearances | `plate_appearances` |
| MLB (pitcher) | Outs pitched | `outs_pitched` |
| NHL (skater) | Time on ice | `toi_seconds`, formatted MM:SS |
| NHL (goalie) | Time on ice | `goalie_toi_seconds` |
| NFL | Role-dependent | `attempts` (QB), `carries` (RB), `targets` (WR/TE) |

NFL has no snap-count column, which is why volume is a function of role rather than
a league constant. Positions with no sensible volume stat return `null` and the
column is omitted rather than rendered blank.

Nothing in `PlayerView` or `derive.ts` may reference a sport-specific stat name.
Anywhere a stat is needed, it comes from `LeagueStatConfig`. This is the constraint
that keeps the "works for all sports" promise honest, and it is worth enforcing in
review.

### Backend Changes

**1. NFL and NHL league configs.** `server/src/config/leagues.ts` currently registers
only `nba` and `mlb`, so `LeagueSlug` and `LEAGUES` gain `nfl` and `nhl` entries
(`statsTable`, `playedGate`, `playerGameSelect`, `statLabels`, `statConfig`) and the
routes get mounted for them. Neither has a trends table, so `trendsTable` becomes
optional and the trend-derived fields (`zScores`, `rollingAvgs`) return empty
objects for those leagues rather than erroring. The player view does not depend on
trends; only the existing trending/streak endpoints do, and those stay NBA/MLB-only
for now.

**2. Full season log.** `getPlayerGames` caps the returned log at 20 rows while
separately aggregating the whole season for averages. Add `?window=all` to return
every season row through the same mapping. The default stays at 20 so existing
callers are unaffected.

**3. Upcoming game.** Add an `upcoming` field: the player's team's next scheduled
game from the `games` table (opponent abbreviation and id, date, home/away, days
rest). `null` when there is no scheduled game — off day, offseason, or a league
without forward schedule data.

**4. Opponent defensive context.** The `opponent_position_defense` table already
exists (30 teams × position groups, with `pts_allowed_pg`, `reb_allowed_pg`,
`ast_allowed_pg`, `fg3m_allowed_pg` and a league rank per stat). It is NBA-shaped
and NBA-only, but it is position-aware, which is better than a flat team average —
the matchup signal can answer "how does this team defend guards" rather than just
"how many points does this team allow."

So: `GET /api/{league}/teams/{id}/defense?stat={key}&position={group}` reads that
table for NBA and returns `null` for leagues without an equivalent. The response
shape is defined once:

```ts
interface DefenseSplit {
  allowedPerGame: number
  leagueRank: number      // 1 = stingiest
  positionGroup: string | null
  asOf: string            // snapshot_date
}
```

Populating the equivalent table for the other three leagues is follow-on work, not
part of this change. Until then those leagues render every block except the signal
badge, which is exactly the degradation rule stated below.

The client API layer gets matching methods on `createLeagueApi` in
`client/src/services/api.ts`, so every league gets them for free.

**Note on `snapshot_date`.** `opponent_position_defense` is a snapshot table. The
endpoint must select the most recent snapshot rather than assuming one row per
team/position, and the UI shows the `asOf` date so a stale snapshot is visible
rather than silently presented as current.

## Data Flow

```
PlayerPage (/player/nba/:id)          SportQuery ChatPane selection
        │                                        │
        └────────────┬───────────────────────────┘
                     ▼
         usePlayerData(league, id)
         → GET /api/{league}/players/{id}/games?window=all
         → GET /api/{league}/teams/{oppId}/defense?stat={x}&position={g}
                     ▼
         usePlayerFilters(initialFilters?)
         { window, vsTeam, homeAway, stat, line }
                     ▼
         derive(games, filters, leagueConfig)
         { filtered, seasonSplit, oppSplit, h2h, hitRate,
           h2hHitRate, matchupSignal, volumeAvg }
                     ▼
              PlayerView (panel | full)
```

The profile is fetched once per player. Every filter change is a pure recompute over
data already in memory — no network round trip, no spinner. The defense payload is
the only filter-dependent fetch, and it is cached client-side per
`(league, teamId, stat, positionGroup)`.

## Filters and Interactions

### Filter Bar

- **Window** — `L5 / L10 / L20 / ALL`, sourced from `LeagueStatConfig.windows`.
  Games are ordered most-recent-first, so a window is a slice of the head.
- **Opponent** — `ALL TEAMS` plus every team the player has faced this season.
  Combines with the window: "last 20, vs BOS" means BOS games within the last 20.
  When the combination yields fewer than three games, the UI labels the sample size
  rather than hiding it.
- **Home / Away** — `ALL / HOME / AWAY`.
- **Stat focus** — drives the chart, the line, and the matchup signal. Includes the
  role's combo stats (PRA for basketball) as first-class options.

Every active filter renders as a removable chip, so the current slice is always
readable at a glance and one click from being widened.

### Volume Stat

The volume stat gets a dedicated column in the game log table, a value in the stat
card row, and an average in the splits. For basketball it is minutes; the label,
accessor, and formatter come from `volumeFor(role)`. When that returns `null` — an
NFL kicker, say — the column is omitted rather than rendered blank.

### The Line

Defaults to the filtered window's average for the focused stat, rounded to the
nearest half. Adjustable three ways: drag the threshold line on the chart, use ±0.5
stepper buttons, or type a value. Moving it recomputes, live:

- **Hit rate** over the filtered set — `7/10 OVER (70%)`, with pushes counted
  separately and never folded into either side.
- **Hit rate versus the upcoming opponent** — `3/4 OVER vs BOS`.
- Chart bars recolor: clears the line in `pos`, misses in `neg`, pushes muted.

Changing the window or opponent filter resets the line to the new filtered average
unless the user has manually moved it, in which case their value is preserved. A
"reset to avg" affordance appears once the line has been touched.

### Matchup Section

Renders when `upcoming` is non-null. Four blocks:

1. **Splits** — for each of the league's stats plus the volume stat, two columns:
   season average, and average against the upcoming opponent. Separate numbers side
   by side with a signed delta, per the requirement that these not be blended.
2. **Head-to-head log** — every game against the upcoming opponent this season:
   date, home/away, volume, the full stat line, result. Empty state reads
   `NO MEETINGS THIS SEASON` rather than rendering an empty table.
3. **Context chips** — home/away, days rest, opponent record. For NBA these come
   from `player_game_conditions`, which already carries `home_away`, `days_rest`,
   `usg_pct`, and `pace` per player-game; pace and usage are worth showing where
   available since both move counting stats. Facts only, no interpretation.
4. **Matchup signal** — how much of the focused stat the opponent allows per game to
   the player's position group, expressed as a rank and a bucket
   (`GREAT / GOOD / NEUTRAL / TOUGH / BRUTAL`), colored with the `pos` / `neg`
   tokens.

The signal always displays the number behind it — `28TH VS GUARDS · 26.4 PTS/G
ALLOWED` — never a bare grade. A colored badge with no visible basis is exactly the
kind of ambiguous metric the UI clarity backlog already flags.

When the head-to-head sample is thin (fewer than three meetings), the splits and
hit-rate blocks label it as a small sample instead of presenting a two-game average
as equivalent to a season number.

## Query → Filters

The SportQuery response contract gains an optional `filters` object:

```ts
interface QueryFilters {
  window?: number      // 5 | 10 | 20 | 0
  vsTeam?: string      // 'BOS'
  stat?: string        // 'pts' | 'pra'
  line?: number        // 27.5
  homeAway?: 'home' | 'away'
}
```

Two producers:

- The LLM path (`server/src/prompts/sportquery-system.ts`) returns the object
  alongside its answer.
- The local `matchIntent` regex path gains capture for `last N games`,
  `vs XXX`, `over N`, and `at home` / `on the road`, so the fixture path stays
  usable in development.

When a player card is selected from a result set, those filters seed
`usePlayerFilters`. From that point the view is independent — manual changes do not
write back to the chat, per the chosen scope. `QueryFilters` is validated on receipt
and unknown or malformed values fall back to defaults, since the LLM path is not a
trusted source of well-formed enums.

## Error and Empty States

| Condition | Behavior |
|---|---|
| Profile fetch fails | Error card with retry; the panel does not blank the chat |
| Player has zero season games | `NO GAMES LOGGED` state, filters disabled |
| Filter combination yields zero games | Empty chart with a "widen the filter" hint; filters stay active |
| No upcoming game | Matchup section omitted; the rest of the view renders normally |
| No defense data for the league | Splits and H2H still render; only the signal badge is suppressed |
| Player role has no volume stat | Volume column omitted, not rendered blank |
| League has no trends table (NFL/NHL) | Trend-derived fields absent; the view does not use them |

The rule throughout: one missing data source degrades one block, never the page.

## Testing

The client already runs Vitest. Tests concentrate on `derive.ts` and
`leagueStats.ts`, which are pure and hold all the logic worth getting wrong:

- Window slicing, including `ALL`, and windows longer than the available log.
- Opponent and home/away filters, including combination with a window and the
  zero-result case.
- Hit rate: over, under, and push handled as three distinct outcomes; exact-value
  games counted as pushes, not overs.
- Default line derivation and half-rounding; preservation of a manually moved line
  across a filter change.
- Splits and delta signs, including a player with no meetings against the opponent.
- Matchup signal bucketing at boundaries, and the fallback when defense data is
  absent.
- Combo stats: PRA summing, and a null component yielding null rather than a
  silently low total.
- Role resolution: an NHL goalie and an NHL skater get different stat sets from the
  same league config; an NFL quarterback and a receiver likewise. This is the
  regression test for the modularity goal and the case most likely to break.
- Volume formatting: NHL `toi_seconds` renders as MM:SS, not a raw integer.

Server-side, `getPlayerGames?window=all`, the NFL/NHL league configs, and the
defense endpoint follow the existing controller test patterns.

## Risks

**NFL is the hardest fit and should be built second, not last.** Its stat set varies
more by position than any other league, it has no snap-count column to serve as a
universal volume stat, and its 17-game season makes a "last 20 games" window
meaningless within a single year. If the role-based abstraction survives NBA plus
NFL, it will survive MLB and NHL. Building NFL early is what turns the modularity
goal into a tested claim instead of an aspiration.

**Only NBA has position-defense data.** `opponent_position_defense` is NBA-shaped,
so the matchup signal — the block the user specifically asked for — is NBA-only at
first. The other leagues get every other block. Populating equivalent tables is
follow-on work and should be scoped separately.

**Window semantics differ by sport.** `windows` is per-league config precisely
because 20 games is a quarter of an NBA season and more than a full NFL one. NBA,
MLB, and NHL use `[5, 10, 20, 0]`; NFL uses `[3, 6, 17, 0]` so its options stay
meaningful against a 17-game schedule. The values are game counts in every league —
only the numbers change, not the semantics.

**Query-driven filters are only as good as the parser.** A wrong filter silently
showing the wrong slice is worse than no filter, which is why every active filter is
rendered as a visible, removable chip.

**Unrelated but adjacent: Row Level Security is disabled on all 25 tables in this
Supabase project**, including every stat table this view reads. Anyone holding the
anon key can read or modify any row. This predates the change and the server uses a
service-role key server-side, so nothing here makes it worse — but it should be
tracked and fixed separately. Enabling RLS without first writing policies would
block all access, so it needs its own scoped piece of work rather than a one-line
migration.
