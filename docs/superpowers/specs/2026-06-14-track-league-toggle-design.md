# Track page: league toggle + MLB data fix — 2026-06-14

## Goal
The TRACK nav (`/performance`) is NBA-only. Add a clean league toggle (NBA / MLB,
extensible to NHL / NFL) so the Track page works per-sport, and close the one MLB
data gap that affects it (`player_availability`).

## Background
- "TRACK" → `Performance.tsx`. Backend is already league-aware: perf routes are
  mounted at `/api/nba/performance` and `/api/mlb/performance`, controllers resolve
  the league from `res.locals.league`, and `mlbPerformanceApi` already exists in
  `client/src/services/api.ts`.
- Gaps are: (a) the frontend page hardcodes NBA, (b) two perf controller streak
  endpoints bake in NBA assumptions, (c) MLB `player_availability` is never populated.

## Decisions (locked)
- NHL/NFL appear in the toggle, clickable → "coming soon" empty state in the body.
- League selection is session-only React state, default NBA.
- Introduce a shared frontend league registry.

## Workstream A — Track page league toggle

### A1. New `client/src/config/leagues.ts`
Registry: `slug → { slug, label, available, perfApi?, streakStats? }`.
- nba → `performanceApi`, streakStats `pts/reb/ast/fg3m`.
- mlb → `mlbPerformanceApi`, streakStats `hits/tb/rbi`.
- nhl, nfl → `available: false`.
`streakStats[].key` must equal the backend `row.stat` keys; the list doubles as the
stat-filter chips AND the stats `StreakPerformanceCard` queries for tiers.

### A2. `Performance.tsx`
- `useState<LeagueSlug>('nba')`; resolve the `LeagueDef`.
- Segmented league toggle in the header (left of the period selector), existing
  mint-active button style. All four leagues shown.
- `!available` → render the existing `ComingSoon` component in place of data sections.
- Use `def.perfApi` instead of the imported `performanceApi`; refetch on league change.
- Replace hardcoded `STAT_FILTERS`/`StatFilter` with `def.streakStats` (+ an "All"
  chip); `streakStatFilter` becomes `string`.
- Reset pick/streak filters to defaults when league changes.

### A3. `StreakPerformanceCard.tsx`
Accept props `api: PerformanceApi` and `stats: string[]`, replacing hardcoded
`performanceApi` + `ALL_STATS` (default to NBA values for back-compat).

### A4. Backend `performanceController.ts`
Match the already-correct live streaks endpoint (`getPerfectStreaks`):
- `getStreakOutcomes`: replace hardcoded `nba_player_stats` + NBA columns +
  `minutes_played` with `lg.statsTable` / `streakStatsSelect(lg)` / `lg.playedGate`.
- `getStreakOutcomes` AND `getStreakPerformance`: replace the hardcoded gate
  `prior10[0] <= 0` with `prior10[lg.streakGateTierIndex] <= 0`, and clamp displayed
  tier lines with `lg.streakLineFloor` (so MLB shows "1+" and isn't filtered empty).

No DB or routing changes — mounts + `mlbPerformanceApi` already exist.

## Workstream B — MLB `player_availability`

### Fixable: generalize `analytics/batch/injury_check.py` for MLB
- Per-league config: `{ league_id, league_tag, espn_url, is_out(status) }`.
  - nba: ESPN basketball/nba, out = status in {"Out","Doubtful"}.
  - mlb: ESPN baseball/mlb, out = status contains "IL" (10/15/60-Day-IL).
    "Day-To-Day" stays eligible (mirrors NBA keeping "Questionable").
- `run_injury_check(target_date, league)`. New `--league` CLI arg, default `nba`
  (keeps the existing workflow call working unchanged).
- Wire an MLB step into `.github/workflows/injury-check.yml`
  (`--league mlb --date …`).

### NOT fixable: shallow MLB pick history
`pick_results` are forward-looking, generated from live Kalshi market snapshots.
No historical market data was captured, so authentic past picks can't be
reconstructed (fabricating them would corrupt edge/outcome integrity). Depth
accrues nightly. Out of scope; documented only.

## Testing
- Vitest: registry shape; `Performance` renders toggle, switches `perfApi`, shows
  ComingSoon for nhl/nfl.
- Typecheck + lint (max-warnings 0).
- Python: `injury_check --league mlb --verify` against ESPN; manual run for today
  populates `player_availability` for MLB (destructive Step 5 deletes injured-player
  picks — confirm before running against prod).

## Known limitation
MLB `player_availability` only reflects ESPN IL/injury data going forward; it does
not model daily lineup omissions. Acceptable parity with NBA.
