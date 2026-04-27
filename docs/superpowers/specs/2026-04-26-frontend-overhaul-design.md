# Frontend Overhaul — Design Spec
> Created: 2026-04-26  
> Status: Approved (brainstorm session)  
> Supersedes: none (new scope)

---

## Overview

Seven sub-projects that together take StatTrak from a functional prototype to a polished, intentional sports-data product. Executed in the order below because each build on the previous.

**Design principle (all sub-projects):** Less is more. Every visible element must earn its space — either through information density or clear visual hierarchy. No decorative chrome.

**Tooling rule (all frontend sub-projects):** Playwright MCP for browser verification, `frontend-design` skill for UI decisions, context7 for library docs.

---

## Execution Order

| # | Sub-project | Key deliverable |
|---|---|---|
| 1 | **Bugs** | Cron reliability, POTD freshness, TopTrending correctness |
| 2 | **G — Typography & Polish** | Font swap + global spacing/hierarchy pass |
| 3 | **E — NBA Page** | Full content expansion |
| 4 | **D — Player Explorer** | Redesigned `/player/:id` dashboard |
| 5 | **F — Game View** | New `/game/:id` with two states |
| 6 | **H — Team View** | New `/team/:id` |

---

## Shared Architecture

### Routes (additions to `App.tsx`)
```
/game/:id      → GameView component
/team/:id      → TeamView component
```

### Navigation graph
```
Sidebar game card ──────────────────→ GameView (upcoming or completed)
Player chart bar (click) ───────────→ GameView (completed, for that date)
GameView team name ─────────────────→ TeamView
PlayerDetailView team label ────────→ TeamView
TopTrending player row ─────────────→ PlayerDetailView (existing)
```

### Price source abstraction
All props data carries a `source: string` field (e.g. `'kalshi'`). The UI renders the source label dynamically — never hardcode `"Kalshi"` in component text. Designed to accommodate DraftKings, FanDuel, etc. without frontend changes.

### Edge sorting
Props tables sort by `edge = model_prob - implied_prob` descending within each tab bucket. Higher edge = model sees more discrepancy from market = shown first.

### Props tab bucketing
Tabs: `50 | 60 | 70 | 80 | 90` — each represents a 10-point implied-prob range (50 = 50–59%, 60 = 60–69%, etc.). Standard lines cluster at 50; alt lines appear at 70+. Tabs hide gracefully when a bucket has zero props.

---

## Sub-project 1 — Bugs

### Bug 1: Cron jobs not firing
- **Symptom**: Nightly pipeline (`analytics/batch/nightly.py`) not running reliably; `server/logs/cron.log` shows no recent `[cron:done]` entries.
- **Root cause**: `scheduler.ts` only runs while Express is alive — no process manager in place.
- **Fix**: Diagnose current scheduler state. If Express isn't running as a persistent process, install pm2 or add a system cron fallback (see `docs/RUNBOOK.md §3.5`). Verify with `pick_results.created_at` advancing daily.
- **Approval gate**: Confirm fix with user before changing deployment config — affects production.

### Bug 2: POTD not refreshing
- **Symptom**: `PickOfTheDay` component shows a stale pick across multiple days.
- **Likely cause**: `nbaApi.getTodaysPicks()` hits `/api/nba/picks/today` which returns cached or stale data. Either the pipeline isn't running (Bug 1 dependency) or the query isn't scoped to today's date.
- **Fix**: Ensure `/api/nba/picks/today` filters by `game_date = today`. Add a `created_at` freshness check — if newest pick is older than 24h, return empty so the UI shows "Analyzing today's slate..." rather than stale data.

### Bug 3: TopTrending — dedup + scope
- **Symptom**: Same player appears multiple times; players with no game today appear.
- **Fix**:
  1. Filter `nba_trends` query to only players whose `team_id` has a game today (`games.game_date = today AND games.league_id = 1`).
  2. Group by `player_id`, keep only the row with the highest `z_score` per player (their single top trending stat).
  3. Apply to both the `GET /api/nba/trends/top` endpoint and any other consumer of this data.

---

## Sub-project G — Typography & Design Polish

### Font system
| Role | Old | New |
|---|---|---|
| Display / hero numbers | Doto | **Doto** (keep — logo + confidence scores only) |
| Headings / labels / nav | Bebas Neue | **Space Grotesk** (Bold 700) |
| Body text | IBM Plex Sans | **Space Grotesk** (Regular 400, Medium 500) |
| Tabular numbers / stats | IBM Plex Mono | **Space Mono** |

**Google Fonts import**: `Space+Grotesk:wght@400;500;600;700` + `Space+Mono:wght@400;700`

Update `tailwind.config.js`:
- `font-condensed` → Space Grotesk 700 (replaces Bebas Neue)
- `font-sans` → Space Grotesk 400 (replaces IBM Plex Sans)
- `font-mono` → Space Mono — **override Tailwind's default system-mono stack** by setting `fontFamily.mono` in the config; this makes `font-mono` use Space Mono everywhere tabular numbers appear
- `font-display` → Doto (unchanged, logo only)

Update `client/src/index.css` font imports accordingly.

### Global polish rules
- **Label pattern**: `text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed` — tighten tracking, bump contrast slightly from `text-gray-600`
- **Card pattern**: `bg-[#0D0D0D] border border-[#161616] rounded-2xl` — unchanged; this is correct
- **Stat numbers**: wrap in `font-mono` class wherever tabular data appears (scores, percentages, z-scores, hit rates)
- **Spacing**: audit every page — no orphaned `p-5 space-y-4` catch-alls; each section gets explicit intentional padding
- **Color usage**: `mint` (orange `#FF5F2E`) for primary actions, live indicators, positive signals only. Do not use on neutral/informational text.
- Verify all changes in Playwright before marking complete.

---

## Sub-project E — NBA Page Content Expansion

### Layout (sequential scroll, full-width)
```
┌─────────────────────────────────────────────────────┐
│  POTD Row: [Player]  [Spread]  [Total]  [ML]        │  ← 4-col grid
├─────────────────────────────────────────────────────┤
│  Props                                              │
│  Tabs: Player Props | Spread | Total                │
│  Bucket tabs: 50 | 60 | 70 | 80 | 90               │
│  Table: sorted by edge desc, max 10 player / 5 each │
├─────────────────────────────────────────────────────┤
│  Streaks                                            │
│  Stat tabs: PTS | REB | AST | 3PM                  │
│  Window tabs: L3 | L5 | L10                        │
│  Top 10 rows                                        │
├─────────────────────────────────────────────────────┤
│  TrendFinder                                        │
├─────────────────────────────────────────────────────┤
│  TopTrending (deduped, today's players only)        │
└─────────────────────────────────────────────────────┘
```

### POTD cards (4× `PickOfTheDay` variants)
- All 4 share the same card layout as the current `PickOfTheDay.tsx`
- Each variant has a type label: `PLAYER` / `SPREAD` / `TOTAL` / `ML`
- `GET /api/nba/picks/top` already returns picks with `featured` flag for `spread`, `total`, and `ml` types (built in session 2026-04-23). Frontend currently only destructures `topPick` — update to destructure all four types: `playerPick`, `spreadPick`, `totalPick`, `mlPick`
- Cards are equal-width in a 4-column grid; wrap to 2×2 on narrow viewports

### Props table
- **Columns**: Player/Team, Stat/Line, Market %, Model %, Edge, Source label
- **Row count**: Player props ≤10, Spread ≤5, Total ≤5
- **Empty state**: "No props in this range today" when bucket is empty
- **Source label**: dynamic from `source` field — shown as a small badge, not inline text

### Streaks card
- Cross-tab: stat selector (PTS/REB/AST/3PM) × window selector (L3/L5/L10)
- 10 rows, each: player name, team, current streak length, streak direction (↑/↓), stat avg in window
- Endpoint: `GET /api/nba/streaks/perfect` (already exists)

### Sizing rule
If a bucket has fewer than its max rows, render what exists — no placeholder rows.

---

## Sub-project D — Player Explorer Dashboard

### Route
`/player/:id` (existing route, full redesign)

### Layout
```
┌─────────────────────────────────────────────────────┐
│  Player header: avatar initials, name, team, pos    │
│  Quick stats: season avgs for all 4 stats           │
├─────────────────────────────────────────────────────┤
│  Stat selector: PTS | REB | AST | 3PM (tab bar)    │
├─────────────────────────────────────────────────────┤
│  Game log chart (bar chart, last N games)           │
│  · Bars are CLICKABLE → navigate to /game/:id       │
│  · Threshold line (adjustable)                      │
│  · Game label shows opponent abbrev + date          │
│  · Window selector: L5 | L10 | L15 | L20           │
├─────────────────────────────────────────────────────┤
│  Summary row: Hit Rate | L{N} Avg | Best Game       │
├─────────────────────────────────────────────────────┤
│  Today's props for this player (if game today)      │
│  · Sourced from daily_lines, filtered by entity_id  │
│  · Same edge/market display as NBA props table      │
├─────────────────────────────────────────────────────┤
│  Z-score trend card (all 4 stats, mini sparklines)  │
└─────────────────────────────────────────────────────┘
```

### Bar click → Game View
When user clicks a bar:
- Look up `game_id` for that bar's `game_date` + player's `team_id`
- Navigate to `/game/:id` — GameView will render in "completed" state since the date is past
- Pass `{ from: 'player', playerId }` in router state for back-navigation

### Data requirements
- Game log needs `game_id` + opponent team abbrev per row — **verify** `nba_player_stats` has `game_id` column before implementing bar-click navigation; if absent, join via `games` on `game_date + team_id`. Bar clicks should be disabled until `game_id` is confirmed available
- Today's props: join `daily_lines` on `entity_id = player_id` (player props) filtered to today

---

## Sub-project F — Game View

### Route
`/game/:id` (new)

### Two states

**State: Upcoming** (game has not been played — `game_date >= today`)
```
┌─────────────────────────────────────────────────────┐
│  Game header: Away @ Home · Date · Status           │
│  Venue, tip-off time                                │
├─────────────────────────────────────────────────────┤
│  Starting 5 comparison (position-matched)          │
│  Away starters ←→ Home starters                    │
│  Per matchup: usage %, PPG, +/-, def rating        │
├─────────────────────────────────────────────────────┤
│  Bench comparison (same layout, collapsible)        │
├─────────────────────────────────────────────────────┤
│  Game context                                       │
│  · Defensive matchup rating (pts allowed vs pos)   │
│  · Pace, implied total, spread from props           │
├─────────────────────────────────────────────────────┤
│  Best props for this game                          │
│  · Top 5 player props (edge-sorted)                │
│  · Game props: spread + total                       │
└─────────────────────────────────────────────────────┘
```

**State: Completed** (game has been played — `game_date < today`)
```
┌─────────────────────────────────────────────────────┐
│  Game header + final score                         │
├─────────────────────────────────────────────────────┤
│  Box score: starters + bench, standard stats       │
├─────────────────────────────────────────────────────┤
│  Prop outcomes: hit ✓ / miss ✗ / push ~            │
│  · Shows the line, result, edge that was predicted  │
└─────────────────────────────────────────────────────┘
```

### State detection
Determine state by comparing `game_date` to today's date. If `game_date > today` → Upcoming. If `game_date <= today` AND score data exists → Completed. If `game_date <= today` AND no score → show Upcoming layout with "Results pending" note.

### Entry points
- Sidebar game card: navigate to `/game/:id`
- Player chart bar click: navigate to `/game/:id` (completed state for past games)

### Data requirements
- Starting lineups: not currently in DB — **approval gate**: need to decide data source (nba_api has lineup endpoint; add to schema or fetch on-demand)
- Usage rate, +/-: available in `nba_player_stats`
- Defensive matchup: derive from opponent team's `nba_trends` or fetch via nba_api
- Box score: `nba_player_stats` filtered by `game_id`

---

## Sub-project H — Team View

### Route
`/team/:id` (new)

### Layout
```
┌─────────────────────────────────────────────────────┐
│  Team header: name, record, conference              │
├─────────────────────────────────────────────────────┤
│  Game log (last 20 games)                          │
│  · Date, opponent, W/L, score, home/away           │
│  · Each row clickable → GameView                   │
├─────────────────────────────────────────────────────┤
│  Team splits                                        │
│  · Home vs Away                                    │
│  · Last 10 vs season                              │
│  · By opponent conference                          │
├─────────────────────────────────────────────────────┤
│  Roster (today's active players)                   │
│  · Each player row clickable → PlayerDetailView    │
└─────────────────────────────────────────────────────┘
```

### Entry points
- PlayerDetailView team label → `/team/:id`
- GameView team name → `/team/:id`

### Data requirements
- Team record + splits: derivable from `nba_player_stats` + `games` tables — **verify** coverage before building UI
- Roster: join `players` on `team_id`

---

## Open Items / Approval Gates

These require user sign-off before implementation proceeds:

| Item | Decision needed |
|---|---|
| Cron/deployment fix | Confirm deployment strategy (pm2 vs system cron) before changing |
| Starting lineups data source | nba_api lineup endpoint vs external source — schema change needed |
| Team record/splits coverage | Verify `games` table has enough history before building Team View |

---

## Implementation Notes

- All frontend sub-projects: use `frontend-design` skill + Playwright MCP verification + context7 for library docs
- Space Grotesk + Space Mono load via Google Fonts — add to `index.html` `<head>`, not CSS `@import` (faster)
- `font-condensed` in Tailwind config remapped to Space Grotesk 700 — this changes the look of every label using that class; verify all usages in Playwright after font swap
- Props table is the most data-dense new component — design for the empty/partial state first
