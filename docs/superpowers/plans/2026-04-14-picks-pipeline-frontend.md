# Picks Pipeline + Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the full analytics picks pipeline (confidence scores, injury validation, Kalshi lines) to the Express API and redesign PickOfTheDay to show real picks with graceful fallback.

**Architecture:** Python scripts run nightly via node-cron spawning subprocesses in Express. Pick data flows: nba_api → Supabase → backtest engine → scorer → pick_results table → Express API → React frontend. Injury check runs hourly via ESPN API, removes invalidated picks. Frontend PickOfTheDay fetches from `/api/nba/picks/today` and shows confidence score (0–100) or an "Analyzing..." empty state.

**Tech Stack:** Python 3.10+, nba_api, supabase-py, requests (Python); node-cron, child_process (Node/TypeScript); React 18 + TypeScript + Tailwind (frontend)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `analytics/db/connection.py` | Add 2025-26 season |
| Modify | `server/scripts/nba_init.py` | Add retry helper + 2025-26 season |
| Modify | `server/scripts/resume_nba_stats.py` | Add 429 handling + 2025-26 season |
| Modify | `analytics/data/enrich_games.py` | Add 429 handling to api_call_with_retry |
| Create | `analytics/batch/injury_check.py` | Hourly ESPN injury validation + pick removal |
| Create | `server/src/jobs/scheduler.ts` | node-cron job runner |
| Modify | `server/src/server.ts` | Start scheduler on boot |
| Modify | `server/package.json` | Add node-cron dependency |
| Modify | `server/src/controllers/nbaController.ts` | Add getTodaysPicks + getPlayerPicks |
| Modify | `server/src/routes/nba.ts` | Add picks routes |
| Modify | `client/src/services/api.ts` | Add Pick interface + getTodaysPicks/getPlayerPicks |
| Modify | `client/src/components/Home/PickOfTheDay.tsx` | Confidence score card + empty state |

---

## Task 1: Add 2025-26 to Season Configs

**Files:**
- Modify: `analytics/db/connection.py:37-38`
- Modify: `server/scripts/nba_init.py:33`
- Modify: `server/scripts/resume_nba_stats.py:17`

- [ ] **Step 1: Update analytics/db/connection.py**

Replace lines 37–38:
```python
SEASONS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
SEASON_INTS = [2019, 2020, 2021, 2022, 2023, 2024, 2025]
```

- [ ] **Step 2: Update server/scripts/nba_init.py**

Replace line 33:
```python
SEASONS = ['2022-23', '2023-24', '2024-25', '2025-26']
```

- [ ] **Step 3: Update server/scripts/resume_nba_stats.py**

Replace line 17:
```python
SEASONS = ['2022-23', '2023-24', '2024-25', '2025-26']
```

- [ ] **Step 4: Verify**

```bash
cd C:/Users/trein/vscode/stat-trak-app-main
python -c "from analytics.db.connection import SEASONS; print(SEASONS)"
```
Expected: `['2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26']`

- [ ] **Step 5: Commit**

```bash
git add analytics/db/connection.py server/scripts/nba_init.py server/scripts/resume_nba_stats.py
git commit -m "feat: add 2025-26 season to all data pipeline configs"
```

---

## Task 2: Harden enrich_games.py for HTTP 429

**Files:**
- Modify: `analytics/data/enrich_games.py:84-107`

The current `api_call_with_retry` only catches `ReadTimeout` and `ConnectionError`. nba_api can surface rate limiting (429) as a generic Exception with "429" or "Too Many Requests" in the message. We need to retry those too with longer backoff instead of giving up.

- [ ] **Step 1: Replace api_call_with_retry**

In `analytics/data/enrich_games.py`, replace the entire `api_call_with_retry` function (lines 84–107):

```python
def api_call_with_retry(call_fn, description: str) -> Optional[Any]:
    """
    Call call_fn() with exponential backoff on network errors and HTTP 429.

    Returns the result of call_fn() or None after MAX_RETRIES failures.
    Always sleeps API_DELAY_SECONDS before the first attempt and between retries.
    On HTTP 429 (rate limit), uses double backoff and does not count against retries.
    """
    rate_limit_hits = 0
    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(API_DELAY_SECONDS)
        try:
            return call_fn()
        except (ReadTimeout, ConnectionError) as exc:
            wait = min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_MAX_SECONDS)
            print(
                f"  WARNING [{description}] attempt {attempt}/{MAX_RETRIES} "
                f"failed ({type(exc).__name__}). Waiting {wait}s ..."
            )
            time.sleep(wait)
        except Exception as exc:
            exc_str = str(exc).lower()
            if "429" in exc_str or "rate limit" in exc_str or "too many requests" in exc_str:
                rate_limit_hits += 1
                wait = min(BACKOFF_BASE_SECONDS * (2 ** rate_limit_hits), BACKOFF_MAX_SECONDS)
                print(
                    f"  WARNING [{description}] HTTP 429 rate limited "
                    f"(hit #{rate_limit_hits}). Waiting {wait}s ..."
                )
                time.sleep(wait)
                # Do not count this against MAX_RETRIES — decrement attempt counter
                attempt -= 1  # noqa: SIM113 — intentional retry reset
            else:
                print(f"  ERROR [{description}] unexpected error: {exc}")
                return None
    print(f"  ERROR [{description}] all {MAX_RETRIES} retries exhausted. Skipping.")
    return None
```

- [ ] **Step 2: Verify import — requests.exceptions already imported**

Check line 22 of `analytics/data/enrich_games.py` already has:
```python
from requests.exceptions import ConnectionError, ReadTimeout
```
No new imports needed. ✅

- [ ] **Step 3: Smoke test**

```bash
cd C:/Users/trein/vscode/stat-trak-app-main
python -c "
from analytics.data.enrich_games import api_call_with_retry

def fail_with_429():
    raise Exception('HTTP Error 429: Too Many Requests')

result = api_call_with_retry(fail_with_429, 'test-429')
print('Result:', result)  # should be None after retries
"
```
Expected: prints multiple `WARNING ... HTTP 429 rate limited` lines then `ERROR ... all 5 retries exhausted`, then `Result: None`.

- [ ] **Step 4: Commit**

```bash
git add analytics/data/enrich_games.py
git commit -m "fix: handle HTTP 429 rate limiting in enrich_games api_call_with_retry"
```

---

## Task 3: Harden resume_nba_stats.py for HTTP 429

**Files:**
- Modify: `server/scripts/resume_nba_stats.py:36-47`

The `fetch_player_game_log_with_retry` function's `except Exception` block gives up immediately. Add 429 detection.

- [ ] **Step 1: Update the except Exception block**

In `server/scripts/resume_nba_stats.py`, replace lines 36–47 (the two `except` blocks in `fetch_player_game_log_with_retry`):

```python
        except (ReadTimeout, ConnectionError) as e:
            wait_time = min(2 ** attempt * 5, 120)  # 5s, 10s, 20s, 40s, 80s, max 120s
            if attempt < max_retries - 1:
                print(f"      ⏳ Timeout attempt {attempt + 1}/{max_retries}, waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"      ❌ Failed after {max_retries} attempts, skipping")
                return pd.DataFrame()

        except Exception as e:
            exc_str = str(e).lower()
            if "429" in exc_str or "rate limit" in exc_str or "too many requests" in exc_str:
                wait_time = min(2 ** (attempt + 2) * 5, 120)  # longer backoff for rate limits
                print(f"      ⏳ Rate limited attempt {attempt + 1}/{max_retries}, waiting {wait_time}s...")
                time.sleep(wait_time)
                if attempt >= max_retries - 1:
                    print(f"      ❌ Rate limited, failed after {max_retries} attempts")
                    return pd.DataFrame()
            else:
                print(f"      ❌ Error: {str(e)[:100]}")
                return pd.DataFrame()
```

- [ ] **Step 2: Verify**

```bash
cd C:/Users/trein/vscode/stat-trak-app-main
python -c "
import sys
sys.path.insert(0, 'server/scripts')
# Just verify the file parses cleanly
import ast
with open('server/scripts/resume_nba_stats.py') as f:
    ast.parse(f.read())
print('Syntax OK')
"
```
Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add server/scripts/resume_nba_stats.py
git commit -m "fix: handle HTTP 429 in resume_nba_stats retry logic"
```

---

## Task 4: Add Retry to nba_init.py + 429 Handling

**Files:**
- Modify: `server/scripts/nba_init.py`

`nba_init.py` uses only `time.sleep(0.6)` with no retry anywhere. Add an `_api_call_with_retry` helper and wrap the `playergamelog.PlayerGameLog(...)` call inside `fetch_and_insert_player_stats`.

- [ ] **Step 1: Add retry helper after the imports block in nba_init.py**

After line 21 (`# Load environment variables`) block, add this function before `get_or_create_league`:

```python
def _api_call_with_retry(call_fn, description: str, max_retries: int = 5):
    """
    Call call_fn() with exponential backoff. Handles timeouts, connection errors,
    and HTTP 429 rate limiting. Returns None after max_retries failures.
    """
    import time as _time
    from requests.exceptions import ReadTimeout, ConnectionError as ReqConnError
    rate_limit_hits = 0
    for attempt in range(1, max_retries + 1):
        _time.sleep(0.6)
        try:
            return call_fn()
        except (ReadTimeout, ReqConnError) as exc:
            wait = min(5 * (2 ** (attempt - 1)), 60)
            print(f"    ⏳ [{description}] attempt {attempt}/{max_retries} failed ({type(exc).__name__}). Waiting {wait}s...")
            _time.sleep(wait)
        except Exception as exc:
            exc_str = str(exc).lower()
            if "429" in exc_str or "rate limit" in exc_str or "too many requests" in exc_str:
                rate_limit_hits += 1
                wait = min(5 * (2 ** (rate_limit_hits + 1)), 60)
                print(f"    ⏳ [{description}] rate limited (hit #{rate_limit_hits}). Waiting {wait}s...")
                _time.sleep(wait)
                attempt -= 1
            else:
                print(f"    ❌ [{description}] unexpected error: {exc}")
                return None
    print(f"    ❌ [{description}] all {max_retries} retries exhausted.")
    return None
```

- [ ] **Step 2: Wrap the PlayerGameLog call in fetch_and_insert_player_stats**

In `fetch_and_insert_player_stats`, find the block at ~line 393:
```python
                    gamelog = playergamelog.PlayerGameLog(
                        player_id=player_ext_id,
                        season=season,
                        season_type_all_star='Regular Season'
                    )
                    df = gamelog.get_data_frames()[0]
```

Replace with:
```python
                    def _call(pid=player_ext_id, s=season):
                        return playergamelog.PlayerGameLog(
                            player_id=pid,
                            season=s,
                            season_type_all_star='Regular Season',
                        )
                    result = _api_call_with_retry(_call, f"{player_name} {season}")
                    if result is None:
                        print(f"    → {season}: SKIPPED (API failure)")
                        continue
                    df = result.get_data_frames()[0]
```

Also remove the `time.sleep(0.6)` on line ~393 (now handled by `_api_call_with_retry`).

- [ ] **Step 3: Verify syntax**

```bash
python -c "
import ast
with open('server/scripts/nba_init.py') as f:
    ast.parse(f.read())
print('Syntax OK')
"
```
Expected: `Syntax OK`

- [ ] **Step 4: Commit**

```bash
git add server/scripts/nba_init.py
git commit -m "fix: add retry + 429 handling to nba_init.py data fetch"
```

---

## Task 5: Write injury_check.py

**Files:**
- Create: `analytics/batch/injury_check.py`

Fetches ESPN injury reports hourly, updates `player_availability`, removes `pick_results` rows for players marked Out/Doubtful before their games tip off. Uses ESPN scoreboard to skip games already in progress.

- [ ] **Step 1: Create the file**

```python
"""
analytics/batch/injury_check.py

Hourly injury validation for StatTrak.

Steps:
  1. Fetch today's game states from ESPN scoreboard.
     Skip if no pre-game games remain (all in progress or finished).
  2. Fetch injury reports from ESPN injuries endpoint.
  3. Identify Out/Doubtful players on pre-game teams.
  4. Upsert player_availability rows for affected players.
  5. Delete pick_results rows for Out players today.

NOTE: The ESPN injuries endpoint structure should be verified against a live
response before deploying. Run `python -m analytics.batch.injury_check --verify`
to print the raw ESPN response for inspection.

CLI:
    python -m analytics.batch.injury_check
    python -m analytics.batch.injury_check --date 2026-04-14
    python -m analytics.batch.injury_check --verify
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta
from typing import Optional

import requests

from analytics.db.connection import NBA_LEAGUE_ID, supabase

ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"

# Statuses treated as "player is not playing today" — pick is invalid
OUT_STATUSES = {"Out", "Doubtful"}

REQUEST_TIMEOUT = 10  # seconds


# ── ESPN helpers ───────────────────────────────────────────────────────────────

def _espn_get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET request to ESPN API. Returns parsed JSON or None on failure."""
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        print(f"  WARNING: ESPN request failed ({url}): {exc}")
        return None


def fetch_game_states(target_date: date) -> dict[str, str]:
    """
    Fetch game states from ESPN scoreboard for target_date.

    Returns dict: {team_abbreviation_upper: state}
    where state is one of: "pre", "in", "post".
    Teams not playing today are absent from the dict.
    """
    date_str = target_date.strftime("%Y%m%d")
    data = _espn_get(ESPN_SCOREBOARD_URL, params={"dates": date_str})
    if not data:
        return {}

    states: dict[str, str] = {}
    for event in data.get("events", []):
        state = event.get("status", {}).get("type", {}).get("state", "pre")
        comp = (event.get("competitions") or [{}])[0]
        for competitor in comp.get("competitors", []):
            abbr = (competitor.get("team") or {}).get("abbreviation", "").upper()
            if abbr:
                states[abbr] = state
    return states


def fetch_injuries() -> list[dict]:
    """
    Fetch injury data from ESPN injuries endpoint.

    Returns list of team-level injury dicts. Structure:
    [
      {
        "team": {"abbreviation": "LAL"},
        "injuries": [
          {"athlete": {"displayName": "LeBron James"}, "status": "Out", ...},
          ...
        ]
      },
      ...
    ]
    Returns empty list on failure.
    """
    data = _espn_get(ESPN_INJURIES_URL)
    if not data:
        return []
    # ESPN may nest under "injuries" key or return a list directly
    injuries = data.get("injuries") or []
    return injuries


# ── Main logic ─────────────────────────────────────────────────────────────────

def run_injury_check(target_date: date) -> None:
    date_str = target_date.strftime("%Y-%m-%d")
    print(f"[injury_check] {date_str}")

    # Step 1: Get game states
    team_states = fetch_game_states(target_date)
    pre_game_teams = {abbr for abbr, state in team_states.items() if state == "pre"}

    if not pre_game_teams:
        print("  All games in progress or complete — nothing to validate.")
        return

    print(f"  Pre-game teams: {sorted(pre_game_teams)}")

    # Step 2: Fetch injuries
    injury_entries = fetch_injuries()
    if not injury_entries:
        print("  No injury data available. Skipping.")
        return

    # Step 3: Build name_lower -> status for Out/Doubtful players on pre-game teams
    out_players: dict[str, str] = {}
    for team_entry in injury_entries:
        team_abbr = (team_entry.get("team") or {}).get("abbreviation", "").upper()
        if team_abbr not in pre_game_teams:
            continue
        for inj in team_entry.get("injuries") or []:
            status = inj.get("status", "")
            if status in OUT_STATUSES:
                name = (inj.get("athlete") or {}).get("displayName", "")
                if name:
                    out_players[name.lower()] = status
                    print(f"    {name} — {status}")

    if not out_players:
        print("  No Out/Doubtful players on pre-game teams.")
        return

    # Step 4: Resolve player IDs from DB
    player_rows = (
        supabase.table("players")
        .select("id,name,team")
        .eq("league", "nba")
        .eq("is_active", True)
        .execute()
    )
    name_to_player: dict[str, dict] = {
        r["name"].lower(): r for r in (player_rows.data or [])
    }

    affected: list[dict] = []
    for name_lower in out_players:
        player = name_to_player.get(name_lower)
        if player:
            affected.append(player)
        else:
            print(f"  WARNING: '{name_lower}' not found in DB — skipping")

    if not affected:
        print("  No matching DB records for affected players.")
        return

    affected_ids = [p["id"] for p in affected]

    # Step 5: Resolve game IDs for today
    game_rows = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id")
        .eq("game_date", date_str)
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    team_to_game: dict[int, int] = {}
    for g in (game_rows.data or []):
        team_to_game[g["home_team_id"]] = g["id"]
        team_to_game[g["away_team_id"]] = g["id"]

    # Build team abbreviation -> team DB id map
    team_abbr_rows = (
        supabase.table("teams")
        .select("id,abbreviation")
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    abbr_to_team_id: dict[str, int] = {
        r["abbreviation"].upper(): r["id"] for r in (team_abbr_rows.data or [])
    }

    # Step 6: Upsert player_availability
    avail_rows: list[dict] = []
    for player in affected:
        team_abbr = (player.get("team") or "").upper()
        team_id = abbr_to_team_id.get(team_abbr)
        if not team_id:
            continue
        game_id = team_to_game.get(team_id)
        if not game_id:
            continue
        avail_rows.append({
            "player_id": player["id"],
            "game_id": game_id,
            "status": "out",
        })

    if avail_rows:
        supabase.table("player_availability").upsert(
            avail_rows, on_conflict="player_id,game_id"
        ).execute()
        print(f"  Updated player_availability: {len(avail_rows)} row(s).")

    # Step 7: Remove pick_results for Out players today
    picks_res = (
        supabase.table("pick_results")
        .select("id,entity_id,stat")
        .eq("game_date", date_str)
        .in_("entity_id", affected_ids)
        .execute()
    )
    picks_to_remove = picks_res.data or []

    removed = 0
    for pick in picks_to_remove:
        supabase.table("pick_results").delete().eq("id", pick["id"]).execute()
        print(f"  Removed pick id={pick['id']} player={pick['entity_id']} stat={pick['stat']}")
        removed += 1

    print(f"  Done. {removed} pick(s) removed.")


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="StatTrak injury validation")
    parser.add_argument("--date", type=str, default=None, help="YYYY-MM-DD (default: today)")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Print raw ESPN responses and exit (for debugging response structure)",
    )
    args = parser.parse_args()

    if args.verify:
        import json
        print("=== ESPN Injuries ===")
        data = _espn_get(ESPN_INJURIES_URL)
        print(json.dumps(data, indent=2)[:3000])
        print("\n=== ESPN Scoreboard (today) ===")
        today_str = date.today().strftime("%Y%m%d")
        data2 = _espn_get(ESPN_SCOREBOARD_URL, params={"dates": today_str})
        print(json.dumps(data2, indent=2)[:3000])
        return 0

    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(f"ERROR: invalid date '{args.date}'. Use YYYY-MM-DD.")
            return 1
    else:
        target_date = date.today()

    run_injury_check(target_date)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify ESPN response structure**

```bash
cd C:/Users/trein/vscode/stat-trak-app-main
python -m analytics.batch.injury_check --verify
```

Review the printed JSON. Confirm:
- The injuries list is at `data["injuries"]` (or adjust `fetch_injuries()` if nested differently)
- Team abbreviation is at `team_entry["team"]["abbreviation"]`
- Player name is at `inj["athlete"]["displayName"]`
- Status field name is `"status"` with values like `"Out"`, `"Doubtful"`, `"Questionable"`

If the structure differs, update `fetch_injuries()` and `run_injury_check()` accordingly before continuing.

- [ ] **Step 3: Test with today's date**

```bash
python -m analytics.batch.injury_check --date 2026-04-14
```

Expected output: lists pre-game teams, any Out/Doubtful players, and reports 0 picks removed (since pick_results is currently empty — that's fine).

- [ ] **Step 4: Commit**

```bash
git add analytics/batch/injury_check.py
git commit -m "feat: add hourly injury validation script with ESPN data + pick removal"
```

---

## Task 6: Install node-cron + Write scheduler.ts

**Files:**
- Modify: `server/package.json`
- Create: `server/src/jobs/scheduler.ts`
- Create: `server/logs/.gitkeep`

- [ ] **Step 1: Install node-cron**

```bash
cd server
npm install node-cron
npm install --save-dev @types/node-cron
```

Verify `server/package.json` now lists `"node-cron"` in dependencies.

- [ ] **Step 2: Create logs directory**

```bash
mkdir -p server/logs
touch server/logs/.gitkeep
echo "server/logs/*.log" >> .gitignore
```

- [ ] **Step 3: Create server/src/jobs/scheduler.ts**

```typescript
import * as cron from 'node-cron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const LOG_DIR  = path.resolve(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'cron.log');
const PYTHON   = process.env.PYTHON_PATH || 'python';

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string): void {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore write failures */ }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function runPython(moduleArgs: string[], label: string): Promise<void> {
  return new Promise((resolve) => {
    log(`[cron:start] ${label}`);
    const child = spawn(PYTHON, ['-m', ...moduleArgs], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    child.stdout.on('data', (d: Buffer) =>
      log(`[${label}] ${d.toString().trimEnd()}`));
    child.stderr.on('data', (d: Buffer) =>
      log(`[${label}:err] ${d.toString().trimEnd()}`));
    child.on('close', (code: number | null) =>
      log(`[cron:done] ${label} (exit ${code ?? '?'})`));
    child.on('error', (err: Error) => {
      log(`[cron:spawn-error] ${label}: ${err.message}`);
      resolve();
    });
    child.on('close', () => resolve());
  });
}

export function startScheduler(): void {
  ensureLogDir();
  log('[cron] Scheduler starting — registering jobs...');

  // 2:00am — compute daily_conditions for today
  cron.schedule('0 2 * * *', async () => {
    try {
      await runPython(['analytics.batch.nightly', '--date', todayStr()], 'nightly');
    } catch (err) {
      log(`[cron:error] nightly: ${err}`);
    }
  });

  // 3:00am — generate picks (Kalshi lines + backtest + score)
  cron.schedule('0 3 * * *', async () => {
    try {
      await runPython(['analytics.picks.generate', '--date', todayStr()], 'picks');
    } catch (err) {
      log(`[cron:error] picks: ${err}`);
    }
  });

  // 12:00pm — reconcile yesterday's picks (fill actual_result/did_hit)
  cron.schedule('0 12 * * *', async () => {
    try {
      await runPython(
        ['analytics.batch.nightly', '--date', yesterdayStr()],
        'reconcile'
      );
    } catch (err) {
      log(`[cron:error] reconcile: ${err}`);
    }
  });

  // Hourly 10am–11pm — injury validation + pick invalidation
  cron.schedule('0 10-23 * * *', async () => {
    try {
      await runPython(
        ['analytics.batch.injury_check', '--date', todayStr()],
        'injury_check'
      );
    } catch (err) {
      log(`[cron:error] injury_check: ${err}`);
    }
  });

  log('[cron] All 4 jobs registered.');
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd ..
git add server/package.json server/package-lock.json server/src/jobs/scheduler.ts server/logs/.gitkeep .gitignore
git commit -m "feat: add node-cron scheduler with nightly, picks, reconcile, and injury_check jobs"
```

---

## Task 7: Integrate Scheduler with Express Server

**Files:**
- Modify: `server/src/server.ts`

- [ ] **Step 1: Add scheduler import and startup call**

In `server/src/server.ts`, replace the entire file with:

```typescript
export {};
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

import { startScheduler } from './jobs/scheduler';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

app.get('/health', (req: any, res: any) => {
  res.json({
    status: 'OK',
    message: 'StatTrak API is running!',
    timestamp: new Date().toISOString()
  });
});

const nbaRoutes = require('./routes/nba');
app.use('/api/nba', nbaRoutes);

app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`NBA trends: http://localhost:${PORT}/api/nba/trends/top`);
  startScheduler();
});
```

- [ ] **Step 2: Verify server starts**

```bash
cd server
npm run dev
```

Expected: server starts on port 3000 AND logs `[cron] All 4 jobs registered.`

- [ ] **Step 3: Commit**

```bash
cd ..
git add server/src/server.ts
git commit -m "feat: start cron scheduler on Express server boot"
```

---

## Task 8: Add getTodaysPicks + getPlayerPicks to nbaController.ts

**Files:**
- Modify: `server/src/controllers/nbaController.ts`

- [ ] **Step 1: Add PICK_STAT_LABELS constant after STAT_NAMES**

In `server/src/controllers/nbaController.ts`, after line 6 (the `STAT_NAMES` block), add:

```typescript
const PICK_STAT_LABELS: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM',
};
```

- [ ] **Step 2: Add getTodaysPicks function**

Add this function before the final export statements (at the end of the file):

```typescript
export async function getTodaysPicks(req: any, res: any) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Fetch player picks for today, ordered by confidence descending
    const { data: pickRows, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id, entity_id, stat, pick_type, recommended_line, hit_rate, ' +
        'sample_size, confidence_score, implied_prob, edge, ' +
        'conditions_matched, total_conditions'
      )
      .eq('game_date', today)
      .eq('prop_type', 'player')
      .order('confidence_score', { ascending: false });

    if (error) throw error;

    if (!pickRows || pickRows.length === 0) {
      return res.json({ success: true, data: { topPick: null, allPicks: [] } });
    }

    // Fetch player info for all entity_ids in one query
    const playerIds = [...new Set((pickRows as any[]).map((r) => r.entity_id))];
    const { data: playerRows } = await supabaseAdmin
      .from('players')
      .select('id, name, team, position')
      .in('id', playerIds);

    const playerMap: Record<number, any> = {};
    for (const p of (playerRows || [])) playerMap[p.id] = p;

    // Fetch today's game IDs to scope the availability check
    const { data: todayGames } = await supabaseAdmin
      .from('games')
      .select('id')
      .eq('game_date', today)
      .eq('league_id', 1);

    const todayGameIds = (todayGames || []).map((g: any) => g.id);

    // Fetch Out players for today's games
    const outIds = new Set<number>();
    if (todayGameIds.length > 0) {
      const { data: outRows } = await supabaseAdmin
        .from('player_availability')
        .select('player_id')
        .eq('status', 'out')
        .in('game_id', todayGameIds);

      for (const r of (outRows || [])) outIds.add(r.player_id);
    }

    const picks = (pickRows as any[])
      .filter((row) => !outIds.has(row.entity_id))
      .map((row) => {
        const player = playerMap[row.entity_id] || {};
        return {
          pickId: row.id,
          playerId: row.entity_id,
          playerName: player.name ?? null,
          team: player.team ?? null,
          position: player.position ?? null,
          stat: row.stat,
          statLabel: PICK_STAT_LABELS[row.stat] ?? row.stat.toUpperCase(),
          pickType: row.pick_type,
          recommendedLine: row.recommended_line,
          confidence: row.confidence_score,
          edge: row.edge,
          hitRate: row.hit_rate,
          impliedProb: row.implied_prob,
          sampleSize: row.sample_size,
          conditionsMatched: row.conditions_matched,
          totalConditions: row.total_conditions,
        };
      });

    res.json({
      success: true,
      data: {
        topPick: picks[0] ?? null,
        allPicks: picks,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
```

- [ ] **Step 3: Add getPlayerPicks function**

Add after `getTodaysPicks`:

```typescript
export async function getPlayerPicks(req: any, res: any) {
  try {
    const { id } = req.params;
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const fromDate = from.toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from('pick_results')
      .select(
        'id, game_date, entity_id, stat, pick_type, recommended_line, ' +
        'hit_rate, confidence_score, implied_prob, edge, actual_result, did_hit'
      )
      .eq('entity_id', parseInt(id))
      .eq('prop_type', 'player')
      .gte('game_date', fromDate)
      .order('game_date', { ascending: false });

    if (error) throw error;

    const picks = (data || []).map((row: any) => ({
      pickId: row.id,
      date: row.game_date,
      stat: row.stat,
      statLabel: PICK_STAT_LABELS[row.stat] ?? row.stat.toUpperCase(),
      pickType: row.pick_type,
      recommendedLine: row.recommended_line,
      confidence: row.confidence_score,
      hitRate: row.hit_rate,
      impliedProb: row.implied_prob,
      edge: row.edge,
      actualResult: row.actual_result,
      didHit: row.did_hit,
    }));

    res.json({ success: true, data: picks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd ..
git add server/src/controllers/nbaController.ts
git commit -m "feat: add getTodaysPicks and getPlayerPicks controller functions"
```

---

## Task 9: Add Routes to nba.ts

**Files:**
- Modify: `server/src/routes/nba.ts`

- [ ] **Step 1: Add imports and routes**

Replace the entire `server/src/routes/nba.ts`:

```typescript
export {};
const express = require('express');
const router = express.Router();
const {
  getTopTrending,
  getTrends,
  searchPlayers,
  getPlayerGames,
  getTodaysGames,
  getTodaysPicks,
  getPlayerPicks,
} = require('../controllers/nbaController');

router.get('/trends/top', getTopTrending);
router.get('/trends', getTrends);
router.get('/players/search', searchPlayers);
router.get('/players/:id/games', getPlayerGames);
router.get('/games/today', getTodaysGames);
router.get('/picks/today', getTodaysPicks);
router.get('/picks/player/:id', getPlayerPicks);

module.exports = router;
```

- [ ] **Step 2: Start server and test both endpoints**

```bash
cd server && npm run dev
```

In a second terminal:
```bash
curl http://localhost:3000/api/nba/picks/today
```
Expected: `{"success":true,"data":{"topPick":null,"allPicks":[]}}`

```bash
curl http://localhost:3000/api/nba/picks/player/1
```
Expected: `{"success":true,"data":[]}`

- [ ] **Step 3: Commit**

```bash
cd ..
git add server/src/routes/nba.ts
git commit -m "feat: add /picks/today and /picks/player/:id routes"
```

---

## Task 10: Update api.ts with Pick Interface + Methods

**Files:**
- Modify: `client/src/services/api.ts`

- [ ] **Step 1: Add Pick and TodaysPicks interfaces**

In `client/src/services/api.ts`, after the `TodaysGame` interface (line 48), add:

```typescript
export interface Pick {
  pickId: number
  playerId: number
  playerName: string
  team: string
  position: string
  stat: string
  statLabel: string       // "PTS" | "REB" | "AST" | "3PM"
  pickType: 'safe' | 'value'
  recommendedLine: number
  confidence: number      // 0-100
  edge: number            // e.g. 0.12 = 12% edge over market
  hitRate: number         // historical hit rate e.g. 0.87
  impliedProb: number     // Kalshi market implied prob e.g. 0.71
  sampleSize: number
  conditionsMatched: number
  totalConditions: number
}

export interface TodaysPicks {
  topPick: Pick | null
  allPicks: Pick[]
}
```

- [ ] **Step 2: Add API methods to nbaApi object**

In the `nbaApi` object (after `getTodaysGames`), add:

```typescript
  getTodaysPicks: (): Promise<TodaysPicks> =>
    get(`${BASE}/nba/picks/today`),

  getPlayerPicks: (playerId: number): Promise<Pick[]> =>
    get(`${BASE}/nba/picks/player/${playerId}`),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ..
git add client/src/services/api.ts
git commit -m "feat: add Pick interface and getTodaysPicks/getPlayerPicks to API client"
```

---

## Task 11: Redesign PickOfTheDay Component

**Files:**
- Modify: `client/src/components/Home/PickOfTheDay.tsx`

- [ ] **Step 1: Replace PickOfTheDay.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, Pick } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Flame, ArrowRight, TrendingUp } from 'lucide-react'

export default function PickOfTheDay() {
  const navigate = useNavigate()
  const [pick, setPick]     = useState<Pick | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTodaysPicks()
      .then(({ topPick }) => setPick(topPick))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <Skeleton className="h-44 w-full bg-[#0F0F0F] rounded-2xl" />
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!pick) {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl border border-[#1A1A1A] bg-[#0D0D0D] flex items-center justify-center h-44">
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-mint animate-pulse-live" />
          <span className="text-[11px] text-gray-600 font-condensed uppercase tracking-[0.2em]">
            Analyzing today's slate...
          </span>
        </div>
      </div>
    )
  }

  // ── Pick card ─────────────────────────────────────────────────────────────
  const confidenceInt = Math.round(pick.confidence)
  const hitPct        = Math.round(pick.hitRate * 100)
  const mktPct        = Math.round(pick.impliedProb * 100)
  const edgePct       = Math.round(pick.edge * 100)

  return (
    <button
      onClick={() => navigate(`/player/${pick.playerId}`)}
      className="relative w-full overflow-hidden rounded-2xl border border-mint/20 text-left group transition-all hover:border-mint/40"
      style={{ background: 'linear-gradient(135deg, #0D1F18 0%, #0A0A0A 55%, #0A0C14 100%)' }}
    >
      {/* Radial glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 55% 90% at 88% 50%, rgba(42,255,200,0.12) 0%, transparent 70%)',
        }}
      />

      {/* Pick type badge — top right */}
      <div
        className={`absolute top-3 right-10 text-[9px] font-black font-condensed tracking-widest px-1.5 py-0.5 rounded ${
          pick.pickType === 'safe'
            ? 'bg-mint/10 text-mint border border-mint/20'
            : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
        }`}
      >
        {pick.pickType.toUpperCase()}
      </div>

      <div className="relative flex items-center gap-5 p-5 pr-4">
        {/* ── Left column ── */}
        <div className="flex-1 min-w-0">
          {/* Section label */}
          <div className="flex items-center gap-1.5 mb-3">
            <Flame size={11} className="text-mint" />
            <span className="text-[10px] font-black text-mint uppercase tracking-[0.18em] font-condensed">
              Pick of the Day
            </span>
          </div>

          {/* Player name */}
          <h2 className="text-[24px] font-black text-white font-condensed tracking-tight leading-none mb-0.5 group-hover:text-mint transition-colors truncate">
            {pick.playerName}
          </h2>
          <p className="text-xs text-gray-600 mb-3">
            {pick.team} · {pick.position}
          </p>

          {/* Recommended line badge */}
          <div className="inline-flex items-center gap-1.5 border border-mint/30 rounded px-2 py-1 mb-3.5">
            <TrendingUp size={9} className="text-mint" />
            <span className="text-[11px] font-black text-mint font-condensed tracking-wide">
              OVER {pick.recommendedLine} {pick.statLabel}
            </span>
          </div>

          {/* Edge bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-gray-600 font-condensed uppercase tracking-wider">
                MKT {mktPct}%
              </span>
              <span className="text-[9px] font-bold text-mint font-condensed">
                HIT {hitPct}%{' '}
                <span className="text-mint/50">+{edgePct}%</span>
              </span>
            </div>
            <div className="relative h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
              {/* Market implied prob — gray base */}
              <div
                className="absolute inset-y-0 left-0 bg-gray-700/60 rounded-full"
                style={{ width: `${mktPct}%` }}
              />
              {/* Our hit rate — mint overlay */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-mint/50 to-mint transition-all duration-700"
                style={{ width: `${hitPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Right column — confidence score ── */}
        <div className="flex-shrink-0 flex flex-col items-end">
          <div className="text-[76px] font-black text-mint font-display leading-none text-glow-mint tabular-nums">
            {confidenceInt}
          </div>
          <div className="text-[11px] text-gray-600 mt-0.5 font-condensed tracking-wide text-right">
            CONF
          </div>
        </div>

        <ArrowRight
          size={15}
          className="flex-shrink-0 text-gray-700 group-hover:text-mint group-hover:translate-x-0.5 transition-all self-center ml-1"
        />
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Start dev server and verify empty state**

```bash
# Terminal 1: backend
cd server && npm run dev

# Terminal 2: frontend
cd client && npm run dev
```

Open `http://localhost:5173`. The Home page PickOfTheDay card should show:
- The `animate-pulse-live` mint dot + "Analyzing today's slate..." text (since `pick_results` is empty)
- Same card dimensions as before, no broken UI

- [ ] **Step 4: Commit**

```bash
cd ..
git add client/src/components/Home/PickOfTheDay.tsx
git commit -m "feat: redesign PickOfTheDay to show confidence score pick with empty state fallback"
```

---

## Task 12: Run Today's Data Pipeline

These are manual commands the user runs — not code changes.

- [ ] **Step 1: Run nightly batch for today (fast ~1 min)**

```bash
cd C:/Users/trein/vscode/stat-trak-app-main
source venv/Scripts/activate
python -m analytics.batch.nightly --date 2026-04-14
```

Expected: prints slate of today's games, upserts `daily_conditions` rows.

- [ ] **Step 2: Run picks generator for today**

```bash
python -m analytics.picks.generate --date 2026-04-14
```

Expected: if `player_game_conditions` is still empty, all players return `None` from backtest — picks will be empty. That's OK — the frontend handles it gracefully.

- [ ] **Step 3: Run injury check for today**

```bash
python -m analytics.batch.injury_check --date 2026-04-14
```

Expected: lists pre-game teams, any Out/Doubtful players found.

- [ ] **Step 4: Verify end-to-end**

```bash
curl http://localhost:3000/api/nba/picks/today
```

Expected: `{"success":true,"data":{"topPick":null,"allPicks":[]}}` (or real picks if backtest data exists).

---

## Manual Data Backfill Note

The following long-running scripts must be kicked off by the user to populate `player_game_conditions` and `team_game_stats` — required for the backtest engine to produce picks. These are fire-and-forget; run in a separate terminal:

```bash
# 1. Enrich all historical games (hours — populates player_game_conditions + team_game_stats)
python -m analytics.data.enrich_games --resume

# 2. Backfill positions + opponent defense rankings
python -m analytics.data.enrich_games --positions

# 3. Fill 2025-26 player stats
python server/scripts/resume_nba_stats.py 1
```

Once these complete, re-run Task 12 Step 2. Picks will start appearing.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Season gap (2025-26) — Task 1
- ✅ Rate limiting / 429 hardening — Tasks 2, 3, 4
- ✅ injury_check.py — Task 5
- ✅ node-cron scheduler with all 4 jobs — Task 6
- ✅ Scheduler integrated with Express — Task 7
- ✅ getTodaysPicks + player availability filter — Task 8
- ✅ getPlayerPicks — Task 8
- ✅ Routes registered — Task 9
- ✅ api.ts Pick interface + methods — Task 10
- ✅ PickOfTheDay confidence card — Task 11
- ✅ PickOfTheDay empty state — Task 11
- ✅ PYTHON_PATH env var — scheduler.ts uses it
- ✅ Cron errors never crash Express — all wrapped in try/catch

**Type consistency:**
- `Pick.confidence` (number 0-100) matches `pick_results.confidence_score` (REAL) ✅
- `Pick.stat` ("pts"/"reb"/"ast"/"fg3m") matches `pick_results.stat` (VARCHAR) ✅
- `PICK_STAT_LABELS` used in both controller (Task 8) and matches `statLabel` in Pick interface (Task 10) ✅
- `getTodaysPicks` returns `{ topPick, allPicks }` — matches `TodaysPicks` interface ✅

**Note on injury_check ESPN parsing:** Step 2 of Task 5 includes a `--verify` flag to inspect the live ESPN response before trusting the parser. This must be run and confirmed before the script is considered production-ready.
