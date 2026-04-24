# Session resume — 2026-04-23

> Checkpoint for the next session. Supersedes `2026-04-22-session-resume.md`.
> To resume: read this file top to bottom, then decide which deferred item to pick up.

---

## What shipped this session

41 commits across four threads, all on `main`:

### A. Picks + streaks backend (sub-project B) — **DONE**
- `analytics/engine/game_model.py` — closed-form winner/margin/total math
- `analytics/engine/backtest.py::backtest_winner` — model self-accuracy replay for ML props
- `analytics/picks/generate.py` — winner props flow through the pipeline; latent `entity_id=None` bug fixed; scoped game-prop loop to current `game_id`
- `GET /api/nba/picks/top?limit=5` — 5 player + 5 game picks, `featured` flag for ML / Spread / Total
- `GET /api/nba/streaks/perfect?type=player|game&stat=…&window=…` — Perfect-N leaderboard
- SportQuery SSE `results` event extended with `shape` discriminator + `widening_note` (5 shapes + transparent today→next-slate fallback for picks/lines queries)
- Client: typed `nbaApi.getTopPicks` / `getPlayerStreaks` / `getGameStreaks`

### B. Shadcn migration (sub-project C) — **DONE**
- Phase 0: installed `DropdownMenu`, `Popover`, `Textarea`; fixed broken `tsconfig.json` path alias (root lacked `compilerOptions.paths`, so CLI wrote to literal `@/` folder)
- Phases 1–4 (14 components): SessionSwitcher, ChatInput, EmptyState, UserMessage, AssistantMessage, ResultCardList, CompactPlayerCard, TopTrending, TrendFinder, Sidebar, Header (with new arrow-key search nav), PickOfTheDay, PlayerDetailView stat selectors only
- Deleted unused `Footer/` + `Searchbar/` components
- All custom patterns preserved: animations (`animate-bar-grow` / `animate-pulse-live` / `animate-fade-up`), z-score color logic, VS-layout game cards, threshold-line overlay, font-condensed labels, orange mint accent, radial-gradient hero background

### C. Data-layer fixes
- Schema: added `daily_lines.team_id BIGINT REFERENCES teams(id)` + indexes
- Backfill: 428/428 team-bearing game-prop rows now have `team_id` (100%); `daily_lines.game_date` fixed to reflect ticker date instead of pipeline run-date
- Parser: `analytics/kalshi/client.py::parse_game_props` now extracts team from ticker suffix (`KXNBAGAME-26APR21HOULAL-HOU` → HOU); `_store_daily_lines` persists `team_id` going forward
- Direction logic: rewritten to `hit_rate >= implied_prob ? 'over' : 'under'` (was a broken line-vs-season_avg heuristic depending on `nba_trends` lookup)
- `cover_spread` streaks re-enabled using `team_id` filter
- `over_total` semantic shifted to team-scoped (uses `KXNBATEAMTOTAL` markets, not game combined totals) — UI copy should reflect that
- Dropped `cover_spread` backlog doc (the gap it described is now closed)

### D. Scheduler fixes + runbook
- `server/src/jobs/scheduler.ts`: fixed `REPO_ROOT` path (was 4 `..`s → spawned Python from *above* the repo), default to repo's venv Python, added 2:30am job to pre-sync next 7 days of games (closes the Kalshi-ahead-of-games gap)
- `docs/RUNBOOK.md`: full setup / dev / prod / cron / manual / troubleshoot guide

---

## Current codebase state

- **All tests passing.** 34/34 server vitest, client `npm run build` clean, `npm run lint` (max-warnings 0) clean.
- **Branch:** `main`. No uncommitted work.
- **Server deps:** `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover` added from Phase 0.
- **Client ui/ primitives:** `badge`, `button`, `card`, `dropdown-menu`, `input`, `popover`, `skeleton`, `tabs`, `textarea` — 9 total.
- **Theme tokens** (as of current `tailwind.config.js` / `index.css`):
  - `mint` = orange (`#FF5F2E`, wired through HSL `--primary: 14 100% 59%`)
  - Fonts: Doto (display), Bebas Neue (`font-condensed`), IBM Plex Sans (body)
  - Radius: `0.75rem`; dark palette uses custom hex (`#0D0D0D`, `#141414`, `#161616`, `#1E1E1E`) over shadcn's `--card`/`--popover` defaults
- **Data state (via Supabase MCP, 2026-04-23):**
  - `daily_lines`: 3573 rows; all team-bearing game-prop rows have `team_id`; 545 game-prop rows still NULL on `entity_id` because games are missing for 04-22/23/25/26/27
  - `games` (league_id=1): 04-20, 04-21, 04-24 populated; 04-22/23/25/26/27 missing → **blocks cover_spread / over_total streaks for those dates**
  - `pick_results`: 7 rows (all player, all safe) — pipeline sparse
  - `nba_trends`: 3629 rows (live)
  - `nba_player_stats`: 96,087 rows

---

## First priorities for the next session

In order of impact:

### 1. Run the games catch-up (5-minute task)
The cron gap is exactly why `entity_id` backfill only matched 67/612 rows. Run manually:

```bash
source venv/Scripts/activate
for date in 2026-04-22 2026-04-23 2026-04-25 2026-04-26 2026-04-27; do
  python -m analytics.batch.nightly --date $date
done
```

Then re-run the entity_id backfill SQL (saved below) and spot-check `daily_lines` coverage.

Backfill SQL (idempotent; skips already-populated rows):

```sql
-- Team-bearing props
WITH parsed AS (
  SELECT
    dl.id,
    dl.game_date AS g_date,
    (regexp_match(dl.market_ticker, '^KX[A-Z]+-\d{2}[A-Z]{3}\d{2}([A-Z]{3})([A-Z]{3})-[A-Z]{3}\d*$'))[1] AS abbr_a,
    (regexp_match(dl.market_ticker, '^KX[A-Z]+-\d{2}[A-Z]{3}\d{2}([A-Z]{3})([A-Z]{3})-[A-Z]{3}\d*$'))[2] AS abbr_b
  FROM daily_lines dl
  WHERE (dl.market_ticker LIKE 'KXNBAGAME-%' OR dl.market_ticker LIKE 'KXNBASPREAD-%' OR dl.market_ticker LIKE 'KXNBATEAMTOTAL-%')
    AND dl.entity_id IS NULL
)
UPDATE daily_lines dl
SET entity_id = g.id
FROM parsed p
JOIN games g ON g.game_date = p.g_date AND g.league_id = 1
JOIN teams home_t ON home_t.id = g.home_team_id
JOIN teams away_t ON away_t.id = g.away_team_id
WHERE dl.id = p.id
  AND ((home_t.abbreviation = p.abbr_a AND away_t.abbreviation = p.abbr_b)
    OR (home_t.abbreviation = p.abbr_b AND away_t.abbreviation = p.abbr_a));

-- 1H/2H totals (no team suffix)
WITH parsed AS (
  SELECT
    dl.id,
    dl.game_date AS g_date,
    (regexp_match(dl.market_ticker, '^KXNBA[12]HTOTAL-\d{2}[A-Z]{3}\d{2}([A-Z]{3})([A-Z]{3})-\d+$'))[1] AS abbr_a,
    (regexp_match(dl.market_ticker, '^KXNBA[12]HTOTAL-\d{2}[A-Z]{3}\d{2}([A-Z]{3})([A-Z]{3})-\d+$'))[2] AS abbr_b
  FROM daily_lines dl
  WHERE (dl.market_ticker LIKE 'KXNBA1HTOTAL-%' OR dl.market_ticker LIKE 'KXNBA2HTOTAL-%')
    AND dl.entity_id IS NULL
)
UPDATE daily_lines dl
SET entity_id = g.id
FROM parsed p
JOIN games g ON g.game_date = p.g_date AND g.league_id = 1
JOIN teams home_t ON home_t.id = g.home_team_id
JOIN teams away_t ON away_t.id = g.away_team_id
WHERE dl.id = p.id
  AND ((home_t.abbreviation = p.abbr_a AND away_t.abbreviation = p.abbr_b)
    OR (home_t.abbreviation = p.abbr_b AND away_t.abbreviation = p.abbr_a));
```

### 2. Start the server under a process manager (or confirm scheduler is firing)
The scheduler only runs while the Express server is alive. Current state: unknown. Decide deployment strategy (pm2 / systemd / Docker / system cron fallback per `docs/RUNBOOK.md` §3.5) and make cron actually run daily.

After one successful nightly cycle, verify:
- `pick_results.created_at` advanced (shows today's date)
- `daily_lines` has rows extending 7 days into future
- `server/logs/cron.log` shows `[cron:done] nightly (exit 0)` etc.

### 3. Sub-project D — PlayerDetailView redesign
The last piece of the original four-sub-project brainstorm. The current `PlayerDetailView.tsx` has a custom bar chart + threshold line + summary grid. Sub-project D is the "from-scratch dashboard" rewrite. No spec written yet — start with brainstorming skill.

---

## Deferred / backlog

| Item | Why deferred | Where to find |
|---|---|---|
| `model_prob` column on `pick_results` | Needs schema change + pipeline work; UI currently ok with nullable `implied_prob` + `edge` | Spec §"Open items intentionally deferred" in `2026-04-22-picks-streaks-backend-design.md` |
| N+1 batching in `getGamePerfectStreaks` total-line lookups | Current serial awaits inside per-team Promise.all work for typical slate size; only hurts at scale | Review comment in Task 7 thread |
| `picksController.ts` split (~580 lines now) | Cohesive but growing; optional `streaksController.ts` is a clean refactor | Plan §"Code organization" |
| Integration tests for new endpoints | No vitest tests for `/picks/top` or `/streaks/perfect`; existing suite is backend-only unit tests | — |
| pytest for `game_model.py` | `__main__` self-test runs, but not in any CI-collected suite | — |
| Kalshi player-name mapping gaps | 90 `daily_lines` player-prop rows with NULL `entity_id` — all legacy `NBA-MOCK-*` data from 2025-04-13; safe to delete or leave | — |
| `computeNBATrends.ts` scheduling | Currently manual; add to `scheduler.ts` once happy with nightly cadence | `scheduler.ts` |
| Full sub-project D (PlayerDetailView rewrite) | Brainstorm not yet started | Inventory: `2026-04-22-shadcn-migration-inventory.md` §"High-Risk Files" |

---

## Key files to know about

- `server/src/jobs/scheduler.ts` — cron definitions (5 jobs)
- `server/src/controllers/picksController.ts` — `/picks/top`, `/streaks/perfect` (~580 lines, getting big)
- `server/src/controllers/nbaController.ts` — existing `/trends/top`, `/picks/today`, etc.
- `server/src/services/sportqueryEnrich.ts` + `sportquery.ts` — shape-aware SSE envelope
- `analytics/engine/game_model.py` — closed-form math (pure + DB-bound helpers)
- `analytics/engine/backtest.py` — `backtest_player`, `backtest_game_prop`, `backtest_winner`
- `analytics/picks/generate.py` — the nightly pipeline
- `analytics/kalshi/client.py` — Kalshi market parsing (now extracts team from ticker)
- `client/src/services/api.ts` — typed client methods + response interfaces
- `docs/RUNBOOK.md` — operations guide, start here for "how do I…" questions

---

## Tooling notes for next session

- **Supabase MCP is reliable.** `list_tables` row counts are stale (pg_stats); always confirm with `SELECT COUNT(*)` when the number matters. `execute_sql` for DML, `apply_migration` for DDL.
- **context7 MCP for shadcn docs.** The CLI is `npx shadcn@latest` (not `shadcn-ui`). This session confirmed via `/shadcn-ui/ui` library ID.
- **Shadcn CLI gotcha:** root `tsconfig.json` needs `compilerOptions.paths` even when project uses references. Already fixed in this repo (commit `5446dec`).
- **Data-engine rule (feedback memory):** no silent failures — every fallback path should log. All `WARN` lines in the pipeline respect this; don't regress.
- **Autonomous-execution preference (feedback memory):** once a plan is approved, execute end-to-end without per-task approval gates. Pause only for destructive actions, plan deviations, or genuine blockers.

---

## How to resume

1. Read this file.
2. Check `git log --oneline -20` for the most recent context.
3. Run `npm run dev:both` to verify app still boots.
4. Decide which of the "First priorities" (§1 / §2 / §3) to tackle based on current user need.
5. If starting sub-project D, invoke the brainstorming skill and use `docs/superpowers/specs/2026-04-22-shadcn-migration-inventory.md` §"High-Risk Files" as input context.
