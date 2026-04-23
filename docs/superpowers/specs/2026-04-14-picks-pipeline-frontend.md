# StatTrak Picks Pipeline + Frontend Design

**Date:** 2026-04-14  
**Status:** Approved  
**Goal:** Wire the analytics engine (confidence scores, picks) to the Express API and frontend. Harden rate limiting in data scripts. Add cron jobs for nightly automation. Redesign PickOfTheDay to use real confidence scores with graceful fallback.

---

## Context

The analytics engine (`analytics/`) is fully built but never wired to the frontend. Key DB state as of 2026-04-14:

| Table | Rows | Notes |
|---|---|---|
| `players` | 571 | ✅ |
| `games` | 4,158 | ✅ 2022-25 only — missing 2025-26 |
| `nba_player_stats` | 15,090 | ⚠️ ~15% populated, stops 2025-03-27 |
| `nba_trends` | 3,629 | ✅ frontend already uses this |
| `daily_conditions` | 74 | ✅ yesterday's data only |
| `player_game_conditions` | 0 | ❌ `enrich_games.py` never run |
| `team_game_stats` | 0 | ❌ same |
| `opponent_position_defense` | 0 | ❌ same |
| `pick_results` | 0 | ❌ no picks generated |

**Core blocker:** `player_game_conditions` is empty — the backtest engine returns `None` for every player until `enrich_games.py` completes (hours-long run). Frontend must handle both states gracefully.

**Approach:** Parallel build — run data scripts in background, build frontend+backend now with a two-state design. When backtest data exists and picks are generated, they appear automatically.

---

## Section 1 — Data Pipeline + Script Hardening

### Season Gap Fix

Add `"2025-26"` to `SEASONS` in:
- `server/scripts/nba_init.py` — `SEASONS` list
- `analytics/db/connection.py` — `SEASONS` and `SEASON_INTS` lists

### Rate Limiting Fixes

**`server/scripts/nba_init.py`** — Currently only `time.sleep(0.6)`, no retry. Add `api_call_with_retry` wrapping all `nba_api` endpoint calls. Handle `Timeout`, `ConnectionError`, and `HTTPError` (including 429). Use exponential backoff: 5s base, 60s max, 5 retries.

**`server/scripts/resume_nba_stats.py`** — Same issue. Apply same `api_call_with_retry` pattern.

**`analytics/data/enrich_games.py`** — Has retry logic but only catches `Timeout` + `ConnectionError`. Add explicit handling for HTTP 429 responses from nba_api (which surfaces as `requests.exceptions.HTTPError` with status 429). On 429, backoff doubles.

**`analytics/kalshi/client.py`** — Already handles 429 correctly. ✅ No changes.

### Execution Order (user-run, long-running)

```bash
# Fill player_game_conditions + team_game_stats (hours)
python -m analytics.data.enrich_games --resume

# Fill opponent_position_defense (positions + defense rankings)
python -m analytics.data.enrich_games --positions

# Fill 2025-26 nba_player_stats
python server/scripts/resume_nba_stats.py
```

### Immediate Runs (fast)

```bash
# Compute daily_conditions for today
python -m analytics.batch.nightly --date 2026-04-14

# Generate picks (returns empty until backtest data exists — that's ok)
python -m analytics.picks.generate --date 2026-04-14
```

---

## Section 2 — Cron Jobs

**File:** `server/src/jobs/scheduler.ts`  
**Package:** `node-cron` (add to server dependencies)  
**Startup:** Imported and started in `server/src/server.ts`  
**Logging:** Appends to `server/logs/cron.log`. Errors are caught and logged — never crash the Express process.

All cron jobs spawn Python subprocesses pointing at the repo root with the venv Python.

| Cron | Time | Command | Purpose |
|---|---|---|---|
| `0 2 * * *` | 2:00am | `nightly.py` | Compute daily_conditions for today |
| `0 3 * * *` | 3:00am | `picks/generate.py` | Fetch Kalshi lines + backtest + score → pick_results |
| `0 12 * * *` | 12:00pm | `nightly.py` (reconcile step only) | Fill actual_result/did_hit on yesterday's picks |
| `0 * 10-23 * *` | Hourly 10am–11pm | `injury_check.py` | Validate picks against latest injury reports; re-run affected picks |

Python executable path resolved from env var `PYTHON_PATH` with fallback to `python`.

### Injury Validation — `analytics/batch/injury_check.py`

**Problem:** Injury reports change up to 90 minutes before tipoff. A pick generated at 3am may be invalid by 6pm if the player is ruled out.

**Data source:** ESPN injury API (same host already used for today's games):
`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries`
Returns player name, team, status (`Out`, `Questionable`, `Doubtful`, `Day-To-Day`).

**Logic:**
1. Fetch today's game times from `games` table (already stored). For each game not yet started (game_time > now), check is within the validation window.
2. Call ESPN injuries endpoint, parse player statuses.
3. Update `player_availability` table: `upsert (player_id, game_id, status)`.
4. Query `pick_results` for today — find picks where `entity_id` maps to a player now marked `Out`.
5. For each affected pick: **delete the pick row** (it is no longer valid — better to show no pick than a wrong one).
6. If any picks were deleted and unaffected picks still exist, the top pick updates automatically on next frontend fetch.
7. Log all changes: `[injury_check] {player_name} marked Out — pick id={X} removed`.

**Re-generation:** Does NOT re-run `generate.py` — removing the invalid pick is sufficient. The remaining picks in `pick_results` for today are still valid and the highest-confidence one surfaces as PickOfTheDay.

**`getTodaysPicks` endpoint** additionally LEFT JOINs `player_availability` and excludes any player with status `Out` for today's game, as a second line of defense.

**`games` table game_time column:** Currently `games` stores `game_date` but not `game_time`. The ESPN scoreboard API (already used) returns `comp.date` (ISO timestamp). The `get_slate` function in `nightly.py` inserts games — we add `game_time TIMESTAMPTZ` column to `games` and populate it during slate fetch. This lets `injury_check.py` know whether a game has already started (no point checking a game in progress).

---

## Section 3 — Backend Routes

### New routes in `server/src/routes/nba.ts`

```
GET /api/nba/picks/today          → getTodaysPicks
GET /api/nba/picks/player/:id     → getPlayerPicks
```

### `getTodaysPicks` — `server/src/controllers/nbaController.ts`

Queries `pick_results` for today's date, joins `players(name, team, position)`.  
Returns the single highest `confidence_score` pick as `topPick`, plus full `allPicks` array.  
**Always returns 200** — `{ topPick: null, allPicks: [] }` when table is empty.

Response shape:
```typescript
{
  topPick: Pick | null,
  allPicks: Pick[]
}

interface Pick {
  pickId: number
  playerId: number
  playerName: string
  team: string
  position: string
  stat: string          // "pts" | "reb" | "ast" | "fg3m"
  pickType: "safe" | "value"
  recommendedLine: number
  confidence: number    // 0-100
  edge: number          // e.g. 0.12
  hitRate: number       // e.g. 0.87
  impliedProb: number   // Kalshi market price
  sampleSize: number
  conditionsMatched: number
  totalConditions: number
}
```

### `getPlayerPicks` — `server/src/controllers/nbaController.ts`

Queries `pick_results` for a given `player_id`, last 30 days, ordered by `game_date desc`.  
Returns `Pick[]`. Returns `[]` when empty.

### `api.ts` additions

Add `Pick` interface and two new API methods:
```typescript
nbaApi.getTodaysPicks(): Promise<{ topPick: Pick | null, allPicks: Pick[] }>
nbaApi.getPlayerPicks(playerId: number): Promise<Pick[]>
```

---

## Section 4 — Frontend

### `PickOfTheDay` redesign

**File:** `client/src/components/Home/PickOfTheDay.tsx`

Fetches from `nbaApi.getTodaysPicks()` on mount. Two states:

**State A — Pick available (`topPick !== null`):**
- Card layout unchanged (radial glow, left/right columns, same border/bg tokens)
- **Right column big number:** `confidence` score (0–100) in mint Doto font (replaces rolling avg)
- **Right label:** `CONF` below the number
- **Left column:** player name → "OVER {line} {STAT_LABEL}" badge (mint border, condensed font) → edge bar
- **Edge bar:** Two-segment bar showing `impliedProb` vs `hitRate`. Labels: "MKT {X}%" left, "HIT {X}%" right
- **Pick type badge:** "SAFE" or "VALUE" in top-right corner of card (mint for SAFE, yellow for VALUE)
- Click navigates to `/player/:playerId` as before

**State B — No pick yet (`topPick === null`):**
- Same card dimensions, same border styling
- Center: "Analyzing today's slate..." text with `animate-pulse-live` dot
- Does not show a skeleton — the card is present but in "pending" state

**`TopTrending`:** No changes. ✅

### Stat label map addition

Add `"pts"`, `"reb"`, `"ast"`, `"fg3m"` mappings alongside existing `"points"`, `"rebounds"`, etc. since `pick_results.stat` uses the short form.

---

## Out of Scope

- PlayerDetailView picks history (getPlayerPicks wired but not surfaced in UI this session)
- Game props (total/spread) in picks — backtest supports it but UI will only surface player props for now
- Backtesting result display on frontend (hit rate history charts)
- Push notifications for picks

---

## Success Criteria

1. `scheduler.ts` starts with the server, cron schedule confirmed in logs
2. `GET /api/nba/picks/today` returns 200 with `topPick: null` when pick_results is empty
3. PickOfTheDay shows "Analyzing..." empty state cleanly when no picks
4. PickOfTheDay shows real confidence card once picks are generated
5. Rate limiting: `enrich_games.py` handles 429 without crashing
6. `2025-26` season added to both config files
7. `injury_check.py` removes picks for players marked Out; logs changes
8. `games` table has `game_time` column populated by `get_slate`
9. `getTodaysPicks` excludes Out players via `player_availability` join
10. Hourly injury cron runs 10am–11pm without crashing Express on error
