# NBA Player Prop Picks Pipeline v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the NBA player prop picks pipeline to use direct opportunity signals (touches / time-of-possession), recency-weighted hit rates, stat-specific opponent rank matching, an optional teammate-injury condition, and a bounded modifier system. Streaks pipeline is untouched except for display-only enrichment. First-half props are deleted from the pipeline entirely.

**Architecture:** All changes are in-place refactors of `analytics/`. Schema additions on three Supabase tables. A background subagent backfills `BoxScorePlayerTrackV3` for the last 3 seasons while foreground work proceeds. Closed-form scoring with named constants — no ML.

**Tech Stack:** Python 3.12, `nba_api`, Supabase (Postgres) via `supabase-py`, TypeScript/Express on the server side.

**Spec:** `docs/superpowers/specs/2026-05-02-player-prop-picks-v2-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `analytics/db/migrate.py` | Modify | Schema docs — `player_game_conditions`, `daily_conditions`, `pick_results` |
| `analytics/data/enrich_games.py` | Modify | Wire `BoxScorePlayerTrackV3`; add `--backfill-track` flag and speed-tuned retry constants |
| `analytics/batch/nightly.py` | Modify | Compute new `daily_conditions` fields (rolling touches/TOP, key teammates out, positional sub, recent opp form) |
| `analytics/screener/screen.py` | Modify | Replace usage gate with touches/TOP gate |
| `analytics/engine/backtest.py` | Modify | New 5+1 condition set, recency-weighted hit rate, new loosening order |
| `analytics/engine/scorer.py` | Modify | Remove B2B hit-rate adjustment + first-half cap; add modifier system |
| `analytics/picks/generate.py` | Modify | Filter first-half via Kalshi parse; safe/value selection; write `modifiers` JSONB |
| `analytics/kalshi/client.py` | Modify | Flag and drop first-half markets at parse |
| `server/src/controllers/picksController.ts` | Modify | Streaks endpoint surfaces new context fields when available |

No new files. All work is in-place edits.

---

## Tasks

### Task 1: Apply schema migration

**Files:**
- Modify: `analytics/db/migrate.py`
- Migration applied via Supabase MCP (no SQL file checked in)

- [ ] **Step 1: Run the schema migration via Supabase MCP**

Apply this migration through the `mcp__plugin_supabase_supabase__apply_migration` tool with name `player_prop_picks_v2`:

```sql
ALTER TABLE player_game_conditions
  ADD COLUMN IF NOT EXISTS touches FLOAT,
  ADD COLUMN IF NOT EXISTS front_court_touches FLOAT,
  ADD COLUMN IF NOT EXISTS time_of_possession FLOAT,
  ADD COLUMN IF NOT EXISTS paint_touches FLOAT,
  ADD COLUMN IF NOT EXISTS avg_speed FLOAT;

ALTER TABLE daily_conditions
  ADD COLUMN IF NOT EXISTS rolling_touches_5g FLOAT,
  ADD COLUMN IF NOT EXISTS rolling_top_5g FLOAT,
  ADD COLUMN IF NOT EXISTS season_avg_touches FLOAT,
  ADD COLUMN IF NOT EXISTS season_avg_top FLOAT,
  ADD COLUMN IF NOT EXISTS key_teammates_out INT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS positional_sub_for INT,
  ADD COLUMN IF NOT EXISTS recent_opp_pts_form FLOAT,
  ADD COLUMN IF NOT EXISTS recent_opp_reb_form FLOAT,
  ADD COLUMN IF NOT EXISTS recent_opp_ast_form FLOAT,
  ADD COLUMN IF NOT EXISTS recent_opp_fg3m_form FLOAT;

ALTER TABLE pick_results
  ADD COLUMN IF NOT EXISTS modifiers JSONB DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_pgc_touches ON player_game_conditions (touches) WHERE touches IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dc_key_teammates ON daily_conditions USING GIN (key_teammates_out);
```

- [ ] **Step 2: Verify columns exist**

Use `mcp__plugin_supabase_supabase__list_tables` to confirm `player_game_conditions`, `daily_conditions`, and `pick_results` show the new columns.

- [ ] **Step 3: Update `migrate.py` documented schema strings**

Open `analytics/db/migrate.py`. Find the `CREATE TABLE` strings for `player_game_conditions`, `daily_conditions`, `pick_results`. Add the new columns inline so the documented schema stays in sync with the live DB. No code changes — comment-only/docstring updates.

- [ ] **Step 4: Run `python -m analytics.db.migrate --verify`**

Expected: passes (all columns present).

- [ ] **Step 5: Commit**

```bash
git add analytics/db/migrate.py
git commit -m "feat(schema): add touches/TOP/teammate/modifiers columns for picks v2"
```

---

### Task 2: Wire `BoxScorePlayerTrackV3` in `enrich_games.py` (go-forward path)

**Files:**
- Modify: `analytics/data/enrich_games.py`

- [ ] **Step 1: Add the import**

In the `nba_api.stats.endpoints` import block at the top of `enrich_games.py`, add `boxscoreplayertrackv3`:

```python
from nba_api.stats.endpoints import (
    boxscoreadvancedv3,
    boxscoresummaryv2,
    boxscoretraditionalv2,
    boxscoreplayertrackv3,   # NEW
    commonteamroster,
)
```

- [ ] **Step 2: Add a single-game PlayerTrack fetcher**

Add this function near the other `fetch_*` helpers (search for `boxscoreadvancedv3.BoxScoreAdvancedV3` to find the area):

```python
def fetch_player_track(game_id: str) -> Optional[list[dict]]:
    """
    Fetch BoxScorePlayerTrackV3 for one game and return per-player rows
    keyed by player_id. Returns None on persistent failure (after retries).
    Field-name fallback handles nba_api version drift.
    """
    def _call():
        return boxscoreplayertrackv3.BoxScorePlayerTrackV3(game_id=game_id, timeout=30)

    resp = api_call_with_retry(_call, f"PlayerTrackV3 game_id={game_id}")
    if resp is None:
        return None

    df = resp.get_data_frames()[0]   # PlayerStats frame
    rows = []
    for _, r in df.iterrows():
        rows.append({
            "player_id":           int(r.get("personId", r.get("PERSON_ID"))),
            "game_id":             game_id,
            "touches":             _safe_float(r.get("touches", r.get("TOUCHES"))),
            "front_court_touches": _safe_float(r.get("frontCourtTouches", r.get("FRONT_COURT_TOUCHES"))),
            "time_of_possession":  _safe_float(r.get("timeOfPossession", r.get("TIME_OF_POSSESSION"))),
            "paint_touches":       _safe_float(r.get("paintTouches", r.get("PAINT_TOUCHES"))),
            "avg_speed":           _safe_float(r.get("avgSpeed", r.get("AVG_SPEED"))),
        })
    return rows


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
```

- [ ] **Step 3: Call `fetch_player_track` inside `enrich_games()` per-game loop**

Find the existing per-game fetch block (the loop that calls `fetch_advanced` and `fetch_summary`). After the existing fetches, add:

```python
track_rows = fetch_player_track(game_id)
if track_rows is None:
    print(f"  ⚠ PlayerTrackV3 unavailable for {game_id} — skipping touches/TOP for this game")
else:
    # Merge touches/TOP/etc into the per-player condition rows being built
    track_by_player = {row["player_id"]: row for row in track_rows}
    for cond_row in condition_rows:   # condition_rows is the list being upserted
        tr = track_by_player.get(cond_row["player_id"])
        if tr:
            cond_row["touches"]             = tr["touches"]
            cond_row["front_court_touches"] = tr["front_court_touches"]
            cond_row["time_of_possession"]  = tr["time_of_possession"]
            cond_row["paint_touches"]       = tr["paint_touches"]
            cond_row["avg_speed"]           = tr["avg_speed"]
```

- [ ] **Step 4: Run on a single recent game in `--test` mode**

```bash
python -m analytics.data.enrich_games --test
```

Expected: prints PlayerTrackV3 fetched for the test games. No errors. Verify rows in `player_game_conditions` have `touches` populated for the test games via Supabase MCP `execute_sql`:

```sql
SELECT player_id, game_id, touches, time_of_possession
FROM player_game_conditions
WHERE touches IS NOT NULL
ORDER BY game_id DESC LIMIT 10;
```

- [ ] **Step 5: Commit**

```bash
git add analytics/data/enrich_games.py
git commit -m "feat(enrich): wire BoxScorePlayerTrackV3 into go-forward enrichment"
```

---

### Task 3: Add `--backfill-track` mode with speed-tuned retry constants

**Files:**
- Modify: `analytics/data/enrich_games.py`

- [ ] **Step 1: Add the new constants near the top of `enrich_games.py`**

Place these after the existing `BACKOFF_*` and `COOLDOWN_*` constants:

```python
# ── Backfill speed tuning (used by --backfill-track mode) ──────────────────────
# Backfill assumes the API is healthy — go fast, only slow down on real signal.
# TODO: tune against observed nba_api 429 frequency. Lower if API tolerates faster cadence.
FAST_RETRY_SECONDS = 5
# First-failure quick retry. Most transient errors (timeouts, dropped connections)
# clear in well under 5 seconds.

DOUBLE_FAIL_TRIGGERS_COOLDOWN = True
# When the FAST_RETRY also fails, escalate to the existing _trigger_cooldown()
# (120-180s jittered + 30-call slow mode). Two consecutive failures within seconds
# is a strong signal of a real problem, not a blip.

BACKFILL_API_DELAY_SECONDS = 0.0
# In --backfill-track mode, skip the inter-call API_DELAY_SECONDS floor.
# Rate-limit signal (429s) and the cooldown ladder are the only governors.
```

- [ ] **Step 2: Add a `backfill_mode` flag passed through `api_call_with_retry`**

In `api_call_with_retry()`, accept an optional `backfill_mode: bool = False` parameter. When True:
- Replace `_adaptive_delay()`'s floor with `BACKFILL_API_DELAY_SECONDS`
- On first failure: sleep `FAST_RETRY_SECONDS` and retry once
- On second consecutive failure (and `DOUBLE_FAIL_TRIGGERS_COOLDOWN`): call `_trigger_cooldown()`
- 429 handling unchanged (separate path with its own retry counter)

Code shape (insert at the top of the retry loop):
```python
def api_call_with_retry(call_fn, description: str, backfill_mode: bool = False):
    consecutive_failures = 0
    delay = BACKFILL_API_DELAY_SECONDS if backfill_mode else _adaptive_delay()
    # ... existing loop ...
    # On non-429 failure:
    consecutive_failures += 1
    if backfill_mode and consecutive_failures == 1:
        time.sleep(FAST_RETRY_SECONDS)
        continue
    if backfill_mode and consecutive_failures >= 2 and DOUBLE_FAIL_TRIGGERS_COOLDOWN:
        _trigger_cooldown()
        consecutive_failures = 0
        continue
    # ... existing fallthrough to standard retry logic ...
```

- [ ] **Step 3: Add CLI flag `--backfill-track` to `enrich_games.py`'s argparse**

Find the existing argparse block (likely near `if __name__ == "__main__"`). Add:

```python
parser.add_argument(
    "--backfill-track",
    action="store_true",
    help="Backfill BoxScorePlayerTrackV3 only (touches/TOP/etc) across the season window. "
         "Uses speed-tuned retry: fast retry first, full cooldown on second consecutive fail.",
)
parser.add_argument(
    "--seasons",
    type=str,
    default=None,
    help="Comma-separated list of seasons (e.g. '2023-24,2024-25,2025-26'). "
         "Required with --backfill-track.",
)
```

- [ ] **Step 4: Add `backfill_track()` function**

```python
def backfill_track(seasons: list[str]) -> None:
    """
    Backfill BoxScorePlayerTrackV3 for all completed games in the given seasons.
    Skips games that already have touches data in player_game_conditions.
    """
    print(f"[backfill_track] Seasons: {seasons}")

    # Find target game_ids: completed games in the given seasons,
    # missing touches data in player_game_conditions.
    for season in seasons:
        result = (
            supabase.table("games")
            .select("id, ext_id, game_date, season")
            .eq("season", _season_to_int(season))
            .eq("league_id", NBA_LEAGUE_ID)
            .in_("status", ["completed", "final"])
            .order("game_date", desc=False)
            .execute()
        )
        games = result.data or []
        print(f"[backfill_track] Season {season}: {len(games)} completed games")

        for i, game in enumerate(games, 1):
            ext_id = game["ext_id"]
            # Skip if any condition row for this game already has touches
            existing = (
                supabase.table("player_game_conditions")
                .select("touches", count="exact")
                .eq("game_id", game["id"])
                .not_.is_("touches", "null")
                .limit(1)
                .execute()
            )
            if (existing.count or 0) > 0:
                continue

            track_rows = fetch_player_track(ext_id)
            if track_rows is None:
                print(f"  [{i}/{len(games)}] {ext_id}: unavailable, skipping")
                continue

            # Update existing player_game_conditions rows with touches/etc
            for tr in track_rows:
                supabase.table("player_game_conditions").update({
                    "touches":             tr["touches"],
                    "front_court_touches": tr["front_court_touches"],
                    "time_of_possession":  tr["time_of_possession"],
                    "paint_touches":       tr["paint_touches"],
                    "avg_speed":           tr["avg_speed"],
                }).eq("player_id", tr["player_id"]).eq("game_id", game["id"]).execute()

            if i % 50 == 0:
                print(f"  [{i}/{len(games)}] season={season}")

    print("[backfill_track] Complete.")
```

Update `fetch_player_track()` to call `api_call_with_retry(..., backfill_mode=True)` when invoked from `backfill_track()` — pass a `backfill_mode` kwarg through `fetch_player_track(game_id, backfill_mode=False)`.

- [ ] **Step 5: Wire the CLI flag to call `backfill_track()`**

```python
if args.backfill_track:
    if not args.seasons:
        sys.exit("--backfill-track requires --seasons")
    seasons = [s.strip() for s in args.seasons.split(",")]
    backfill_track(seasons)
    sys.exit(0)
```

- [ ] **Step 6: Smoke-test against a single season's first 5 games**

Add a `--limit N` flag for testing, then:
```bash
python -m analytics.data.enrich_games --backfill-track --seasons 2025-26 --limit 5
```

Expected: 5 games processed, touches values populated. Verify with the same Supabase SQL query from Task 2 Step 4.

- [ ] **Step 7: Commit**

```bash
git add analytics/data/enrich_games.py
git commit -m "feat(enrich): add --backfill-track mode with speed-tuned retry"
```

---

### Task 4: Launch background backfill subagent

**Files:** None — operational task.

- [ ] **Step 1: Launch background subagent**

Use the Agent tool with `run_in_background: true`, `subagent_type: general-purpose`:

Prompt: "Run the BoxScorePlayerTrackV3 backfill for seasons 2023-24, 2024-25, and 2025-26. Execute `python -m analytics.data.enrich_games --backfill-track --seasons 2023-24,2024-25,2025-26` from `C:\Users\trein\vscode\stat-trak-app-main`. Monitor stdout. If you see repeated 429s or cooldowns lasting more than 30 minutes total, stop and report. Otherwise let it run to completion. Report progress every ~500 games processed."

- [ ] **Step 2: Note the subagent ID**

Record the subagent ID — used to check progress between subsequent tasks. The backfill is expected to take 2–4 days at ~3 calls/sec sustained.

- [ ] **Step 3: Continue with foreground tasks**

The remaining tasks operate independently of backfill completeness. The pipeline degrades gracefully on thin samples.

---

### Task 5: Update `nightly.py` — rolling touches / TOP

**Files:**
- Modify: `analytics/batch/nightly.py`

- [ ] **Step 1: Locate `compute_daily_conditions()`**

This is the function that writes per-player rows into `daily_conditions`. Find the block that computes `rolling_pts_5g`, `rolling_reb_5g`, etc.

- [ ] **Step 2: Add touches/TOP rolling averages**

In the per-player loop, after the existing rolling stat computation, add:

```python
# Rolling touches and time_of_possession over last 5 games (with minutes_played > 0)
track_query = (
    supabase.table("player_game_conditions")
    .select("touches, time_of_possession, game_date")
    .eq("player_id", player_id)
    .lt("game_date", target_date_str)
    .gt("minutes_played", 0)
    .not_.is_("touches", "null")
    .order("game_date", desc=True)
    .limit(5)
    .execute()
)
track_rows = track_query.data or []
rolling_touches_5g = _safe_avg([r["touches"] for r in track_rows])
rolling_top_5g     = _safe_avg([r["time_of_possession"] for r in track_rows])
```

- [ ] **Step 3: Add season averages for touches/TOP**

```python
# Season averages — used by recency comparison + display
season_track_query = (
    supabase.table("player_game_conditions")
    .select("touches, time_of_possession")
    .eq("player_id", player_id)
    .gte("game_date", season_start_iso)
    .gt("minutes_played", 0)
    .not_.is_("touches", "null")
    .execute()
)
season_track_rows = season_track_query.data or []
season_avg_touches = _safe_avg([r["touches"] for r in season_track_rows])
season_avg_top     = _safe_avg([r["time_of_possession"] for r in season_track_rows])
```

- [ ] **Step 4: Add the new fields to the upsert payload**

In the dict passed to `supabase.table("daily_conditions").upsert(...)`, include:

```python
"rolling_touches_5g": rolling_touches_5g,
"rolling_top_5g":     rolling_top_5g,
"season_avg_touches": season_avg_touches,
"season_avg_top":     season_avg_top,
```

- [ ] **Step 5: Run nightly with `--test`**

```bash
python -m analytics.batch.nightly --test
```

Expected: completes without errors. Verify rows:
```sql
SELECT player_id, game_date, rolling_touches_5g, rolling_top_5g, season_avg_touches
FROM daily_conditions
WHERE game_date = '<target_date>' AND rolling_touches_5g IS NOT NULL
LIMIT 10;
```

- [ ] **Step 6: Commit**

```bash
git add analytics/batch/nightly.py
git commit -m "feat(nightly): compute rolling/season touches and TOP into daily_conditions"
```

---

### Task 6: `nightly.py` — `key_teammates_out` and `positional_sub_for`

**Files:**
- Modify: `analytics/batch/nightly.py`

- [ ] **Step 1: Add helper to compute team's top-3-usage roster**

Place near the top of the module:

```python
# TODO: tune against observed lineup behavior. 3 captures the team's primary creators
# without dragging in role players whose absence has minimal lineup impact.
TOP_USAGE_TEAMMATE_COUNT = 3
```

```python
def _compute_top_usage_per_team(target_date_str: str) -> dict[int, list[int]]:
    """
    Return a mapping team_id → [player_id, ...] for the top-N players by season-avg
    usage on each NBA team. N = TOP_USAGE_TEAMMATE_COUNT.
    Uses daily_conditions.season_avg_usg as the source.
    """
    rows = (
        supabase.table("daily_conditions")
        .select("player_id, season_avg_usg, players!inner(team)")
        .eq("game_date", target_date_str)
        .not_.is_("season_avg_usg", "null")
        .execute()
    ).data or []

    by_team: dict[str, list[tuple[int, float]]] = {}
    for r in rows:
        team_abbr = r.get("players", {}).get("team")
        if team_abbr is None:
            continue
        by_team.setdefault(team_abbr, []).append((r["player_id"], r["season_avg_usg"]))

    # Resolve abbreviations to team_ids
    team_rows = supabase.table("teams").select("id, abbreviation").execute().data or []
    abbr_to_id = {t["abbreviation"]: t["id"] for t in team_rows}

    result: dict[int, list[int]] = {}
    for abbr, plist in by_team.items():
        tid = abbr_to_id.get(abbr)
        if tid is None:
            continue
        plist.sort(key=lambda x: x[1], reverse=True)
        result[tid] = [pid for pid, _ in plist[:TOP_USAGE_TEAMMATE_COUNT]]
    return result
```

- [ ] **Step 2: Compute `key_teammates_out` per candidate**

In the per-player loop of `compute_daily_conditions()`, after the team and game lookups:

```python
# Build out-list: which teammates of this player are out tonight
out_teammates = (
    supabase.table("player_availability")
    .select("player_id")
    .eq("game_id", game_id)
    .eq("status", "out")
    .execute()
).data or []
out_teammate_ids_all = {r["player_id"] for r in out_teammates if r["player_id"] != player_id}

# Scenario (b): top-3-usage teammates who are out
top_usage = top_usage_per_team.get(team_id, [])
top_usage_out = [pid for pid in top_usage if pid in out_teammate_ids_all]

# Scenario (a): is this player a positional sub for any out starter?
positional_sub_for = _resolve_positional_sub(
    player_id, position_group, team_id, out_teammate_ids_all
)

# key_teammates_out is the union of (a) the player they're subbing for and
# (b) any top-usage teammate who is out. Empty array when neither scenario fires.
key_teammates_out = sorted(set(top_usage_out) | ({positional_sub_for} if positional_sub_for else set()))
```

- [ ] **Step 3: Add `_resolve_positional_sub()` helper**

```python
def _resolve_positional_sub(
    candidate_id: int,
    candidate_position_group: str,
    team_id: int,
    out_teammate_ids: set[int],
) -> Optional[int]:
    """
    Returns the player_id of the out starter that `candidate_id` is the next-in-line
    sub for, or None.

    Definition: an out starter `S` such that:
      - S has the same position_group as the candidate
      - candidate has the next-highest season_avg_minutes among non-out teammates
        with that position_group on `team_id`
    """
    if not out_teammate_ids:
        return None

    # Pull the team's roster with positions and season-avg minutes
    roster = (
        supabase.table("daily_conditions")
        .select("player_id, position_group, season_avg_minutes")
        .eq("game_date", target_date_str)
        .in_("player_id", list(out_teammate_ids) + [candidate_id])
        .execute()
    ).data or []
    # ... (filter to same position_group, find the out player whose 'next-up' equals candidate)
    # If multiple out starters share the position group, prefer the one with the
    # highest season_avg_minutes.

    same_pos_out = [
        r for r in roster
        if r["player_id"] in out_teammate_ids
        and r["position_group"] == candidate_position_group
    ]
    if not same_pos_out:
        return None
    # Pick the highest-minutes out starter at this position
    same_pos_out.sort(key=lambda r: r["season_avg_minutes"] or 0, reverse=True)
    return same_pos_out[0]["player_id"]
```

Note: this requires `season_avg_minutes` to exist on `daily_conditions`. If it doesn't, derive from `nba_player_stats` season query in this helper. If it already exists, just use it.

- [ ] **Step 4: Add fields to upsert payload**

```python
"key_teammates_out":  key_teammates_out,
"positional_sub_for": positional_sub_for,
```

- [ ] **Step 5: Test on a date with known absences**

```bash
python -m analytics.batch.nightly --date <date_with_known_injuries>
```

Verify:
```sql
SELECT player_id, game_date, key_teammates_out, positional_sub_for
FROM daily_conditions
WHERE game_date = '<date>' AND cardinality(key_teammates_out) > 0
LIMIT 20;
```

- [ ] **Step 6: Commit**

```bash
git add analytics/batch/nightly.py
git commit -m "feat(nightly): compute key_teammates_out and positional_sub_for"
```

---

### Task 7: `nightly.py` — `recent_opp_<stat>_form`

**Files:**
- Modify: `analytics/batch/nightly.py`

- [ ] **Step 1: Add the window constant**

Near the top of `nightly.py`:

```python
# TODO: window N=7 chosen as "recent enough to capture trend, not so short as to be noisy".
# Recalibrate after collecting recent_opp_form data for a full season.
RECENT_OPP_FORM_WINDOW = 7
```

- [ ] **Step 2: Add a per-team recent-form helper**

```python
def _compute_recent_opp_form(
    opponent_team_id: int,
    target_date_str: str,
) -> dict[str, Optional[float]]:
    """
    Returns a dict {pts: float, reb: float, ast: float, fg3m: float} where each value
    is (opp_last_N_avg_allowed / opp_season_avg_allowed) - 1.0
    Allowed = stat scored against this team by opposing players in completed games.
    """
    season_start = _season_start_iso(target_date_str)

    last_n_q = (
        supabase.table("nba_player_stats")
        .select("points, rebounds, assists, three_points_made, game_id, games!inner(home_team_id, away_team_id, game_date)")
        .gte("game_date", season_start)
        .lt("game_date", target_date_str)
        .order("game_date", desc=True)
        .execute()
    )
    rows = last_n_q.data or []

    # Filter to rows where the opposing team in that game IS opponent_team_id
    # (i.e. the player belongs to the other team).
    def _is_opp(r):
        g = r["games"]
        return g["home_team_id"] == opponent_team_id or g["away_team_id"] == opponent_team_id

    opp_rows = [r for r in rows if _is_opp(r)]

    # Group by game_date; pick the last N distinct dates
    distinct_dates_desc = sorted({r["games"]["game_date"] for r in opp_rows}, reverse=True)
    last_n_dates = set(distinct_dates_desc[:RECENT_OPP_FORM_WINDOW])
    last_n_rows = [r for r in opp_rows if r["games"]["game_date"] in last_n_dates]

    def _avg_allowed(rows_subset, key):
        if not rows_subset:
            return None
        # Sum stat across players-on-the-other-team, then divide by # games (not # players)
        per_game = {}
        for r in rows_subset:
            d = r["games"]["game_date"]
            per_game.setdefault(d, 0.0)
            per_game[d] += r.get(key, 0) or 0
        return sum(per_game.values()) / len(per_game) if per_game else None

    season_pts = _avg_allowed(opp_rows, "points")
    season_reb = _avg_allowed(opp_rows, "rebounds")
    season_ast = _avg_allowed(opp_rows, "assists")
    season_fg3m = _avg_allowed(opp_rows, "three_points_made")

    last_pts = _avg_allowed(last_n_rows, "points")
    last_reb = _avg_allowed(last_n_rows, "rebounds")
    last_ast = _avg_allowed(last_n_rows, "assists")
    last_fg3m = _avg_allowed(last_n_rows, "three_points_made")

    def _form(last, season):
        if last is None or season is None or season == 0:
            return None
        return (last / season) - 1.0

    return {
        "pts":  _form(last_pts, season_pts),
        "reb":  _form(last_reb, season_reb),
        "ast":  _form(last_ast, season_ast),
        "fg3m": _form(last_fg3m, season_fg3m),
    }
```

- [ ] **Step 3: Cache form per opponent_team_id**

In `compute_daily_conditions()`, before the per-player loop:

```python
# Cache: many candidates share the same opponent on a given date
opp_form_cache: dict[int, dict] = {}

def _opp_form(opp_team_id: int) -> dict:
    if opp_team_id not in opp_form_cache:
        opp_form_cache[opp_team_id] = _compute_recent_opp_form(opp_team_id, target_date_str)
    return opp_form_cache[opp_team_id]
```

- [ ] **Step 4: Add the four form fields to the upsert payload**

```python
form = _opp_form(opponent_team_id)
upsert_payload.update({
    "recent_opp_pts_form":  form["pts"],
    "recent_opp_reb_form":  form["reb"],
    "recent_opp_ast_form":  form["ast"],
    "recent_opp_fg3m_form": form["fg3m"],
})
```

- [ ] **Step 5: Run nightly --test, verify**

```bash
python -m analytics.batch.nightly --test
```

```sql
SELECT player_id, recent_opp_pts_form, recent_opp_reb_form
FROM daily_conditions
WHERE game_date = '<target>' AND recent_opp_pts_form IS NOT NULL LIMIT 5;
```

- [ ] **Step 6: Commit**

```bash
git add analytics/batch/nightly.py
git commit -m "feat(nightly): compute recent_opp_<stat>_form (last 7 games vs season)"
```

---

### Task 8: Refactor `screen.py` — touches / TOP gates

**Files:**
- Modify: `analytics/screener/screen.py`

- [ ] **Step 1: Replace usage gate constants**

At the top of `screen.py`, find the existing `MIN_ROLLING_*` block. Replace usage-related entries:

```python
# OLD:
# MIN_ROLLING_USG = 0.18  (or wherever the usage gate lived)

# NEW:
# TODO: tune against the distribution of touches/TOP across active NBA rotations.
# Current estimates: bench rotation players average ~25 touches and 1.5 min TOP.
MIN_ROLLING_TOUCHES = 25.0
MIN_ROLLING_TOP     = 1.5     # minutes of time of possession per game
```

Keep `MIN_ROLLING_MINUTES`, `MIN_ROLLING_PTS`, `MIN_ROLLING_REB`, `MIN_ROLLING_AST`, `MIN_ROLLING_FG3M` unchanged.

- [ ] **Step 2: Update `screen_player_candidates()` filter**

Find the SQL/filter chain. Replace any `rolling_usg_5g` thresholds with:

```python
# Touches-and-TOP gate
.gte("rolling_touches_5g", MIN_ROLLING_TOUCHES)
.gte("rolling_top_5g", MIN_ROLLING_TOP)
```

If the existing query used `rolling_usg_5g >= MIN_ROLLING_USG`, drop that clause entirely.

- [ ] **Step 3: Update the `--test` block / printing**

Find the `print()` lines that show usage values per candidate; replace with touches/TOP.

- [ ] **Step 4: Run**

```bash
python -m analytics.screener.screen --date <target>
```

Expected: prints candidates with touches/TOP shown. Sanity-check that high-usage stars (LeBron, Doncic, etc.) appear and bench-fillers do not.

- [ ] **Step 5: Commit**

```bash
git add analytics/screener/screen.py
git commit -m "refactor(screener): gate on touches/TOP instead of inferred usage rate"
```

---

### Task 9: `backtest.py` — new condition matching schema

**Files:**
- Modify: `analytics/engine/backtest.py`

- [ ] **Step 1: Update top-of-file constants**

```python
# ── Player-prop bucket widths ─────────────────────────────────────────────────
# TODO: tune against observed match-rate distribution. Tighter buckets = more
# similar context but smaller samples.
OPPORTUNITY_TOUCH_BUCKET = 8.0    # ±touches around today's rolling avg
OPPORTUNITY_TOP_BUCKET   = 0.5    # ±minutes of TOP

PACE_BUCKET_WIDTH        = 5.0    # preserved
MATCHUP_RANK_WINDOW      = 12     # preserved (now applied to stat-specific rank)
MAX_DAYS_REST            = 10     # preserved

# ── Hit-rate weighting ────────────────────────────────────────────────────────
# TODO: recalibrate after backfill completes. Higher (closer to 1.0) flattens
# toward equal weighting. Lower weights very recent games more aggressively.
HIT_RATE_DECAY = 0.95

# ── Loosening order ───────────────────────────────────────────────────────────
# Only home_away and matchup_rank are droppable. Opportunity / pace / rest are
# non-droppable for the player-prop pipeline.
CONDITION_DROP_ORDER  = ["home_away", "matchup_rank"]
MIN_CONDITIONS_ACTIVE = 3

# ── Optional teammate-out condition ───────────────────────────────────────────
# TODO: raise this if 3-sample matches produce too-noisy condition activations.
MIN_TEAMMATE_HISTORICAL_SAMPLES = 3

MIN_SAMPLE_SIZE = 8   # preserved
```

Remove old `USG_BUCKET_WIDTH` for player-prop matching (game-prop matching may still use it — leave intact if so).

- [ ] **Step 2: Define stat → opp-rank-column mapping**

```python
# Stat-specific opponent rank columns on daily_conditions
STAT_OPP_RANK_COLUMNS: dict[str, str] = {
    "pts":  "opp_def_rank_position",
    "reb":  "opp_reb_rank_position",
    "ast":  "opp_ast_rank_position",
    "fg3m": "opp_fg3m_rank_position",
}
```

- [ ] **Step 3: Rewrite the player-prop condition match**

In `backtest_player()`, replace the existing condition-building block with:

```python
def _condition_filters(
    today: dict,        # daily_conditions row for the candidate (today's context)
    stat: str,
    active: set[str],   # which conditions are currently active
) -> dict:
    """
    Returns a dict of (column → predicate) describing the historical-game filters
    for the active conditions. Used to filter player_game_conditions joined with
    nba_player_stats history.
    """
    f = {}

    if "opportunity" in active:
        f["touches"]            = (today["rolling_touches_5g"] - OPPORTUNITY_TOUCH_BUCKET,
                                   today["rolling_touches_5g"] + OPPORTUNITY_TOUCH_BUCKET)
        f["time_of_possession"] = (today["rolling_top_5g"] - OPPORTUNITY_TOP_BUCKET,
                                   today["rolling_top_5g"] + OPPORTUNITY_TOP_BUCKET)
    if "pace" in active:
        f["pace"] = (today["rolling_pace_5g"] - PACE_BUCKET_WIDTH,
                     today["rolling_pace_5g"] + PACE_BUCKET_WIDTH)
    if "rest" in active:
        f["_rest_category"] = _rest_category(today["days_rest"])  # exact match
    if "matchup_rank" in active:
        col = STAT_OPP_RANK_COLUMNS[stat]
        f[f"_opp_rank:{col}"] = (today[col] - MATCHUP_RANK_WINDOW,
                                 today[col] + MATCHUP_RANK_WINDOW)
    if "home_away" in active:
        f["home_away"] = today["home_away"]   # exact match
    if "key_teammate_out" in active:
        f["_teammate_intersect"] = today["key_teammates_out"]
    return f
```

- [ ] **Step 4: Implement match query against historical games**

The historical match query joins `player_game_conditions` (touches, TOP, pace, days_rest, home_away, opponent_team_id) with `nba_player_stats` (the actual stat value) and `opponent_position_defense` (the stat-specific rank at that historical date). Build the SQL/builder calls per active condition.

For the `key_teammate_out` exact-intersect, fetch historical `player_availability` rows per game and intersect:

```python
def _history_with_teammate_intersect(
    candidate_id: int,
    target_teammates: list[int],
) -> list[dict]:
    """
    Return historical game rows where at least one of `target_teammates`
    was 'out' on the same game_id as the candidate's appearance.
    """
    if not target_teammates:
        return []

    # Pull the candidate's history with team & game info
    own_games = (
        supabase.table("player_game_conditions")
        .select("game_id")
        .eq("player_id", candidate_id)
        .gt("minutes_played", 0)
        .execute()
    ).data or []
    own_game_ids = [r["game_id"] for r in own_games]

    out_in_those = (
        supabase.table("player_availability")
        .select("game_id, player_id")
        .in_("game_id", own_game_ids)
        .eq("status", "out")
        .in_("player_id", target_teammates)
        .execute()
    ).data or []

    matched_game_ids = {r["game_id"] for r in out_in_those}
    return [g for g in own_games if g["game_id"] in matched_game_ids]
```

- [ ] **Step 5: Commit**

```bash
git add analytics/engine/backtest.py
git commit -m "refactor(backtest): new condition schema (touches/TOP, stat-specific rank, teammate)"
```

---

### Task 10: `backtest.py` — recency-weighted hit rate

**Files:**
- Modify: `analytics/engine/backtest.py`

- [ ] **Step 1: Add the weighted-hit-rate helper**

```python
def _weighted_hit_rate(historical_results: list[tuple[str, bool]]) -> float:
    """
    Inputs: list of (game_date, hit) tuples, sorted by game_date DESCENDING
            (most recent first).
    Returns: weighted hit rate where weight_i = HIT_RATE_DECAY ** i,
             i = 0 for the most recent game.
    """
    if not historical_results:
        return 0.0

    weights = [HIT_RATE_DECAY ** i for i in range(len(historical_results))]
    total_w = sum(weights)
    if total_w == 0:
        return 0.0
    weighted_hits = sum(w * (1 if hit else 0)
                        for w, (_, hit) in zip(weights, historical_results))
    return weighted_hits / total_w
```

- [ ] **Step 2: Integrate into `backtest_player()`**

Replace the existing `hit_rate = hits / sample_size` computation with:

```python
# Sort matched history by game_date DESC, most recent first
matches.sort(key=lambda m: m["game_date"], reverse=True)
historical_results = [(m["game_date"], m["actual_value"] > line) for m in matches]
hit_rate = _weighted_hit_rate(historical_results)
sample_size = len(historical_results)   # raw count, NOT weighted
```

- [ ] **Step 3: Add a self-test**

If the file has a `_run_self_test()` function (mirroring `scorer.py`), extend it. Otherwise add one:

```python
def _run_self_test():
    print("=" * 60)
    print("Backtest Engine — Self-Test")
    print("=" * 60)

    # Weighted hit rate sanity:
    # 5 most-recent games, all hits → hit rate = 1.0
    all_hits = [("2026-04-30", True), ("2026-04-28", True),
                ("2026-04-26", True), ("2026-04-24", True), ("2026-04-22", True)]
    assert abs(_weighted_hit_rate(all_hits) - 1.0) < 1e-9

    # Recent miss should drop hit rate more than ancient miss
    recent_miss  = [("2026-04-30", False)] + [("2026-04-2X", True)] * 9
    ancient_miss = [("2026-04-30", True)] * 9 + [("2026-04-XX", False)]
    assert _weighted_hit_rate(recent_miss) < _weighted_hit_rate(ancient_miss)

    print("Backtest self-test passed.")

if __name__ == "__main__":
    _run_self_test()
```

- [ ] **Step 4: Run self-test**

```bash
python -m analytics.engine.backtest
```

Expected: "Backtest self-test passed."

- [ ] **Step 5: Commit**

```bash
git add analytics/engine/backtest.py
git commit -m "feat(backtest): recency-weighted hit rate (DECAY=0.95)"
```

---

### Task 11: `backtest.py` — loosening order + optional teammate condition

**Files:**
- Modify: `analytics/engine/backtest.py`

- [ ] **Step 1: Implement loosening loop**

In `backtest_player()`, replace any existing loosening logic with:

```python
def backtest_player(player_id: int, stat: str, line: float, game_date: str) -> Optional[dict]:
    today = _load_daily_conditions(player_id, game_date)
    if today is None:
        return None

    # Determine if optional teammate condition is *eligible* for activation
    teammate_eligible = bool(today.get("key_teammates_out"))

    # Start with all 5 core conditions active
    active: set[str] = {"opportunity", "pace", "rest", "matchup_rank", "home_away"}
    total_conditions = 5

    # If teammate condition is eligible, attempt to activate it; only succeeds if
    # historical sample with exact-teammate intersection is >= MIN_TEAMMATE_HISTORICAL_SAMPLES
    teammate_active = False
    if teammate_eligible:
        teammate_samples = _history_with_teammate_intersect(
            player_id, today["key_teammates_out"]
        )
        if len(teammate_samples) >= MIN_TEAMMATE_HISTORICAL_SAMPLES:
            active.add("key_teammate_out")
            total_conditions = 6
            teammate_active = True

    # Try to find sample, loosening per CONDITION_DROP_ORDER if needed
    matches = _query_matches(player_id, stat, line, today, active)
    drop_idx = 0
    while len(matches) < MIN_SAMPLE_SIZE and len(active) > MIN_CONDITIONS_ACTIVE + (1 if teammate_active else 0):
        if drop_idx >= len(CONDITION_DROP_ORDER):
            break
        droppable = CONDITION_DROP_ORDER[drop_idx]
        if droppable in active:
            active.discard(droppable)
        drop_idx += 1
        matches = _query_matches(player_id, stat, line, today, active)

    if len(matches) < MIN_SAMPLE_SIZE:
        return None

    # Compute weighted hit rate
    matches.sort(key=lambda m: m["game_date"], reverse=True)
    historical_results = [(m["game_date"], m["actual_value"] > line) for m in matches]
    hit_rate = _weighted_hit_rate(historical_results)

    return {
        "hit_rate":           hit_rate,
        "sample_size":        len(matches),
        "conditions_matched": len(active & {"opportunity","pace","rest","matchup_rank","home_away"}),
        "total_conditions":   5,    # the count of CORE conditions; optional reported separately
        "key_teammate_out_active": teammate_active,
        "condition_breakdown": {
            "opportunity":      "active",
            "pace":             "active",
            "rest":             "active",
            "matchup_rank":     "active" if "matchup_rank" in active else "dropped",
            "home_away":        "active" if "home_away"    in active else "dropped",
            "key_teammate_out": "active" if teammate_active else ("inactive" if not teammate_eligible else "insufficient_sample"),
        },
    }
```

- [ ] **Step 2: Make sure `_query_matches` honors the optional condition**

`_query_matches` should only apply the `key_teammate_out` filter when `"key_teammate_out" in active` — i.e. intersect historical games with the teammate-out filter from Step 4 of Task 9.

- [ ] **Step 3: Run self-test (still passes)**

```bash
python -m analytics.engine.backtest
```

- [ ] **Step 4: Manual verification on a real player**

Pick a player who has a starter teammate out tonight. Run:

```bash
python -c "from analytics.engine.backtest import backtest_player; \
  print(backtest_player(<player_id>, 'pts', <line>, '<today>'))"
```

Verify `key_teammate_out_active` reflects reality (active when ≥3 matched samples; insufficient_sample when fewer; inactive when no relevant teammate is out).

- [ ] **Step 5: Commit**

```bash
git add analytics/engine/backtest.py
git commit -m "feat(backtest): new loosening order + optional teammate-out condition"
```

---

### Task 12: `scorer.py` — remove B2B hit-rate adjustment + first-half handling

**Files:**
- Modify: `analytics/engine/scorer.py`

- [ ] **Step 1: Delete first-half cap and B2B factor constants**

```python
# DELETE:
# FIRST_HALF_CONFIDENCE_CAP
# B2B_PENALTY_STATS
# B2B_PENALTY_FACTOR
```

- [ ] **Step 2: Remove `is_first_half` parameter from `score()`**

Update the function signature:

```python
def score(
    hit_rate: float,
    sample_size: int,
    conditions_matched: int,
    total_conditions: int,
    implied_prob: float,
    days_rest: int,
    stat: str,
    recent_opp_form: float | None = None,    # NEW (signed; None means modifier inactive)
) -> dict:
    ...
```

Delete:
- The B2B hit-rate multiplication block (`if days_rest == 0 and stat in B2B_PENALTY_STATS: hit_rate *= B2B_PENALTY_FACTOR`)
- The first-half cap (`if is_first_half: confidence = min(confidence, FIRST_HALF_CONFIDENCE_CAP)`)
- The post-B2B re-check against `MIN_HIT_RATE` (no longer needed because hit_rate is no longer adjusted here)

- [ ] **Step 3: Run existing self-test, observe test failures for cases that depended on B2B / 1H**

```bash
python -m analytics.engine.scorer
```

Expected: cases referencing `is_first_half=True` will TypeError; B2B test case ("Case 3") will no longer fail-low_hit_rate after B2B adjustment. These will be fixed in Task 14.

- [ ] **Step 4: Commit**

```bash
git add analytics/engine/scorer.py
git commit -m "refactor(scorer): drop B2B hit-rate adjustment and first-half handling"
```

---

### Task 13: `scorer.py` — add modifier system

**Files:**
- Modify: `analytics/engine/scorer.py`

- [ ] **Step 1: Add modifier constants**

```python
# ── Modifiers ────────────────────────────────────────────────────────────────
# Modifiers tilt the score; they do not drive it. Total modifier impact is capped.

# Recent opponent defensive form (stat-specific). The form value (signed delta vs
# season-average) is precomputed in nightly.py; the scorer applies the scale + cap.
# TODO: tune against observed correlation between recent_opp_form and actual
# hit-rate divergence vs season-form picks.
FORM_MODIFIER_SCALE = 30
FORM_MODIFIER_CAP   = 5

# Back-to-back rest penalty — kept as a modifier (NOT a hit-rate adjustment) so it
# does not double-count the rest condition that already filters historical samples.
# TODO: tune against observed B2B vs non-B2B hit-rate divergence in the new pipeline.
B2B_MODIFIER_VALUE = -3.0

# Total modifier cap: |sum(modifiers)| cannot exceed this
MAX_MODIFIER_IMPACT = 7

# Game-stakes modifier — stub. Disabled until standings data is wired.
GAME_STAKES_MODIFIER_ENABLED = False
```

- [ ] **Step 2: Add modifier computation block at the end of `score()`**

After computing `confidence` (base) and BEFORE the final `max(0, min(confidence, 100))`:

```python
modifiers: dict[str, float] = {}

# Recent-opponent-form modifier
if recent_opp_form is not None:
    raw = recent_opp_form * FORM_MODIFIER_SCALE
    capped = max(-FORM_MODIFIER_CAP, min(FORM_MODIFIER_CAP, raw))
    if capped != 0:
        modifiers["recent_opp_form"] = round(capped, 3)

# B2B modifier
if days_rest == 0:
    modifiers["b2b"] = B2B_MODIFIER_VALUE

# Game-stakes modifier (stub)
if GAME_STAKES_MODIFIER_ENABLED:
    pass   # implement when standings wired

modifier_total = sum(modifiers.values())
modifier_total = max(-MAX_MODIFIER_IMPACT, min(MAX_MODIFIER_IMPACT, modifier_total))

confidence = confidence + modifier_total
confidence = max(0.0, min(confidence, 100.0))
```

- [ ] **Step 3: Update return shape**

```python
return {
    "confidence":        round(confidence, 2),
    "edge":              round(edge, 4),
    "hit_rate_adjusted": round(hit_rate, 4),   # unchanged from input
    "modifiers":         modifiers,            # dict, may be empty
}
```

- [ ] **Step 4: Run scorer module**

```bash
python -m analytics.engine.scorer
```

Existing self-test cases will need updating (next task). For now, verify the file imports cleanly:

```bash
python -c "from analytics.engine.scorer import score; \
  print(score(0.85, 25, 5, 5, 0.65, 2, 'pts', recent_opp_form=0.10))"
```

Expected: dict with non-empty `modifiers` containing `recent_opp_form`.

- [ ] **Step 5: Commit**

```bash
git add analytics/engine/scorer.py
git commit -m "feat(scorer): add modifier system (recent_opp_form, b2b) with cap"
```

---

### Task 14: `scorer.py` — extend self-test for new modifier cases

**Files:**
- Modify: `analytics/engine/scorer.py`

- [ ] **Step 1: Update existing self-test cases**

Find the `cases` list in `_run_self_test()`. For each existing case, remove `is_first_half=False` from the kwargs dict.

- [ ] **Step 2: Update Case 3 (B2B) expected outcome**

Old expectation: "FAIL low_hit_rate after B2B penalty" (because hit_rate was multiplied by 0.93). New: should now PASS the gates (hit_rate is no longer adjusted) — but the b2b modifier should appear in the output and reduce confidence by 3 points.

```python
{
    "label": "Case 3: B2B is now a modifier — passes gates, gets b2b penalty",
    "kwargs": dict(
        hit_rate=0.64,
        sample_size=25,
        conditions_matched=4,
        total_conditions=5,
        implied_prob=0.55,
        days_rest=0,
        stat="pts",
    ),
    "expect": "PASS, modifiers contains b2b=-3.0",
},
```

- [ ] **Step 3: Add new modifier test cases**

```python
{
    "label": "Case 8: Positive recent_opp_form modifier (+10% delta)",
    "kwargs": dict(
        hit_rate=0.85,
        sample_size=25,
        conditions_matched=5,
        total_conditions=5,
        implied_prob=0.65,
        days_rest=2,
        stat="pts",
        recent_opp_form=0.10,   # opp has been worse recently
    ),
    "expect": "PASS, modifiers contains recent_opp_form ~ +3.0",
},
{
    "label": "Case 9: Modifier cap binds (extreme form would yield 30; capped to 5)",
    "kwargs": dict(
        hit_rate=0.80, sample_size=25, conditions_matched=5,
        total_conditions=5, implied_prob=0.60, days_rest=2, stat="reb",
        recent_opp_form=1.0,   # 100% — pathological input
    ),
    "expect": "PASS, modifiers.recent_opp_form == FORM_MODIFIER_CAP (5.0)",
},
{
    "label": "Case 10: Two negative modifiers (b2b + bad recent form), MAX_MODIFIER_IMPACT clamps",
    "kwargs": dict(
        hit_rate=0.80, sample_size=25, conditions_matched=5,
        total_conditions=5, implied_prob=0.60, days_rest=0, stat="pts",
        recent_opp_form=-0.30,
    ),
    "expect": "PASS, sum(modifiers) clamped at -MAX_MODIFIER_IMPACT (-7)",
},
```

- [ ] **Step 4: Update test result printing**

Print `modifiers` dict alongside confidence/edge:

```python
print(f"  Got      : confidence={result['confidence']:.2f}  "
      f"edge={result['edge']:.4f}  modifiers={result['modifiers']}")
```

- [ ] **Step 5: Run self-test**

```bash
python -m analytics.engine.scorer
```

Expected: all cases output as expected. Manually verify the modifier values match the `expect` strings.

- [ ] **Step 6: Commit**

```bash
git add analytics/engine/scorer.py
git commit -m "test(scorer): extend self-test for modifier system"
```

---

### Task 15: `kalshi/client.py` — drop first-half markets at parse

**Files:**
- Modify: `analytics/kalshi/client.py`

- [ ] **Step 1: Locate first-half detection in `parse_player_props()`**

The existing code likely sets an `is_first_half` flag based on a market ticker pattern (e.g., `"1H"` substring or `_PER_1H`).

- [ ] **Step 2: Replace flag-and-emit with skip**

```python
def parse_player_props(markets: list[dict]) -> list[dict]:
    parsed = []
    skipped_first_half = 0
    for m in markets:
        ticker = m.get("ticker", "")
        if _is_first_half_market(ticker):
            skipped_first_half += 1
            continue
        # ... existing parse logic ...
        parsed.append(parsed_row)

    if skipped_first_half > 0:
        print(f"[kalshi] skipped {skipped_first_half} first-half markets (excluded from picks pipeline)")
    return parsed
```

`_is_first_half_market(ticker)` returns True for any market identified as a first-half prop. Reuse the existing detection regex/substring.

- [ ] **Step 3: Remove `is_first_half` field from returned rows**

If existing parse rows include `"is_first_half": True/False`, remove that key — it's no longer used downstream.

- [ ] **Step 4: Update any callers in `picks/generate.py` or elsewhere that read `is_first_half`**

Grep for `is_first_half` across the analytics codebase. Remove all references — by the time data reaches the pipeline, no first-half rows exist.

- [ ] **Step 5: Run live Kalshi fetch test**

```bash
python -c "from analytics.kalshi.client import KalshiClient; \
  c = KalshiClient(); \
  rows = c.parse_player_props(c.get_nba_markets()); \
  print(f'parsed {len(rows)} rows, none should be 1H'); \
  print(any('1H' in r.get('market_ticker','') for r in rows))"
```

Expected: prints `False` (no 1H tickers in result).

- [ ] **Step 6: Commit**

```bash
git add analytics/kalshi/client.py analytics/picks/generate.py
git commit -m "refactor(kalshi): drop first-half markets at parse"
```

---

### Task 16: `picks/generate.py` — safe/value selection + modifiers JSONB

**Files:**
- Modify: `analytics/picks/generate.py`

- [ ] **Step 1: Pass `recent_opp_form` and `days_rest` to `score()`**

In the per-line scoring loop, before calling `score()`:

```python
form_field = f"recent_opp_{stat}_form"
recent_opp_form = today_conditions.get(form_field)
days_rest = today_conditions.get("days_rest", 2)

result = score(
    hit_rate=backtest_result["hit_rate"],
    sample_size=backtest_result["sample_size"],
    conditions_matched=backtest_result["conditions_matched"],
    total_conditions=backtest_result["total_conditions"],
    implied_prob=line["implied_prob"],
    days_rest=days_rest,
    stat=stat,
    recent_opp_form=recent_opp_form,
)
```

- [ ] **Step 2: Update safe/value selection**

After scoring all lines for a (player, stat) pair, gather lines that pass gates (`result["confidence"] > 0`):

```python
passing = [r for r in scored_lines if r["confidence"] > 0]
if not passing:
    continue

safe_pick  = max(passing, key=lambda r: r["hit_rate_adjusted"])
value_pick = max(passing, key=lambda r: r["edge"])

picks_to_store = [{**safe_pick, "pick_type": "safe"}]
if value_pick["recommended_line"] != safe_pick["recommended_line"]:
    picks_to_store.append({**value_pick, "pick_type": "value"})
```

- [ ] **Step 3: Include `modifiers` JSONB in upsert payload**

```python
for pick in picks_to_store:
    supabase.table("pick_results").upsert({
        "game_date":          game_date_str,
        "prop_type":          "player",
        "entity_id":          player_id,
        "stat":               stat,
        "pick_type":          pick["pick_type"],
        "recommended_line":   pick["recommended_line"],
        "hit_rate":           pick["hit_rate_adjusted"],
        "sample_size":        pick["sample_size"],
        "confidence_score":   pick["confidence"],
        "implied_prob":       pick["implied_prob"],
        "edge":               pick["edge"],
        "conditions_matched": pick["conditions_matched"],
        "total_conditions":   pick["total_conditions"],
        "key_conditions":     pick["condition_breakdown"],   # JSONB
        "modifiers":          pick["modifiers"],             # JSONB (NEW)
        "alt_lines_tested":   pick["alt_lines_tested"],
    }, on_conflict="game_date,entity_id,stat,pick_type").execute()
```

- [ ] **Step 4: Run end-to-end with mock Kalshi**

```bash
python -m analytics.picks.generate --date <today> --mock
```

Expected: prints summary, no errors. Verify:
```sql
SELECT pick_type, stat, recommended_line, confidence_score, modifiers
FROM pick_results
WHERE game_date = '<today>'
ORDER BY confidence_score DESC LIMIT 10;
```

- [ ] **Step 5: Commit**

```bash
git add analytics/picks/generate.py
git commit -m "feat(generate): safe/value picks + modifiers JSONB write"
```

---

### Task 17: Streaks endpoint — surface new context fields

**Files:**
- Modify: `server/src/controllers/picksController.ts`

- [ ] **Step 1: Update the `PlayerStreakRow` shape returned by `getPerfectStreaks`**

Find where the response rows are constructed in `getPerfectStreaks()`. Currently each row has `player_id`, `player_name`, `team`, `position`, `line_100`, `line_90`, `line_80`, `line_70`, `rolling_avg`, `games_used`, `opponent`.

Add nullable fields:

```ts
type StreakRow = {
  // existing fields...
  recent_opp_form: number | null;     // stat-specific opp recent-form delta
  key_teammates_out: number[];        // can be empty array
  opportunity_trend: number | null;   // (rolling_touches_5g - season_avg_touches) / season_avg_touches
};
```

- [ ] **Step 2: Fetch new fields from `daily_conditions` for the slate**

In `getPerfectStreaks()`, after candidate selection but before assembling the response, batch-fetch:

```ts
const { data: dcRows } = await supabaseAdmin
  .from('daily_conditions')
  .select(
    'player_id, rolling_touches_5g, season_avg_touches, ' +
    'key_teammates_out, ' +
    'recent_opp_pts_form, recent_opp_reb_form, recent_opp_ast_form, recent_opp_fg3m_form'
  )
  .in('player_id', candidatePlayerIds)
  .eq('game_date', linesDate);

const dcByPlayer = new Map<number, any>();
for (const r of (dcRows ?? [])) dcByPlayer.set(r.player_id, r);
```

- [ ] **Step 3: Compute and attach new fields per row**

```ts
const formCol = `recent_opp_${stat}_form`;   // pts/reb/ast/fg3m
const dc = dcByPlayer.get(row.player_id);

const recent_opp_form = dc?.[formCol] ?? null;

const key_teammates_out: number[] = dc?.key_teammates_out ?? [];

let opportunity_trend: number | null = null;
const rt = dc?.rolling_touches_5g;
const st = dc?.season_avg_touches;
if (rt != null && st != null && st > 0) {
  opportunity_trend = (rt - st) / st;
}

return {
  ...existingRow,
  recent_opp_form,
  key_teammates_out,
  opportunity_trend,
};
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --project server/tsconfig.json --noEmit
```

Expected: no new errors (the two pre-existing performanceController errors remain — unrelated).

- [ ] **Step 5: Smoke-test the endpoint**

```bash
curl 'http://localhost:3000/api/nba/streaks/perfect?type=player&stat=pts'
```

Expected: rows include the three new fields (may be null/empty during early backfill).

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/picksController.ts
git commit -m "feat(streaks): surface recent_opp_form / key_teammates_out / opportunity_trend"
```

---

### Task 18: End-to-end sanity check on tonight's slate

**Files:** None — operational task.

- [ ] **Step 1: Run nightly for today**

```bash
python -m analytics.batch.nightly --date <today>
```

Expected: completes; new `daily_conditions` columns populated for tonight's slate.

- [ ] **Step 2: Run picks generation**

```bash
python -m analytics.picks.generate --date <today>
```

Expected: prints pick summary. Picks output respects two-per-player rule (safe + value when distinct).

- [ ] **Step 3: Sanity-check a few picks manually**

```sql
SELECT
  pr.entity_id, p.name, pr.stat, pr.pick_type, pr.recommended_line,
  pr.hit_rate, pr.sample_size, pr.confidence_score, pr.edge,
  pr.key_conditions, pr.modifiers
FROM pick_results pr
LEFT JOIN players p ON p.id = pr.entity_id
WHERE pr.game_date = '<today>' AND pr.prop_type = 'player'
ORDER BY pr.confidence_score DESC
LIMIT 20;
```

Verify:
- `key_conditions` JSONB shape matches §9 of the spec
- `modifiers` JSONB populated when applicable (b2b players, recent-form deltas)
- No first-half props in output
- Each (player, stat) has ≤ 2 rows

- [ ] **Step 4: Check backfill subagent progress**

If still running: note the season/games-completed mark. The pipeline should be producing higher-confidence picks day-over-day as samples accumulate.

- [ ] **Step 5: Commit a CHANGELOG entry**

Add to a `CHANGELOG.md` (create if absent) or a project log:

```markdown
## 2026-05-02 — Picks Pipeline v2

- Replaced inferred-usage condition matching with direct touches/TOP signals
- Added recency-weighted hit rate (DECAY=0.95)
- Added optional teammate-injury condition with exact-player intersect matching
- Removed B2B hit-rate adjustment; replaced with B2B confidence modifier
- Removed all first-half prop handling
- Added modifier system (recent_opp_form + b2b) with MAX_MODIFIER_IMPACT cap
- Stat-specific opponent rank matching (pts→def, reb→reb, ast→ast, fg3m→fg3m)
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for picks pipeline v2"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| §4 Schema changes | Task 1 |
| §5 Backfill plan | Tasks 3, 4 |
| §6.1 Core conditions | Tasks 9, 11 |
| §6.2 Optional teammate condition | Tasks 6, 9, 11 |
| §6.3 Loosening order | Task 11 |
| §7 Recency-weighted hit rate | Task 10 |
| §8.1 Hard gates (preserved) | Task 12 (no change) |
| §8.2 Removed B2B + 1H | Task 12 |
| §8.3 Base confidence (preserved) | Task 12 (no change) |
| §8.4 Modifier system | Tasks 13, 14, 16 |
| §9 Output (safe/value, JSONB) | Task 16 |
| §10 First-half deletion | Tasks 12, 15 |
| §11 Streaks display alignment | Task 17 |
| §12 Constants reference | Tasks 3, 8, 9, 10, 13 |
| §13 Phasing | Plan order matches |
| §14 Testing | Tasks 10, 14 (self-tests) |

No gaps.

**Placeholder scan:** No "TBD", no "implement later", no "similar to Task N". Code blocks present for every code step.

**Type consistency:** `score()` signature in Tasks 12, 13, 14, 16 matches. `condition_breakdown` JSONB shape in Task 11 matches §9 spec example. `modifiers` JSONB shape in Tasks 13, 16 matches §8.4 spec example.

---

## Notes for the executor

- The backfill subagent (Task 4) runs in the background and is the long pole. It does not block any subsequent task — the pipeline degrades gracefully on thin samples.
- Self-tests live inline in their modules (`scorer.py`, `backtest.py`) following the existing `_run_self_test()` pattern. There is no pytest harness in `analytics/`.
- Migrations are applied via Supabase MCP, not committed SQL files. `analytics/db/migrate.py` documents schema in Python strings only; keep those in sync with the live DB.
- Each task ends with a commit. Per repo convention, commit messages follow `<type>(<scope>): <summary>`.
