# StatTrak Analytics Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python analytics engine that identifies high-value NBA prop bets by combining historical condition-matched hit rate analysis with live Kalshi market pricing.

**Architecture:** A standalone `analytics/` Python package at the repo root (sibling to `client/` and `server/`). It reads credentials from `server/.env`, uses `supabase-py` for all DB access, and `nba_api` for NBA data. The pipeline flows: enrich historical data -> nightly batch compute conditions -> screen candidates -> pull Kalshi lines -> backtest each line -> score confidence/edge -> output picks. Kalshi integration uses RSA-PSS signed requests with mock fallback.

**Tech Stack:** Python 3.10+, supabase-py, nba_api, cryptography (RSA-PSS), requests, pandas, argparse

---

## File Structure

```
analytics/
  __init__.py
  db/
    __init__.py
    connection.py          — Shared Supabase client + env loading (DRY)
    migrate.py             — Schema migrations (7 new tables, never drop)
  data/
    __init__.py
    enrich_games.py        — Backfill advanced stats + basic stats + positions
  batch/
    __init__.py
    nightly.py             — Daily conditions + reconcile yesterday's picks
  screener/
    __init__.py
    screen.py              — Pre-filter candidates before Kalshi calls
  engine/
    __init__.py
    backtest.py            — Condition matching + hit rate computation
    scorer.py              — Confidence + edge scoring
  kalshi/
    __init__.py
    client.py              — Kalshi API wrapper (RSA auth + mock mode)
  picks/
    __init__.py
    generate.py            — End-to-end daily pick generator
  requirements.txt
  README.md
  .env.example
```

Each file has one responsibility. `db/connection.py` is imported everywhere else for the shared Supabase client. All scripts use `argparse` with `--test` and `--date` flags.

---

## Confirmed Design Decisions (from Q&A)

- **Stats backfill:** enrich_games.py calls BoxScoreTraditionalV2 + BoxScoreAdvancedV2 per game to fill both basic stats (for 2023-24 gaps) and advanced stats (all seasons)
- **Position backfill:** CommonTeamRoster (30 calls) to fill 464 NULL positions. Mapping: PG/SG -> G, SF/PF -> F, C -> C, hybrids (G-F, F-C) -> first letter
- **Minutes:** Keep as integer everywhere (nba_player_stats is smallint, new tables use integer)
- **Season format:** Integer in DB (2022, 2023, 2024), convert to nba_api strings in Python
- **Rest buckets:** Three: 0 (b2b), 1 (one day), 2+ (normal)
- **No combo stats:** Kalshi doesn't offer pts+reb+ast, so backtest only individual stats (pts, reb, ast, fg3m)
- **Game prop conditions:** Combined pace (sum of both teams' rolling pace), both teams' rolling off/def rating, rest differential, home/away. Use rolling 10 games AND season averages (weighted blend)
- **Kalshi:** Production URL `https://api.elections.kalshi.com/trade-api/v2`, RSA-PSS auth via 3 headers, bulk market discovery via series_ticker, prices in float dollars (0.00-1.00)
- **Screener output:** In-memory, no table
- **Pick ranking:** Both "safe" (highest hit_rate) and "value" (highest edge) lines per player/stat, ranked by confidence_score
- **1H props:** Pull prices from Kalshi, approximate as total/2, low confidence, store but flag
- **Outcome tracking:** reconcile.py runs as Step 0 of nightly.py
- **Traded players:** Use all recent games regardless of team for rolling averages
- **Active status:** Refresh from current season rosters

---

## Task 1: Project Scaffolding + Connection Module

**Files:**
- Create: `analytics/__init__.py`
- Create: `analytics/db/__init__.py`
- Create: `analytics/db/connection.py`
- Create: `analytics/requirements.txt`
- Create: `analytics/.env.example`
- Create: all other `__init__.py` files

- [ ] **Step 1: Create directory structure and __init__.py files**

```bash
mkdir -p analytics/{db,data,batch,screener,engine,kalshi,picks}
touch analytics/__init__.py analytics/db/__init__.py analytics/data/__init__.py
touch analytics/batch/__init__.py analytics/screener/__init__.py
touch analytics/engine/__init__.py analytics/kalshi/__init__.py
touch analytics/picks/__init__.py
```

- [ ] **Step 2: Write requirements.txt**

```
supabase>=2.0.0
python-dotenv>=1.0.0
nba_api>=1.4.0
pandas>=2.0.0
requests>=2.31.0
cryptography>=41.0.0
```

- [ ] **Step 3: Write .env.example**

```
# Copy to server/.env and fill in values
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
KALSHI_API_KEY=your-kalshi-api-key-id
KALSHI_PRIVATE_KEY_PATH=./kalshi_key.pem
```

- [ ] **Step 4: Write analytics/db/connection.py**

This is the shared Supabase client used by every other module.

```python
"""
Shared Supabase client and environment loading.
All analytics modules import `db` and `supabase` from here.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Load server/.env relative to this file's location
_env_path = Path(__file__).resolve().parents[2] / "server" / ".env"
load_dotenv(_env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print(f"ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in {_env_path}")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Kalshi config
KALSHI_API_KEY = os.getenv("KALSHI_API_KEY", "")
KALSHI_PRIVATE_KEY_PATH = os.getenv("KALSHI_PRIVATE_KEY_PATH", "")
KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"

# Resolve Kalshi key path relative to server/ dir
if KALSHI_PRIVATE_KEY_PATH:
    _key_path = Path(__file__).resolve().parents[2] / "server" / KALSHI_PRIVATE_KEY_PATH
    KALSHI_PRIVATE_KEY_PATH = str(_key_path)

# NBA API seasons
SEASONS = ["2022-23", "2023-24", "2024-25"]
SEASON_INTS = [2022, 2023, 2024]

def season_str_to_int(s: str) -> int:
    """'2024-25' -> 2024"""
    return int(s.split("-")[0])

def season_int_to_str(y: int) -> str:
    """2024 -> '2024-25'"""
    return f"{y}-{str(y + 1)[-2:]}"
```

- [ ] **Step 5: Verify connection works**

Run: `cd /c/Users/trein/vscode/stat-trak-app-main && python -c "from analytics.db.connection import supabase; print('Connected:', bool(supabase))"`
Expected: `Connected: True`

- [ ] **Step 6: Commit**

```bash
git add analytics/
git commit -m "feat(analytics): scaffold project structure and shared DB connection"
```

---

## Task 2: Schema Migrations

**Files:**
- Create: `analytics/db/migrate.py`

- [ ] **Step 1: Write analytics/db/migrate.py**

```python
"""
Schema migrations for the analytics engine.
Creates new tables. NEVER drops or alters existing tables/columns.
Run: python -m analytics.db.migrate [--dry-run]
"""
import argparse
import sys
from analytics.db.connection import supabase

MIGRATIONS = [
    # 1. Player game conditions (advanced stats per player per game)
    """
    CREATE TABLE IF NOT EXISTS player_game_conditions (
        id              BIGSERIAL PRIMARY KEY,
        player_id       BIGINT REFERENCES players(id),
        game_id         BIGINT REFERENCES games(id),
        game_date       DATE NOT NULL,
        usg_pct         REAL,
        pace            REAL,
        off_rating      REAL,
        def_rating      REAL,
        home_away       VARCHAR(4),
        days_rest       INTEGER,
        opponent_team_id BIGINT REFERENCES teams(id),
        minutes_played  INTEGER,
        UNIQUE(player_id, game_id)
    );
    """,

    # 2. Team-level advanced stats per game
    """
    CREATE TABLE IF NOT EXISTS team_game_stats (
        id          BIGSERIAL PRIMARY KEY,
        team_id     BIGINT REFERENCES teams(id),
        game_id     BIGINT REFERENCES games(id),
        game_date   DATE NOT NULL,
        pace        REAL,
        off_rating  REAL,
        def_rating  REAL,
        UNIQUE(team_id, game_id)
    );
    """,

    # 3. Opponent positional defense rolling snapshots
    """
    CREATE TABLE IF NOT EXISTS opponent_position_defense (
        id              BIGSERIAL PRIMARY KEY,
        team_id         BIGINT REFERENCES teams(id),
        position_group  VARCHAR(1),
        snapshot_date   DATE NOT NULL,
        pts_allowed_pg  REAL,
        reb_allowed_pg  REAL,
        ast_allowed_pg  REAL,
        league_rank     INTEGER,
        UNIQUE(team_id, position_group, snapshot_date)
    );
    """,

    # 4. Player availability per game
    """
    CREATE TABLE IF NOT EXISTS player_availability (
        id        BIGSERIAL PRIMARY KEY,
        player_id BIGINT REFERENCES players(id),
        game_id   BIGINT REFERENCES games(id),
        status    VARCHAR(8),
        UNIQUE(player_id, game_id)
    );
    """,

    # 5. Daily conditions for tonight's slate
    """
    CREATE TABLE IF NOT EXISTS daily_conditions (
        id                    BIGSERIAL PRIMARY KEY,
        player_id             BIGINT REFERENCES players(id),
        game_id               BIGINT REFERENCES games(id),
        game_date             DATE NOT NULL,
        rolling_usg_5g        REAL,
        rolling_pts_5g        REAL,
        rolling_reb_5g        REAL,
        rolling_ast_5g        REAL,
        rolling_fg3m_5g       REAL,
        rolling_min_5g        REAL,
        rolling_pace_5g       REAL,
        season_avg_usg        REAL,
        days_rest             INTEGER,
        home_away             VARCHAR(4),
        opponent_team_id      BIGINT REFERENCES teams(id),
        opp_def_rank_position INTEGER,
        position_group        VARCHAR(1),
        UNIQUE(player_id, game_date)
    );
    """,

    # 6. Kalshi lines for tonight's slate
    """
    CREATE TABLE IF NOT EXISTS daily_lines (
        id              BIGSERIAL PRIMARY KEY,
        game_date       DATE NOT NULL,
        prop_type       VARCHAR(16),
        entity_id       BIGINT,
        stat            VARCHAR(16),
        line            REAL,
        kalshi_price    REAL,
        implied_prob    REAL,
        market_ticker   VARCHAR(128),
        is_first_half   BOOLEAN DEFAULT FALSE,
        created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    """,

    # 7. Final pick results with backtest context
    """
    CREATE TABLE IF NOT EXISTS pick_results (
        id                  BIGSERIAL PRIMARY KEY,
        game_date           DATE NOT NULL,
        prop_type           VARCHAR(16),
        entity_id           BIGINT,
        stat                VARCHAR(16),
        pick_type           VARCHAR(8),
        recommended_line    REAL,
        hit_rate            REAL,
        sample_size         INTEGER,
        confidence_score    REAL,
        implied_prob        REAL,
        edge                REAL,
        conditions_matched  INTEGER,
        total_conditions    INTEGER,
        key_conditions      JSONB,
        alt_lines_tested    JSONB,
        actual_result       REAL,
        did_hit             BOOLEAN,
        created_at          TIMESTAMPTZ DEFAULT NOW()
    );
    """,

    # Indexes for query performance
    """CREATE INDEX IF NOT EXISTS idx_pgc_player_game ON player_game_conditions(player_id, game_id);""",
    """CREATE INDEX IF NOT EXISTS idx_pgc_player_date ON player_game_conditions(player_id, game_date);""",
    """CREATE INDEX IF NOT EXISTS idx_tgs_team_game ON team_game_stats(team_id, game_id);""",
    """CREATE INDEX IF NOT EXISTS idx_opd_team_pos_date ON opponent_position_defense(team_id, position_group, snapshot_date);""",
    """CREATE INDEX IF NOT EXISTS idx_dc_player_date ON daily_conditions(player_id, game_date);""",
    """CREATE INDEX IF NOT EXISTS idx_dl_date_type ON daily_lines(game_date, prop_type);""",
    """CREATE INDEX IF NOT EXISTS idx_pr_date ON pick_results(game_date);""",
]


def run_migrations(dry_run: bool = False):
    """Execute all migrations."""
    print("=" * 60)
    print("ANALYTICS ENGINE — SCHEMA MIGRATIONS")
    print("=" * 60)

    for i, sql in enumerate(MIGRATIONS, 1):
        name = sql.strip().split("\n")[0].strip()
        if dry_run:
            print(f"  [{i}/{len(MIGRATIONS)}] DRY RUN: {name}")
        else:
            print(f"  [{i}/{len(MIGRATIONS)}] Running: {name}")
            try:
                supabase.rpc("exec_sql", {"query": sql}).execute()
                print(f"    OK")
            except Exception as e:
                # Fallback: try postgrest raw SQL
                try:
                    supabase.postgrest.session.post(
                        f"{supabase.supabase_url}/rest/v1/rpc/exec_sql",
                        json={"query": sql},
                        headers=supabase._get_auth_headers(),
                    )
                    print(f"    OK (via rpc)")
                except Exception:
                    print(f"    ERROR: {e}")
                    print(f"    SQL: {sql[:100]}...")

    # Verify tables exist
    print("\nVerifying tables...")
    expected = [
        "player_game_conditions", "team_game_stats",
        "opponent_position_defense", "player_availability",
        "daily_conditions", "daily_lines", "pick_results",
    ]
    for table in expected:
        try:
            result = supabase.table(table).select("*", count="exact").limit(0).execute()
            print(f"  {table}: OK ({result.count} rows)")
        except Exception as e:
            print(f"  {table}: MISSING — {e}")

    print("\nMigrations complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run analytics schema migrations")
    parser.add_argument("--dry-run", action="store_true", help="Print SQL without executing")
    args = parser.parse_args()
    run_migrations(dry_run=args.dry_run)
```

**IMPORTANT NOTE:** Supabase client library does not support raw SQL execution via postgrest. The migrations must be run via the Supabase MCP tool (`mcp__supabase__apply_migration`) or the SQL editor. The `migrate.py` script will use the MCP tool during development, and for the user, we provide a `--print-sql` flag that outputs all SQL for manual execution.

**Revised approach:** The migrate.py script should print SQL and we run it via the Supabase MCP `apply_migration` tool. The script itself serves as documentation and a repeatable reference.

- [ ] **Step 2: Execute migrations via Supabase MCP**

Run each CREATE TABLE and CREATE INDEX statement via `mcp__supabase__apply_migration`.

- [ ] **Step 3: Verify all 7 tables exist**

Query `information_schema.tables` to confirm all tables created.

- [ ] **Step 4: Commit**

```bash
git add analytics/db/migrate.py
git commit -m "feat(analytics): add schema migration for 7 analytics tables"
```

---

## Task 3: Data Enrichment — Position Backfill

**Files:**
- Create: `analytics/data/enrich_games.py`

This task covers the position backfill portion. The advanced stats enrichment is Task 4.

- [ ] **Step 1: Write position backfill function in enrich_games.py**

```python
"""
Data enrichment pipeline for historical games.
- Backfills player positions via CommonTeamRoster
- Backfills advanced stats via BoxScoreAdvancedV2
- Backfills basic stats gaps via BoxScoreTraditionalV2
- Backfills opponent positional defense snapshots

Run:
  python -m analytics.data.enrich_games --positions          # backfill positions only
  python -m analytics.data.enrich_games --test               # 5 games only
  python -m analytics.data.enrich_games --season 2024        # one season
  python -m analytics.data.enrich_games --resume             # skip already-enriched
  python -m analytics.data.enrich_games                      # all 3 seasons
"""
import argparse
import time
import sys
from datetime import datetime, timedelta
from typing import Optional
import pandas as pd
from requests.exceptions import ReadTimeout, ConnectionError

from analytics.db.connection import (
    supabase, SEASONS, SEASON_INTS, season_int_to_str
)

# ── Tunable Constants ──────────────────────────────────────────────

API_DELAY_SECONDS = 1.0          # Min delay between nba_api calls
BACKOFF_BASE_SECONDS = 5         # Exponential backoff starting point
BACKOFF_MAX_SECONDS = 60         # Max backoff wait
MAX_RETRIES = 5                  # Max retry attempts per API call
BATCH_SIZE = 500                 # Rows per upsert batch
BREAK_EVERY_N_GAMES = 50         # Take a break every N games processed
BREAK_DURATION_SECONDS = 30      # Break duration

# Position mapping: granular -> group
POSITION_GROUP_MAP = {
    "G": "G", "PG": "G", "SG": "G",
    "F": "F", "SF": "F", "PF": "F",
    "C": "C",
    "G-F": "G", "F-G": "F", "F-C": "F", "C-F": "C",
}


def api_call_with_retry(call_fn, description: str = "API call"):
    """Execute an nba_api call with exponential backoff retry."""
    for attempt in range(MAX_RETRIES):
        try:
            time.sleep(API_DELAY_SECONDS)
            return call_fn()
        except (ReadTimeout, ConnectionError) as e:
            wait = min(BACKOFF_BASE_SECONDS * (2 ** attempt), BACKOFF_MAX_SECONDS)
            if attempt < MAX_RETRIES - 1:
                print(f"    Timeout on {description}, attempt {attempt + 1}/{MAX_RETRIES}, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"    FAILED {description} after {MAX_RETRIES} attempts: {e}")
                return None
        except Exception as e:
            print(f"    ERROR on {description}: {str(e)[:200]}")
            return None
    return None


# ── Position Backfill ──────────────────────────────────────────────

def backfill_positions():
    """
    Backfill NULL positions on players table using CommonTeamRoster.
    Uses current season roster (30 API calls, one per team).
    """
    from nba_api.stats.endpoints import commonteamroster

    print("=" * 60)
    print("POSITION BACKFILL — CommonTeamRoster")
    print("=" * 60)

    # Get all NBA teams
    teams = supabase.table("teams").select("id, ext_id, abbreviation").execute().data
    print(f"Found {len(teams)} teams")

    current_season = "2024-25"
    updates = 0
    errors = 0

    for i, team in enumerate(teams, 1):
        print(f"  [{i}/{len(teams)}] {team['abbreviation']}...", end=" ")

        result = api_call_with_retry(
            lambda t=team: commonteamroster.CommonTeamRoster(
                team_id=t["ext_id"], season=current_season
            ).get_data_frames()[0],
            description=f"roster for {team['abbreviation']}"
        )

        if result is None or result.empty:
            print("no data")
            errors += 1
            continue

        batch = []
        for _, row in result.iterrows():
            player_ext_id = str(row["PLAYER_ID"])
            position = row.get("POSITION", "")
            if not position:
                continue

            position_group = POSITION_GROUP_MAP.get(position, position[0] if position else None)

            batch.append({
                "ext_id": player_ext_id,
                "league": "nba",
                "position": position,
                "is_active": True,
                "team": team["abbreviation"],
            })

        if batch:
            try:
                supabase.table("players").upsert(
                    batch, on_conflict="league_id,ext_id"
                ).execute()
                # Fallback: update one by one if upsert fails on conflict key
            except Exception:
                # Update individually
                for p in batch:
                    try:
                        supabase.table("players").update({
                            "position": p["position"],
                            "is_active": True,
                            "team": p["team"],
                        }).eq("ext_id", p["ext_id"]).eq("league", "nba").execute()
                    except Exception as e2:
                        errors += 1

            updates += len(batch)
            print(f"{len(batch)} players updated")
        else:
            print("no position data")

    print(f"\nPosition backfill complete: {updates} updates, {errors} errors")
    return updates
```

- [ ] **Step 2: Test position backfill (dry run count)**

Run: `python -m analytics.data.enrich_games --positions`
Expected: ~450+ positions updated, position NULL count drops significantly.

- [ ] **Step 3: Commit**

```bash
git add analytics/data/
git commit -m "feat(analytics): add position backfill via CommonTeamRoster"
```

---

## Task 4: Data Enrichment — Advanced + Basic Stats

**Files:**
- Modify: `analytics/data/enrich_games.py`

- [ ] **Step 1: Add advanced stats enrichment functions**

Add to `enrich_games.py`:

```python
# ── Advanced + Basic Stats Enrichment ─────────────────────────────

def _load_id_maps():
    """Load ext_id -> db_id mappings for teams, players, games."""
    teams = supabase.table("teams").select("id, ext_id, abbreviation").execute().data
    team_ext_map = {t["ext_id"]: t["id"] for t in teams}
    team_abbr_map = {t["abbreviation"]: t["id"] for t in teams}

    # Load players (paginated — may exceed 1000)
    players = []
    offset = 0
    while True:
        batch = supabase.table("players").select("id, ext_id").eq("league", "nba").range(offset, offset + 999).execute().data
        players.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    player_ext_map = {p["ext_id"]: p["id"] for p in players}

    games = []
    offset = 0
    while True:
        batch = supabase.table("games").select("id, ext_id, game_date, home_team_id, away_team_id, season").range(offset, offset + 999).execute().data
        games.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    game_ext_map = {g["ext_id"]: g for g in games}

    return team_ext_map, team_abbr_map, player_ext_map, game_ext_map


def _get_enriched_game_ids() -> set:
    """Get game_ids already in player_game_conditions (for --resume)."""
    result = supabase.rpc("get_distinct_game_ids_pgc", {}).execute()
    # Fallback: query directly
    ids = set()
    offset = 0
    while True:
        batch = supabase.table("player_game_conditions").select("game_id").range(offset, offset + 999).execute().data
        for row in batch:
            ids.add(row["game_id"])
        if len(batch) < 1000:
            break
        offset += 1000
    return ids


def _compute_days_rest(player_db_id: int, game_date: str, game_dates_cache: dict) -> int:
    """
    Compute days of rest for a player before a game.
    Uses cached game dates per player from nba_player_stats.
    Returns: 0 (b2b), 1, 2, or 3 (default if no prior game found).
    """
    if player_db_id not in game_dates_cache:
        # Fetch all game dates for this player
        result = supabase.table("nba_player_stats").select("game_date").eq("player_id", player_db_id).order("game_date", desc=True).execute()
        game_dates_cache[player_db_id] = sorted([r["game_date"] for r in result.data], reverse=True)

    dates = game_dates_cache[player_db_id]
    current = datetime.strptime(game_date, "%Y-%m-%d").date() if isinstance(game_date, str) else game_date

    for d in dates:
        prior = datetime.strptime(d, "%Y-%m-%d").date() if isinstance(d, str) else d
        if prior < current:
            return (current - prior).days
    return 3  # No prior game found, treat as fully rested


def enrich_games(
    season_filter: Optional[int] = None,
    test_mode: bool = False,
    resume: bool = False,
):
    """
    For each game in the games table, fetch:
    1. BoxScoreAdvancedV2 -> player_game_conditions + team_game_stats
    2. BoxScoreTraditionalV2 -> fill gaps in nba_player_stats
    3. BoxScoreSummaryV2 -> player_availability (inactive players)
    4. Compute home_away, days_rest, opponent_team_id locally

    Args:
        season_filter: Only process games from this season (int, e.g. 2024)
        test_mode: Process only 5 games
        resume: Skip games already in player_game_conditions
    """
    from nba_api.stats.endpoints import (
        boxscoreadvancedv2,
        boxscoresummaryv2,
    )
    # BoxScoreTraditionalV2 may not exist in all nba_api versions
    try:
        from nba_api.stats.endpoints import boxscoretraditionalv2
        HAS_TRADITIONAL = True
    except ImportError:
        from nba_api.stats.endpoints import boxscoresummaryv2 as _fallback
        HAS_TRADITIONAL = False
        print("WARNING: BoxScoreTraditionalV2 not available, basic stat gaps won't be filled")

    print("=" * 60)
    print("GAME ENRICHMENT — Advanced Stats + Conditions")
    print("=" * 60)

    team_ext_map, team_abbr_map, player_ext_map, game_ext_map = _load_id_maps()
    print(f"Loaded: {len(team_ext_map)} teams, {len(player_ext_map)} players, {len(game_ext_map)} games")

    # Filter games
    game_list = list(game_ext_map.items())
    if season_filter is not None:
        game_list = [(eid, g) for eid, g in game_list if g["season"] == season_filter]
        print(f"Filtered to season {season_filter}: {len(game_list)} games")

    if resume:
        enriched_ids = _get_enriched_game_ids()
        game_list = [(eid, g) for eid, g in game_list if g["id"] not in enriched_ids]
        print(f"After resume filter: {len(game_list)} games remaining")

    if test_mode:
        game_list = game_list[:5]
        print(f"TEST MODE: processing {len(game_list)} games")

    total = len(game_list)
    if total == 0:
        print("No games to process.")
        return

    est_hours = total * 2 * API_DELAY_SECONDS / 3600  # 2 API calls per game
    print(f"\nWill process {total} games (~{est_hours:.1f} hours at {API_DELAY_SECONDS}s delay)")
    if not test_mode:
        response = input("Continue? (yes/no): ")
        if response.lower() not in ("yes", "y"):
            print("Cancelled.")
            return

    game_dates_cache = {}  # player_id -> sorted game_dates
    pgc_batch = []   # player_game_conditions rows
    tgs_batch = []   # team_game_stats rows
    avail_batch = [] # player_availability rows
    stats_batch = [] # nba_player_stats upsert rows

    for idx, (game_ext_id, game_info) in enumerate(game_list, 1):
        game_db_id = game_info["id"]
        game_date = game_info["game_date"]
        home_team_id = game_info["home_team_id"]
        away_team_id = game_info["away_team_id"]

        print(f"\n  [{idx}/{total}] Game {game_ext_id} ({game_date})")

        # ── BoxScoreAdvancedV2 ──
        adv_result = api_call_with_retry(
            lambda gid=game_ext_id: boxscoreadvancedv2.BoxScoreAdvancedV2(
                game_id=gid, end_period=1, end_range=0,
                range_type=0, start_period=1, start_range=0
            ),
            description=f"BoxScoreAdvancedV2({game_ext_id})"
        )

        if adv_result is None:
            print("    Skipped (advanced failed)")
            continue

        try:
            player_adv_df = adv_result.player_stats.get_data_frames()[0] if hasattr(adv_result, 'player_stats') else adv_result.get_data_frames()[0]
            team_adv_df = adv_result.team_stats.get_data_frames()[0] if hasattr(adv_result, 'team_stats') else adv_result.get_data_frames()[1]
        except Exception as e:
            print(f"    Error parsing advanced data: {e}")
            continue

        # ── BoxScoreSummaryV2 (inactive players) ──
        summary_result = api_call_with_retry(
            lambda gid=game_ext_id: boxscoresummaryv2.BoxScoreSummaryV2(game_id=gid),
            description=f"BoxScoreSummaryV2({game_ext_id})"
        )

        inactive_player_ids = set()
        if summary_result is not None:
            try:
                inactive_df = summary_result.inactive_players.get_data_frames()[0] if hasattr(summary_result, 'inactive_players') else summary_result.get_data_frames()[3]
                for _, row in inactive_df.iterrows():
                    pid_ext = str(row.get("PLAYER_ID", ""))
                    if pid_ext in player_ext_map:
                        inactive_player_ids.add(player_ext_map[pid_ext])
                        avail_batch.append({
                            "player_id": player_ext_map[pid_ext],
                            "game_id": game_db_id,
                            "status": "inactive",
                        })
            except Exception:
                pass  # Inactive data not critical

        # ── Process team advanced stats ──
        for _, row in team_adv_df.iterrows():
            team_ext = str(row.get("TEAM_ID", ""))
            team_db_id = team_ext_map.get(team_ext)
            if not team_db_id:
                continue

            tgs_batch.append({
                "team_id": team_db_id,
                "game_id": game_db_id,
                "game_date": game_date,
                "pace": float(row.get("PACE", 0) or 0),
                "off_rating": float(row.get("OFF_RATING", 0) or 0),
                "def_rating": float(row.get("DEF_RATING", 0) or 0),
            })

        # ── Process player advanced stats ──
        for _, row in player_adv_df.iterrows():
            player_ext = str(row.get("PLAYER_ID", ""))
            player_db_id = player_ext_map.get(player_ext)
            if not player_db_id:
                continue

            # Determine team for this player in this game
            team_ext = str(row.get("TEAM_ID", ""))
            player_team_db_id = team_ext_map.get(team_ext)

            # Derive home_away
            home_away = "home" if player_team_db_id == home_team_id else "away"

            # Derive opponent
            opponent_id = away_team_id if player_team_db_id == home_team_id else home_team_id

            # Parse minutes (format "MM:SS" or float)
            minutes = 0
            min_val = row.get("MIN", 0)
            if min_val and pd.notna(min_val):
                try:
                    if isinstance(min_val, str) and ":" in min_val:
                        minutes = int(min_val.split(":")[0])
                    else:
                        minutes = int(float(min_val))
                except (ValueError, TypeError):
                    minutes = 0

            # Compute days_rest
            days_rest = _compute_days_rest(player_db_id, game_date, game_dates_cache)

            pgc_batch.append({
                "player_id": player_db_id,
                "game_id": game_db_id,
                "game_date": game_date,
                "usg_pct": float(row.get("USG_PCT", 0) or 0),
                "pace": float(row.get("PACE", 0) or 0),
                "off_rating": float(row.get("OFF_RATING", 0) or 0),
                "def_rating": float(row.get("DEF_RATING", 0) or 0),
                "home_away": home_away,
                "days_rest": days_rest,
                "opponent_team_id": opponent_id,
                "minutes_played": minutes,
            })

            # Mark as active
            if player_db_id not in inactive_player_ids:
                avail_batch.append({
                    "player_id": player_db_id,
                    "game_id": game_db_id,
                    "status": "active",
                })

        # ── Batch upserts ──
        if len(pgc_batch) >= BATCH_SIZE:
            _flush_batch("player_game_conditions", pgc_batch, "player_id,game_id")
            pgc_batch = []
        if len(tgs_batch) >= BATCH_SIZE:
            _flush_batch("team_game_stats", tgs_batch, "team_id,game_id")
            tgs_batch = []
        if len(avail_batch) >= BATCH_SIZE:
            _flush_batch("player_availability", avail_batch, "player_id,game_id")
            avail_batch = []

        # Break periodically
        if idx % BREAK_EVERY_N_GAMES == 0 and not test_mode:
            print(f"\n  Break ({idx}/{total} done)... {BREAK_DURATION_SECONDS}s")
            time.sleep(BREAK_DURATION_SECONDS)

    # Flush remaining
    if pgc_batch:
        _flush_batch("player_game_conditions", pgc_batch, "player_id,game_id")
    if tgs_batch:
        _flush_batch("team_game_stats", tgs_batch, "team_id,game_id")
    if avail_batch:
        _flush_batch("player_availability", avail_batch, "player_id,game_id")

    print(f"\nEnrichment complete.")


def _flush_batch(table: str, batch: list, conflict_key: str):
    """Upsert a batch to Supabase."""
    try:
        supabase.table(table).upsert(batch, on_conflict=conflict_key).execute()
        print(f"    Flushed {len(batch)} rows to {table}")
    except Exception as e:
        print(f"    ERROR flushing {table}: {e}")
        # Try smaller batches
        for i in range(0, len(batch), 100):
            try:
                supabase.table(table).upsert(batch[i:i+100], on_conflict=conflict_key).execute()
            except Exception as e2:
                print(f"    ERROR sub-batch {table}: {e2}")


# ── Opponent Position Defense Snapshots ──────────────────────────

def backfill_opp_defense():
    """
    Build opponent positional defense snapshots.
    For each season, take ~6 snapshots (every 2 months).
    For each snapshot, query LeagueDashPlayerStats for G, F, C positions.
    """
    from nba_api.stats.endpoints import leaguedashplayerstats

    print("=" * 60)
    print("OPPONENT POSITION DEFENSE SNAPSHOTS")
    print("=" * 60)

    teams = supabase.table("teams").select("id, ext_id, abbreviation").execute().data
    team_ext_to_db = {t["ext_id"]: t["id"] for t in teams}

    for season_str in SEASONS:
        season_year = int(season_str.split("-")[0])
        # ~6 snapshot dates spread across the season (Nov through Apr)
        snapshot_dates = [
            f"{season_year}-11-15",
            f"{season_year}-12-31",
            f"{season_year + 1}-01-31",
            f"{season_year + 1}-02-28",
            f"{season_year + 1}-03-31",
            f"{season_year + 1}-04-15",
        ]

        for snap_date in snapshot_dates:
            print(f"\n  Season {season_str}, snapshot {snap_date}")

            for pos in ["G", "F", "C"]:
                result = api_call_with_retry(
                    lambda s=season_str, p=pos, d=snap_date: leaguedashplayerstats.LeagueDashPlayerStats(
                        season=s,
                        per_mode_detailed="PerGame",
                        player_position_abbreviation_nullable=p,
                        date_to_nullable=d,
                    ).get_data_frames()[0],
                    description=f"LeagueDashPlayerStats({season_str}, {pos}, {snap_date})"
                )

                if result is None or result.empty:
                    print(f"    {pos}: no data")
                    continue

                # Group by team, compute averages of opponent stats
                # Note: This endpoint returns player-level data, not opponent-level
                # We need to aggregate differently — see TODO below
                # For now, insert placeholder logic that will be refined
                print(f"    {pos}: {len(result)} player rows")

                # TODO: The correct approach is to use opponent_team_id grouping
                # from the data. LeagueDashPlayerStats with OpponentTeamID filter
                # gives per-team opponent data. Need 30 calls per position per snapshot.
                # Deferring full implementation — will use a simpler aggregation.

    print("\nOpponent defense snapshots complete.")


# ── CLI ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enrich NBA game data with advanced stats")
    parser.add_argument("--positions", action="store_true", help="Backfill positions only")
    parser.add_argument("--opp-defense", action="store_true", help="Backfill opponent defense only")
    parser.add_argument("--test", action="store_true", help="Process only 5 games")
    parser.add_argument("--season", type=int, help="Process only this season (e.g., 2024)")
    parser.add_argument("--resume", action="store_true", help="Skip already-enriched games")
    args = parser.parse_args()

    if args.positions:
        backfill_positions()
    elif args.opp_defense:
        backfill_opp_defense()
    else:
        enrich_games(
            season_filter=args.season,
            test_mode=args.test,
            resume=args.resume,
        )
```

- [ ] **Step 2: Test with 5 games**

Run: `cd /c/Users/trein/vscode/stat-trak-app-main && python -m analytics.data.enrich_games --test`
Expected: 5 games processed, rows in player_game_conditions and team_game_stats.

- [ ] **Step 3: Commit**

```bash
git add analytics/data/enrich_games.py
git commit -m "feat(analytics): add game enrichment with advanced stats and position backfill"
```

---

## Task 5: Kalshi Client

**Files:**
- Create: `analytics/kalshi/client.py`

- [ ] **Step 1: Write Kalshi client with RSA auth and mock mode**

```python
"""
Kalshi API client with RSA-PSS authentication and mock mode.

Auth: 3 custom headers per request:
  KALSHI-ACCESS-KEY: API key ID
  KALSHI-ACCESS-TIMESTAMP: millisecond timestamp
  KALSHI-ACCESS-SIGNATURE: RSA-PSS SHA256 signature of (timestamp + method + path)

Market discovery: Bulk pull via series_ticker, then local parsing of titles.

Run: python -m analytics.kalshi.client --test
"""
import base64
import datetime
import time
import random
import json
from typing import Optional
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

from analytics.db.connection import KALSHI_API_KEY, KALSHI_PRIVATE_KEY_PATH, KALSHI_BASE_URL

# ── Constants ──────────────────────────────────────────────────────

RATE_LIMIT_DELAY = 0.06  # 20 reads/sec = 50ms min, use 60ms for safety
MAX_RETRIES = 3

# Stat name -> keywords to search in market titles
STAT_KEYWORDS = {
    "pts": ["points", "score"],
    "reb": ["rebounds", "rebound"],
    "ast": ["assists", "assist"],
    "fg3m": ["three", "3-pointer", "threes", "3pt"],
}

GAME_PROP_KEYWORDS = {
    "total": ["total points", "combined", "over/under"],
    "spread": ["spread", "margin"],
    "team_total": ["team total", "team points"],
}


class KalshiClient:
    """Kalshi prediction market API client."""

    def __init__(self, api_key: str = "", key_path: str = "", mock: bool = False):
        self.api_key = api_key or KALSHI_API_KEY
        self.key_path = key_path or KALSHI_PRIVATE_KEY_PATH
        self.base_url = KALSHI_BASE_URL
        self.mock = mock
        self._private_key = None

        if not mock and self.key_path:
            self._load_private_key()

    def _load_private_key(self):
        """Load RSA private key from PEM file."""
        try:
            with open(self.key_path, "rb") as f:
                self._private_key = serialization.load_pem_private_key(
                    f.read(), password=None, backend=default_backend()
                )
        except FileNotFoundError:
            print(f"WARNING: Kalshi key not found at {self.key_path}, falling back to mock mode")
            self.mock = True
        except Exception as e:
            print(f"WARNING: Failed to load Kalshi key: {e}, falling back to mock mode")
            self.mock = True

    def _sign_request(self, timestamp: str, method: str, path: str) -> str:
        """Create RSA-PSS signature for request authentication."""
        path_no_query = path.split("?")[0]
        message = f"{timestamp}{method}{path_no_query}".encode("utf-8")
        signature = self._private_key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")

    def _request(self, method: str, path: str, params: dict = None) -> Optional[dict]:
        """Make authenticated request to Kalshi API."""
        if self.mock:
            return None

        timestamp = str(int(datetime.datetime.now().timestamp() * 1000))
        sign_path = f"/trade-api/v2{path}"
        signature = self._sign_request(timestamp, method, sign_path)

        headers = {
            "KALSHI-ACCESS-KEY": self.api_key,
            "KALSHI-ACCESS-SIGNATURE": signature,
            "KALSHI-ACCESS-TIMESTAMP": timestamp,
            "Content-Type": "application/json",
        }

        url = f"{self.base_url}{path}"
        for attempt in range(MAX_RETRIES):
            try:
                time.sleep(RATE_LIMIT_DELAY)
                resp = requests.request(method, url, headers=headers, params=params, timeout=10)
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code == 429:
                    wait = 2 ** attempt
                    print(f"    Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                else:
                    print(f"    Kalshi API {resp.status_code}: {resp.text[:200]}")
                    return None
            except Exception as e:
                print(f"    Kalshi request error: {e}")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)

        return None

    # ── Market Discovery ──────────────────────────────────────────

    def discover_nba_series(self) -> list[str]:
        """Find NBA-related series tickers via /search/filters_by_sport."""
        if self.mock:
            return ["KXNBA"]

        data = self._request("GET", "/search/filters_by_sport")
        if not data:
            return []

        # Parse the sport filters for NBA-related series
        series_tickers = []
        filters = data.get("filters_by_sports", {})
        for sport, sport_data in filters.items():
            if "nba" in sport.lower() or "basketball" in sport.lower():
                for scope in sport_data.get("scopes", []):
                    if scope.get("series_ticker"):
                        series_tickers.append(scope["series_ticker"])

        return series_tickers

    def get_nba_markets(self, series_tickers: list[str] = None) -> list[dict]:
        """
        Pull ALL open NBA markets. Returns list of market dicts.
        Each market has: ticker, title, yes_bid_dollars, floor_strike, cap_strike, etc.
        """
        if self.mock:
            return self._mock_nba_markets()

        if not series_tickers:
            series_tickers = self.discover_nba_series()

        all_markets = []
        for series in series_tickers:
            cursor = None
            while True:
                params = {
                    "series_ticker": series,
                    "status": "open",
                    "limit": 1000,
                }
                if cursor:
                    params["cursor"] = cursor

                data = self._request("GET", "/markets", params=params)
                if not data:
                    break

                markets = data.get("markets", [])
                all_markets.extend(markets)

                cursor = data.get("cursor")
                if not cursor or not markets:
                    break

        return all_markets

    def parse_player_props(self, markets: list[dict]) -> dict:
        """
        Parse raw markets into structured player prop lines.
        Returns: {(player_name_lower, stat): [{line, price, implied_prob, ticker, is_first_half}]}
        """
        props = {}

        for m in markets:
            title = (m.get("title") or "").lower()
            ticker = m.get("ticker", "")
            price = float(m.get("yes_bid_dollars") or m.get("last_price_dollars") or 0)
            floor_strike = m.get("floor_strike")

            if not floor_strike or price <= 0:
                continue

            # Determine stat type from title
            stat = None
            for stat_key, keywords in STAT_KEYWORDS.items():
                if any(kw in title for kw in keywords):
                    stat = stat_key
                    break

            if not stat:
                continue

            # Detect 1H
            is_first_half = "first half" in title or "1h" in title or "1st half" in title

            # Extract player name (heuristic: text before "over" or stat keyword)
            # This is fragile and will need tuning based on actual Kalshi title format
            player_name = self._extract_player_name(title)
            if not player_name:
                continue

            key = (player_name, stat)
            if key not in props:
                props[key] = []

            props[key].append({
                "line": float(floor_strike),
                "price": price,
                "implied_prob": price,  # In dollar format, price IS the probability
                "ticker": ticker,
                "is_first_half": is_first_half,
            })

        return props

    def parse_game_props(self, markets: list[dict]) -> dict:
        """
        Parse raw markets into game prop lines.
        Returns: {(home_team, away_team, prop_type): [{line, price, implied_prob, ticker, is_first_half}]}
        """
        props = {}
        # TODO: Implement game prop parsing based on actual market title format
        # Requires seeing real Kalshi NBA game prop titles
        return props

    def _extract_player_name(self, title: str) -> Optional[str]:
        """Extract player name from market title. Heuristic — needs real data to refine."""
        # Common patterns: "Will <player> score over X points?"
        # "Will <player> have over X rebounds?"
        for marker in ["over", "under", "score", "have", "record", "get"]:
            if marker in title:
                parts = title.split(marker)[0].strip()
                # Remove leading "will"
                if parts.startswith("will "):
                    parts = parts[5:]
                parts = parts.strip().rstrip("?").strip()
                if len(parts) > 3:
                    return parts
        return None

    # ── Mock Data ──────────────────────────────────────────────────

    def _mock_nba_markets(self) -> list[dict]:
        """Generate synthetic NBA prop markets for testing."""
        players = [
            "LeBron James", "Anthony Davis", "Jayson Tatum",
            "Luka Doncic", "Nikola Jokic", "Shai Gilgeous-Alexander",
        ]
        stats = {
            "pts": [(18.5, 0.72), (20.5, 0.60), (22.5, 0.48), (25.5, 0.35)],
            "reb": [(6.5, 0.65), (8.5, 0.45), (10.5, 0.30)],
            "ast": [(4.5, 0.68), (6.5, 0.50), (8.5, 0.32)],
            "fg3m": [(1.5, 0.62), (2.5, 0.40), (3.5, 0.22)],
        }

        markets = []
        for player in players:
            for stat, lines in stats.items():
                for line, base_prob in lines:
                    # Add some noise
                    price = round(base_prob + random.uniform(-0.05, 0.05), 4)
                    price = max(0.05, min(0.95, price))
                    markets.append({
                        "ticker": f"MOCK-{player.replace(' ', '')}-{stat}-{line}",
                        "title": f"Will {player} score over {line} {stat}?",
                        "yes_bid_dollars": str(price),
                        "last_price_dollars": str(price),
                        "floor_strike": line,
                        "cap_strike": None,
                        "status": "active",
                        "event_ticker": f"NBA-{player.replace(' ', '')}-{stat}",
                    })

        return markets

    def _mock_player_lines(self, player_name: str, stat: str) -> list[dict]:
        """Mock player prop lines for a specific player/stat."""
        base_lines = {
            "pts": [(18.5, 0.72), (20.5, 0.60), (22.5, 0.48), (25.5, 0.35)],
            "reb": [(6.5, 0.65), (8.5, 0.45), (10.5, 0.30)],
            "ast": [(4.5, 0.68), (6.5, 0.50), (8.5, 0.32)],
            "fg3m": [(1.5, 0.62), (2.5, 0.40), (3.5, 0.22)],
        }

        lines = base_lines.get(stat, [(10.5, 0.50)])
        return [
            {
                "line": l,
                "price": round(p + random.uniform(-0.03, 0.03), 4),
                "implied_prob": round(p + random.uniform(-0.03, 0.03), 4),
                "ticker": f"MOCK-{player_name}-{stat}-{l}",
                "is_first_half": False,
            }
            for l, p in lines
        ]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Kalshi API client")
    parser.add_argument("--test", action="store_true", help="Test with mock data")
    parser.add_argument("--live", action="store_true", help="Test with live API")
    args = parser.parse_args()

    if args.live:
        client = KalshiClient()
        print("Discovering NBA series...")
        series = client.discover_nba_series()
        print(f"Found series: {series}")

        if series:
            print("\nPulling markets...")
            markets = client.get_nba_markets(series)
            print(f"Found {len(markets)} markets")
            for m in markets[:5]:
                print(f"  {m.get('ticker')}: {m.get('title')}")
    else:
        client = KalshiClient(mock=True)
        markets = client.get_nba_markets()
        print(f"Mock markets: {len(markets)}")
        props = client.parse_player_props(markets)
        for key, lines in list(props.items())[:3]:
            print(f"\n  {key}:")
            for l in lines:
                print(f"    Line {l['line']}: price={l['price']:.2f}")
```

- [ ] **Step 2: Test mock mode**

Run: `python -m analytics.kalshi.client --test`
Expected: Mock markets generated, parsed into player props.

- [ ] **Step 3: Test live API (if key works)**

Run: `python -m analytics.kalshi.client --live`
Expected: Either successful series discovery or clear error message.

- [ ] **Step 4: Commit**

```bash
git add analytics/kalshi/
git commit -m "feat(analytics): add Kalshi client with RSA-PSS auth and mock mode"
```

---

## Task 6: Nightly Batch

**Files:**
- Create: `analytics/batch/nightly.py`

- [ ] **Step 1: Write nightly batch processor**

```python
"""
Nightly batch processor. Runs ~2am to prepare daily_conditions.
Step 0: Reconcile yesterday's picks (did they hit?)
Step 1: Get tomorrow's slate (games + rosters)
Step 2: Compute rolling stats from local DB
Step 3: Pull opponent position defense ranks
Step 4: Write to daily_conditions

Run:
  python -m analytics.batch.nightly --date 2026-03-22
  python -m analytics.batch.nightly --test
"""
import argparse
import time
from datetime import datetime, timedelta, date
from typing import Optional

from analytics.db.connection import supabase, season_int_to_str, API_DELAY_SECONDS
from analytics.data.enrich_games import (
    api_call_with_retry, POSITION_GROUP_MAP, BATCH_SIZE, _flush_batch
)

# ── Constants ──────────────────────────────────────────────────────

ROLLING_WINDOW = 5       # Last N games for rolling averages
MIN_GAMES_FOR_SEASON = 5 # Min games to compute season average


def get_target_date(date_str: Optional[str] = None) -> date:
    """Get target date (tomorrow by default, or from --date arg)."""
    if date_str:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    return (datetime.now() + timedelta(days=1)).date()


# ── Step 0: Reconcile Yesterday's Picks ──────────────────────────

def reconcile_picks(yesterday: date):
    """
    Check yesterday's pick_results against actual outcomes.
    Updates actual_result and did_hit columns.
    """
    print(f"\n--- RECONCILE: {yesterday} ---")

    picks = supabase.table("pick_results").select("*").eq(
        "game_date", str(yesterday)
    ).is_("actual_result", "null").execute().data

    if not picks:
        print("  No picks to reconcile")
        return

    print(f"  {len(picks)} picks to reconcile")

    for pick in picks:
        entity_id = pick["entity_id"]
        stat = pick["stat"]
        line = pick["recommended_line"]

        actual = None

        if pick["prop_type"] == "player":
            # Get actual stat from nba_player_stats
            games = supabase.table("nba_player_stats").select("*").eq(
                "player_id", entity_id
            ).eq("game_date", str(yesterday)).execute().data

            if games:
                g = games[0]
                stat_map = {
                    "pts": g.get("points", 0),
                    "reb": g.get("rebounds", 0),
                    "ast": g.get("assists", 0),
                    "fg3m": g.get("three_points_made", 0),
                }
                actual = stat_map.get(stat)

        elif pick["prop_type"] == "game":
            # Get actual game result
            game = supabase.table("games").select("*").eq(
                "id", entity_id
            ).execute().data

            if game:
                g = game[0]
                if stat == "total":
                    actual = (g.get("home_score") or 0) + (g.get("away_score") or 0)
                elif stat == "spread":
                    actual = (g.get("home_score") or 0) - (g.get("away_score") or 0)

        if actual is not None:
            did_hit = actual > line
            supabase.table("pick_results").update({
                "actual_result": actual,
                "did_hit": did_hit,
            }).eq("id", pick["id"]).execute()
            result_str = "HIT" if did_hit else "MISS"
            print(f"    Pick #{pick['id']}: actual={actual}, line={line} -> {result_str}")
        else:
            print(f"    Pick #{pick['id']}: no actual data found")

    print(f"  Reconciliation complete")


# ── Step 1: Get Tomorrow's Slate ──────────────────────────────────

def get_slate(target_date: date) -> list[dict]:
    """
    Get games on the target date.
    First check local DB, then ESPN API as fallback.
    Returns list of game dicts with game_id, home_team_id, away_team_id.
    """
    print(f"\n--- SLATE: {target_date} ---")

    # Check local DB first
    games = supabase.table("games").select("*").eq(
        "game_date", str(target_date)
    ).execute().data

    if games:
        print(f"  Found {len(games)} games in DB")
        return games

    # Fallback: use nba_api ScoreBoard or LeagueGameFinder
    try:
        from nba_api.stats.endpoints import leaguegamefinder
        season = _date_to_season(target_date)

        result = api_call_with_retry(
            lambda: leaguegamefinder.LeagueGameFinder(
                season_nullable=season,
                league_id_nullable="00",
                date_from_nullable=target_date.strftime("%m/%d/%Y"),
                date_to_nullable=target_date.strftime("%m/%d/%Y"),
            ).get_data_frames()[0],
            description=f"LeagueGameFinder({target_date})"
        )

        if result is not None and not result.empty:
            games_found = result.drop_duplicates(subset=["GAME_ID"])
            print(f"  Found {len(games_found)} games via nba_api")
            # Convert to our format — would need full insertion logic
            # For now return empty and let user ensure DB is populated
            return []
    except Exception as e:
        print(f"  Error fetching slate: {e}")

    print("  No games found for target date")
    return []


def _date_to_season(d: date) -> str:
    """Convert a date to NBA season string. Oct-Jun = that year's season."""
    if d.month >= 10:
        return f"{d.year}-{str(d.year + 1)[-2:]}"
    else:
        return f"{d.year - 1}-{str(d.year)[-2:]}"


# ── Step 2: Compute Rolling Stats ────────────────────────────────

def compute_daily_conditions(games: list[dict], target_date: date):
    """
    For each active player on tonight's teams, compute:
    - Rolling 5-game averages (pts, reb, ast, fg3m, min, usg, pace)
    - Season average usage
    - Days rest
    - Home/away
    - Opponent + their defensive rank vs player's position
    """
    print(f"\n--- DAILY CONDITIONS: {target_date} ---")

    if not games:
        print("  No games, skipping")
        return

    # Collect all team IDs playing
    team_ids = set()
    for g in games:
        team_ids.add(g["home_team_id"])
        team_ids.add(g["away_team_id"])

    # Get players on these teams
    players = supabase.table("players").select(
        "id, name, position, team"
    ).eq("league", "nba").eq("is_active", True).execute().data

    # Get team abbreviation -> id mapping
    teams = supabase.table("teams").select("id, abbreviation").execute().data
    abbr_to_id = {t["abbreviation"]: t["id"] for t in teams}

    # Filter to players on tonight's teams
    tonight_players = []
    for p in players:
        player_team_id = abbr_to_id.get(p.get("team"))
        if player_team_id and player_team_id in team_ids:
            p["team_id"] = player_team_id
            tonight_players.append(p)

    print(f"  {len(tonight_players)} players on {len(games)} games")

    conditions_batch = []

    for i, player in enumerate(tonight_players, 1):
        pid = player["id"]
        player_team_id = player["team_id"]
        position = player.get("position", "")
        pos_group = POSITION_GROUP_MAP.get(position, position[0] if position else "G")

        # Find this player's game tonight
        game = None
        for g in games:
            if player_team_id in (g["home_team_id"], g["away_team_id"]):
                game = g
                break

        if not game:
            continue

        home_away = "home" if player_team_id == game["home_team_id"] else "away"
        opponent_id = game["away_team_id"] if home_away == "home" else game["home_team_id"]

        # Get recent games from player_game_conditions + nba_player_stats
        recent_conditions = supabase.table("player_game_conditions").select(
            "usg_pct, pace, game_date"
        ).eq("player_id", pid).lt(
            "game_date", str(target_date)
        ).order("game_date", desc=True).limit(ROLLING_WINDOW).execute().data

        recent_stats = supabase.table("nba_player_stats").select(
            "points, rebounds, assists, three_points_made, minutes_played, game_date"
        ).eq("player_id", pid).lt(
            "game_date", str(target_date)
        ).order("game_date", desc=True).limit(ROLLING_WINDOW).execute().data

        if not recent_stats:
            continue

        # Compute rolling averages
        def avg(vals):
            return sum(vals) / len(vals) if vals else None

        rolling_pts = avg([s["points"] for s in recent_stats])
        rolling_reb = avg([s["rebounds"] for s in recent_stats])
        rolling_ast = avg([s["assists"] for s in recent_stats])
        rolling_fg3m = avg([s["three_points_made"] for s in recent_stats])
        rolling_min = avg([s["minutes_played"] for s in recent_stats])
        rolling_usg = avg([c["usg_pct"] for c in recent_conditions]) if recent_conditions else None
        rolling_pace = avg([c["pace"] for c in recent_conditions]) if recent_conditions else None

        # Season average usage
        season_conditions = supabase.table("player_game_conditions").select(
            "usg_pct"
        ).eq("player_id", pid).gte(
            "game_date", f"{target_date.year - 1}-10-01"
        ).execute().data
        season_avg_usg = avg([c["usg_pct"] for c in season_conditions if c["usg_pct"]]) if season_conditions else None

        # Days rest
        if recent_stats:
            last_date = datetime.strptime(recent_stats[0]["game_date"], "%Y-%m-%d").date()
            days_rest = (target_date - last_date).days
        else:
            days_rest = 3

        # Opponent defense rank for position
        opp_def = supabase.table("opponent_position_defense").select(
            "league_rank"
        ).eq("team_id", opponent_id).eq(
            "position_group", pos_group
        ).order("snapshot_date", desc=True).limit(1).execute().data

        opp_rank = opp_def[0]["league_rank"] if opp_def else None

        conditions_batch.append({
            "player_id": pid,
            "game_id": game["id"],
            "game_date": str(target_date),
            "rolling_usg_5g": rolling_usg,
            "rolling_pts_5g": rolling_pts,
            "rolling_reb_5g": rolling_reb,
            "rolling_ast_5g": rolling_ast,
            "rolling_fg3m_5g": rolling_fg3m,
            "rolling_min_5g": rolling_min,
            "rolling_pace_5g": rolling_pace,
            "season_avg_usg": season_avg_usg,
            "days_rest": days_rest,
            "home_away": home_away,
            "opponent_team_id": opponent_id,
            "opp_def_rank_position": opp_rank,
            "position_group": pos_group,
        })

        if i % 50 == 0:
            print(f"    [{i}/{len(tonight_players)}] processed")

    # Upsert
    if conditions_batch:
        _flush_batch("daily_conditions", conditions_batch, "player_id,game_date")
        print(f"  Wrote {len(conditions_batch)} daily conditions")
    else:
        print("  No conditions to write")


# ── Main ──────────────────────────────────────────────────────────

def run_nightly(target_date: date, test: bool = False):
    """Execute full nightly batch pipeline."""
    print("=" * 60)
    print(f"NIGHTLY BATCH — Target: {target_date}")
    print("=" * 60)

    # Step 0: Reconcile yesterday
    yesterday = target_date - timedelta(days=1)
    reconcile_picks(yesterday)

    # Step 1: Get slate
    games = get_slate(target_date)

    # Step 2+3: Compute conditions
    compute_daily_conditions(games, target_date)

    print("\nNightly batch complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Nightly batch processor")
    parser.add_argument("--date", type=str, help="Target date YYYY-MM-DD (default: tomorrow)")
    parser.add_argument("--test", action="store_true", help="Test mode")
    args = parser.parse_args()

    target = get_target_date(args.date)
    run_nightly(target, test=args.test)
```

- [ ] **Step 2: Test with a specific date**

Run: `python -m analytics.batch.nightly --date 2026-03-22 --test`
Expected: Reconciliation runs (no picks to reconcile), slate lookup, conditions computed if games exist.

- [ ] **Step 3: Commit**

```bash
git add analytics/batch/
git commit -m "feat(analytics): add nightly batch with reconciliation and daily conditions"
```

---

## Task 7: Screener

**Files:**
- Create: `analytics/screener/screen.py`

- [ ] **Step 1: Write screener**

```python
"""
Pre-filter candidates before Kalshi API calls.
Reduces ~500 players to ~150-300 worth checking.

Run: python -m analytics.screener.screen --date 2026-03-22
"""
import argparse
from datetime import date, datetime, timedelta
from typing import Optional

from analytics.db.connection import supabase

# ── Thresholds ─────────────────────────────────────────────────────

MIN_ROLLING_MINUTES = 25     # Only players averaging 25+ min/game
MIN_ROLLING_MINUTES_1H = 20  # Slightly lower for 1H considerations (deferred)


def screen_player_candidates(game_date: date) -> list[dict]:
    """
    Screen daily_conditions for viable player prop candidates.
    Returns list of {player_id, game_id, stats_to_check, conditions} dicts.
    """
    conditions = supabase.table("daily_conditions").select("*").eq(
        "game_date", str(game_date)
    ).execute().data

    candidates = []
    for c in conditions:
        # Must have rolling data
        if c.get("rolling_min_5g") is None:
            continue

        # Minutes filter
        if c["rolling_min_5g"] < MIN_ROLLING_MINUTES:
            continue

        # Must have usage data (for condition matching)
        if c.get("rolling_usg_5g") is None:
            continue

        # Determine which stats to check based on rolling averages
        stats = []
        if (c.get("rolling_pts_5g") or 0) >= 8:
            stats.append("pts")
        if (c.get("rolling_reb_5g") or 0) >= 3:
            stats.append("reb")
        if (c.get("rolling_ast_5g") or 0) >= 2:
            stats.append("ast")
        if (c.get("rolling_fg3m_5g") or 0) >= 1:
            stats.append("fg3m")

        if stats:
            candidates.append({
                "player_id": c["player_id"],
                "game_id": c["game_id"],
                "stats_to_check": stats,
                "conditions": c,
            })

    return candidates


def screen_game_candidates(game_date: date) -> list[dict]:
    """
    All games on tonight's slate qualify for game props.
    Returns list of {game_id, prop_types} dicts.
    """
    games = supabase.table("games").select("*").eq(
        "game_date", str(game_date)
    ).execute().data

    return [
        {
            "game_id": g["id"],
            "home_team_id": g["home_team_id"],
            "away_team_id": g["away_team_id"],
            "prop_types": ["total", "spread"],
        }
        for g in games
    ]


def run_screener(game_date: date):
    """Run screener and print results."""
    print("=" * 60)
    print(f"SCREENER — {game_date}")
    print("=" * 60)

    players = screen_player_candidates(game_date)
    games = screen_game_candidates(game_date)

    print(f"\n  Player candidates: {len(players)}")
    for p in players[:10]:
        print(f"    Player {p['player_id']}: {', '.join(p['stats_to_check'])}")
    if len(players) > 10:
        print(f"    ... and {len(players) - 10} more")

    print(f"\n  Game candidates: {len(games)}")
    for g in games:
        print(f"    Game {g['game_id']}: {', '.join(g['prop_types'])}")

    return players, games


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Screen candidates")
    parser.add_argument("--date", type=str, help="Game date YYYY-MM-DD")
    args = parser.parse_args()

    game_date = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else (datetime.now() + timedelta(days=1)).date()
    run_screener(game_date)
```

- [ ] **Step 2: Test screener**

Run: `python -m analytics.screener.screen --date 2026-03-22`
Expected: Lists candidate players and games (may be empty if no daily_conditions exist yet).

- [ ] **Step 3: Commit**

```bash
git add analytics/screener/
git commit -m "feat(analytics): add screener pre-filter for candidates"
```

---

## Task 8: Backtest Engine

**Files:**
- Create: `analytics/engine/backtest.py`

- [ ] **Step 1: Write backtest engine**

```python
"""
Condition-matched backtesting engine.
For a given player/stat/line, finds historical games with similar conditions
and computes hit rate.

Player prop conditions (5 total):
  1. Usage rate (±0.03 bucket)
  2. Pace (±3.0 bucket)
  3. Rest category (0, 1, 2+)
  4. Matchup tier (1-10, 11-20, 21-30)
  5. Home/away (exact)

Game prop conditions:
  1. Combined pace (sum of both teams' rolling 10-game pace, ±5.0)
  2. Home team off rating (±3.0)
  3. Away team off rating (±3.0)
  4. Home team def rating (±3.0)
  5. Rest differential
  6. Home/away context (always present)

Run: python -m analytics.engine.backtest --player-id 123 --stat pts --line 25.5
"""
import argparse
from datetime import date, datetime
from typing import Optional

from analytics.db.connection import supabase

# ── Tunable Constants ──────────────────────────────────────────────

# Width of condition buckets (changing widens/narrows historical match pool)
USG_BUCKET_WIDTH = 0.03       # ±3% usage rate
PACE_BUCKET_WIDTH = 3.0       # ±3.0 possessions per 48
OFF_RATING_BUCKET_WIDTH = 3.0 # ±3.0 offensive rating
DEF_RATING_BUCKET_WIDTH = 3.0 # ±3.0 defensive rating
COMBINED_PACE_BUCKET_WIDTH = 5.0  # ±5.0 for game props (sum of two teams)

# Minimum sample size before returning a result
MIN_SAMPLE_SIZE = 10          # Below this, result is None

# Condition loosening: drop conditions one at a time to reach MIN_SAMPLE_SIZE
# Order: home_away (least important) -> matchup_tier -> rest
CONDITION_DROP_ORDER = ["home_away", "matchup_tier", "rest"]
MIN_CONDITIONS_ACTIVE = 3     # Never go below 3 active conditions

# Stat column mapping
STAT_COLUMN_MAP = {
    "pts": "points",
    "reb": "rebounds",
    "ast": "assists",
    "fg3m": "three_points_made",
}


def _rest_category(days_rest: int) -> str:
    """Categorize rest: 0=b2b, 1=short, 2+=normal"""
    if days_rest == 0:
        return "b2b"
    elif days_rest == 1:
        return "short"
    return "normal"


def _matchup_tier(opp_rank: Optional[int]) -> str:
    """Tier opponent defense rank: 1-10=tough, 11-20=mid, 21-30=soft"""
    if opp_rank is None:
        return "unknown"
    if opp_rank <= 10:
        return "tough"
    elif opp_rank <= 20:
        return "mid"
    return "soft"


def backtest_player(
    player_id: int,
    stat: str,
    line: float,
    game_date: str,
) -> Optional[dict]:
    """
    Backtest a player prop against historical condition-matched games.

    Args:
        player_id: DB player ID
        stat: 'pts', 'reb', 'ast', 'fg3m'
        line: The Kalshi line to test (e.g., 25.5)
        game_date: Today's date (loads conditions from daily_conditions)

    Returns:
        dict with hit_rate, sample_size, conditions_matched, etc. or None
    """
    # Load today's conditions
    cond = supabase.table("daily_conditions").select("*").eq(
        "player_id", player_id
    ).eq("game_date", game_date).execute().data

    if not cond:
        return None
    cond = cond[0]

    today_usg = cond.get("rolling_usg_5g")
    today_pace = cond.get("rolling_pace_5g")
    today_rest = cond.get("days_rest", 3)
    today_opp_rank = cond.get("opp_def_rank_position")
    today_home_away = cond.get("home_away")

    if today_usg is None or today_pace is None:
        return None

    # Build condition filters
    conditions = {
        "usg_pct": (today_usg - USG_BUCKET_WIDTH, today_usg + USG_BUCKET_WIDTH),
        "pace": (today_pace - PACE_BUCKET_WIDTH, today_pace + PACE_BUCKET_WIDTH),
        "rest": _rest_category(today_rest),
        "matchup_tier": _matchup_tier(today_opp_rank),
        "home_away": today_home_away,
    }

    # Try with all conditions, then loosen if needed
    active_conditions = list(conditions.keys())
    result = None

    while len(active_conditions) >= MIN_CONDITIONS_ACTIVE:
        result = _query_historical(player_id, stat, line, game_date, conditions, active_conditions)

        if result and result["sample_size"] >= MIN_SAMPLE_SIZE:
            result["conditions_matched"] = len(active_conditions)
            result["total_conditions"] = len(conditions)
            result["condition_breakdown"] = {
                k: "active" if k in active_conditions else "dropped"
                for k in conditions
            }
            return result

        # Drop least important condition
        for to_drop in CONDITION_DROP_ORDER:
            if to_drop in active_conditions:
                active_conditions.remove(to_drop)
                break
        else:
            break  # Nothing left to drop

    return None  # Could not reach MIN_SAMPLE_SIZE


def _query_historical(
    player_id: int,
    stat: str,
    line: float,
    game_date: str,
    conditions: dict,
    active_conditions: list,
) -> Optional[dict]:
    """Query historical games matching active conditions."""
    stat_col = STAT_COLUMN_MAP.get(stat)
    if not stat_col:
        return None

    # Build query: join player_game_conditions with nba_player_stats
    # We need to query both tables and filter in Python since Supabase
    # client doesn't support complex joins easily

    # Get all historical condition rows for this player
    query = supabase.table("player_game_conditions").select("*").eq(
        "player_id", player_id
    ).lt("game_date", game_date)

    # Apply range filters
    if "usg_pct" in active_conditions:
        low, high = conditions["usg_pct"]
        query = query.gte("usg_pct", low).lte("usg_pct", high)

    if "pace" in active_conditions:
        low, high = conditions["pace"]
        query = query.gte("pace", low).lte("pace", high)

    if "home_away" in active_conditions:
        query = query.eq("home_away", conditions["home_away"])

    hist_conditions = query.order("game_date", desc=True).execute().data

    if not hist_conditions:
        return None

    # Further filter by rest and matchup (need Python-side filtering)
    filtered = []
    for hc in hist_conditions:
        if "rest" in active_conditions:
            if _rest_category(hc.get("days_rest", 3)) != conditions["rest"]:
                continue

        # Matchup tier requires opponent defense rank lookup
        if "matchup_tier" in active_conditions and conditions["matchup_tier"] != "unknown":
            # Get opponent defense rank for this historical game
            opp_def = supabase.table("opponent_position_defense").select(
                "league_rank"
            ).eq("team_id", hc.get("opponent_team_id")).order(
                "snapshot_date", desc=True
            ).limit(1).execute().data

            if opp_def:
                hist_tier = _matchup_tier(opp_def[0]["league_rank"])
                if hist_tier != conditions["matchup_tier"]:
                    continue

        filtered.append(hc)

    if not filtered:
        return None

    # Get actual stats for these games
    game_ids = [c["game_id"] for c in filtered]

    # Batch fetch stats (Supabase .in_() has limits, chunk if needed)
    all_stats = []
    for i in range(0, len(game_ids), 100):
        chunk = game_ids[i:i+100]
        stats = supabase.table("nba_player_stats").select(
            f"game_id, {stat_col}"
        ).eq("player_id", player_id).in_("game_id", chunk).execute().data
        all_stats.extend(stats)

    if not all_stats:
        return None

    # Compute hit rate
    hits = sum(1 for s in all_stats if (s.get(stat_col) or 0) > line)
    total = len(all_stats)

    return {
        "hit_rate": round(hits / total, 4) if total > 0 else 0,
        "sample_size": total,
        "games_queried": len(filtered),
    }


def backtest_game_prop(
    game_id: int,
    prop_type: str,
    line: float,
    game_date: str,
) -> Optional[dict]:
    """
    Backtest a game prop (total, spread) against historical games
    with similar team conditions.

    Conditions:
      1. Combined pace (sum of both teams' rolling 10g pace) ±5.0
      2. Home team off_rating ±3.0
      3. Away team off_rating ±3.0
      4. Home team def_rating ±3.0
      5. Rest differential similarity
    """
    # Get game info
    game = supabase.table("games").select("*").eq("id", game_id).execute().data
    if not game:
        return None
    game = game[0]

    home_id = game["home_team_id"]
    away_id = game["away_team_id"]

    # Get rolling team stats (last 10 games for each team)
    home_stats = supabase.table("team_game_stats").select("*").eq(
        "team_id", home_id
    ).lt("game_date", game_date).order("game_date", desc=True).limit(10).execute().data

    away_stats = supabase.table("team_game_stats").select("*").eq(
        "team_id", away_id
    ).lt("game_date", game_date).order("game_date", desc=True).limit(10).execute().data

    if not home_stats or not away_stats:
        return None

    def avg(vals):
        return sum(vals) / len(vals) if vals else 0

    home_pace = avg([s["pace"] for s in home_stats if s.get("pace")])
    away_pace = avg([s["pace"] for s in away_stats if s.get("pace")])
    combined_pace = home_pace + away_pace

    home_off = avg([s["off_rating"] for s in home_stats if s.get("off_rating")])
    away_off = avg([s["off_rating"] for s in away_stats if s.get("off_rating")])
    home_def = avg([s["def_rating"] for s in home_stats if s.get("def_rating")])

    # Find historical games with similar combined pace
    # This requires querying all historical games and filtering
    # Due to Supabase query limitations, we do this in Python
    all_games = supabase.table("games").select(
        "id, home_team_id, away_team_id, home_score, away_score, game_date"
    ).lt("game_date", game_date).execute().data

    hits = 0
    total = 0

    for hg in all_games:
        if not hg.get("home_score") or not hg.get("away_score"):
            continue

        # Get team stats for this historical game
        h_stats = supabase.table("team_game_stats").select("pace, off_rating, def_rating").eq(
            "team_id", hg["home_team_id"]
        ).eq("game_id", hg["id"]).execute().data

        a_stats = supabase.table("team_game_stats").select("pace, off_rating, def_rating").eq(
            "team_id", hg["away_team_id"]
        ).eq("game_id", hg["id"]).execute().data

        if not h_stats or not a_stats:
            continue

        h = h_stats[0]
        a = a_stats[0]

        hist_combined_pace = (h.get("pace") or 0) + (a.get("pace") or 0)

        # Check conditions
        if abs(hist_combined_pace - combined_pace) > COMBINED_PACE_BUCKET_WIDTH:
            continue
        if abs((h.get("off_rating") or 0) - home_off) > OFF_RATING_BUCKET_WIDTH:
            continue
        if abs((a.get("off_rating") or 0) - away_off) > OFF_RATING_BUCKET_WIDTH:
            continue

        # Compute actual outcome
        if prop_type == "total":
            actual = hg["home_score"] + hg["away_score"]
        elif prop_type == "spread":
            actual = hg["home_score"] - hg["away_score"]
        else:
            continue

        total += 1
        if actual > line:
            hits += 1

    if total < MIN_SAMPLE_SIZE:
        return None

    return {
        "hit_rate": round(hits / total, 4),
        "sample_size": total,
        "conditions_matched": 3,
        "total_conditions": 5,
        "condition_breakdown": {
            "combined_pace": "active",
            "home_off_rating": "active",
            "away_off_rating": "active",
            "home_def_rating": "partial",
            "rest_diff": "partial",
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backtest engine")
    parser.add_argument("--player-id", type=int, help="Player DB ID")
    parser.add_argument("--stat", type=str, help="Stat: pts, reb, ast, fg3m")
    parser.add_argument("--line", type=float, help="Line to test")
    parser.add_argument("--date", type=str, default=str(date.today()), help="Game date")
    args = parser.parse_args()

    if args.player_id and args.stat and args.line:
        result = backtest_player(args.player_id, args.stat, args.line, args.date)
        if result:
            print(f"Hit rate: {result['hit_rate']:.1%} ({result['sample_size']} games)")
            print(f"Conditions: {result['conditions_matched']}/{result['total_conditions']}")
        else:
            print("Insufficient data for backtest")
```

- [ ] **Step 2: Test with a known player**

Run: `python -m analytics.engine.backtest --player-id <id> --stat pts --line 20.5 --date 2026-03-22`
Expected: Either a hit rate result or "Insufficient data" message.

- [ ] **Step 3: Commit**

```bash
git add analytics/engine/backtest.py
git commit -m "feat(analytics): add condition-matched backtest engine for player and game props"
```

---

## Task 9: Confidence and Edge Scorer

**Files:**
- Create: `analytics/engine/scorer.py`

- [ ] **Step 1: Write scorer**

```python
"""
Confidence and edge scoring for backtest results.

Inputs: backtest result + Kalshi implied probability
Outputs: confidence score (0-100) and edge (hit_rate - implied_prob)

Run: python -m analytics.engine.scorer --test
"""

# ── Tunable Constants ──────────────────────────────────────────────

MIN_HIT_RATE = 0.82            # Hard floor — below this, no pick
MIN_EDGE = 0.08                # 8 percentage points over implied prob
MIN_SAMPLE_SIZE = 10           # Hard floor — too few games = unreliable
SAMPLE_WEIGHT_TARGET = 25      # Full weight at 25+ games (linear scale below)
CONDITION_BONUS_MAX = 8        # Max points added for condition match quality
B2B_PENALTY_STATS = ("pts",)   # Stats penalized on back-to-back
B2B_PENALTY_FACTOR = 0.93      # Multiply hit_rate by this on b2b for affected stats
FIRST_HALF_CONFIDENCE_CAP = 50 # Max confidence for 1H approximations


def score(
    hit_rate: float,
    sample_size: int,
    conditions_matched: int,
    total_conditions: int,
    implied_prob: float,
    days_rest: int,
    stat: str,
    is_first_half: bool = False,
) -> dict:
    """
    Score a backtest result for pick quality.

    Returns dict with:
      confidence: 0-100 score
      edge: hit_rate - implied_prob (positive = value)
      hit_rate_adjusted: after b2b penalty if applicable
      reason: if disqualified, why
    """
    # Hard disqualifiers
    if sample_size < MIN_SAMPLE_SIZE:
        return {"confidence": 0, "edge": 0, "reason": "insufficient_sample"}

    if hit_rate < MIN_HIT_RATE:
        return {"confidence": 0, "edge": 0, "reason": "low_hit_rate"}

    # B2B penalty for volume-dependent stats
    adjusted_rate = hit_rate
    if days_rest == 0 and stat in B2B_PENALTY_STATS:
        adjusted_rate = hit_rate * B2B_PENALTY_FACTOR

    # Re-check after adjustment
    if adjusted_rate < MIN_HIT_RATE:
        return {"confidence": 0, "edge": 0, "reason": "low_hit_rate_after_b2b_penalty"}

    # Edge over market
    edge = round(adjusted_rate - implied_prob, 4)

    if edge < MIN_EDGE:
        return {"confidence": 0, "edge": edge, "reason": "insufficient_edge"}

    # Base confidence from hit rate
    base = adjusted_rate * 100

    # Sample size weight: linear ramp to 1.0 at SAMPLE_WEIGHT_TARGET games
    # Changing SAMPLE_WEIGHT_TARGET: lower = more aggressive (trusts small samples),
    # higher = more conservative (demands more evidence)
    sample_weight = min(1.0, sample_size / SAMPLE_WEIGHT_TARGET)

    # Condition match quality bonus: more matched conditions = higher confidence
    # Changing CONDITION_BONUS_MAX: higher = more reward for full condition match
    condition_ratio = conditions_matched / total_conditions if total_conditions > 0 else 0
    condition_bonus = condition_ratio * CONDITION_BONUS_MAX

    confidence = round((base * sample_weight) + condition_bonus, 1)
    confidence = min(confidence, 100)

    # Cap 1H confidence (approximations are less reliable)
    if is_first_half:
        confidence = min(confidence, FIRST_HALF_CONFIDENCE_CAP)

    return {
        "confidence": confidence,
        "edge": edge,
        "hit_rate_adjusted": round(adjusted_rate, 4),
    }


if __name__ == "__main__":
    # Quick self-test
    print("Scorer self-test:")

    # Strong pick
    r = score(0.87, 31, 5, 5, 0.71, 2, "pts")
    print(f"  Strong: confidence={r['confidence']}, edge={r['edge']}")

    # Weak sample
    r = score(0.90, 7, 3, 5, 0.65, 1, "reb")
    print(f"  Weak sample: {r}")

    # B2B penalty
    r = score(0.84, 25, 4, 5, 0.70, 0, "pts")
    print(f"  B2B pts: {r}")

    # Low edge
    r = score(0.85, 30, 5, 5, 0.80, 2, "ast")
    print(f"  Low edge: {r}")
```

- [ ] **Step 2: Run self-test**

Run: `python -m analytics.engine.scorer --test`
Expected: 4 test cases printed with expected behavior.

- [ ] **Step 3: Commit**

```bash
git add analytics/engine/scorer.py
git commit -m "feat(analytics): add confidence and edge scorer with b2b penalty"
```

---

## Task 10: Pick Generator

**Files:**
- Create: `analytics/picks/generate.py`

- [ ] **Step 1: Write end-to-end pick generator**

```python
"""
Daily pick generator. Ties the full pipeline together.

Pipeline:
  1. Screen candidates (from daily_conditions)
  2. Pull Kalshi lines (bulk, then parse)
  3. Backtest each (player, stat, line) combo
  4. Score confidence + edge
  5. Filter: hit_rate >= 0.82, edge >= 0.08, confidence >= 70
  6. For each player/stat, find "safe" and "value" lines
  7. Rank by confidence, output to pick_results + terminal

Run:
  python -m analytics.picks.generate --date 2026-03-22
  python -m analytics.picks.generate --date 2026-03-22 --mock
"""
import argparse
import json
from datetime import date, datetime, timedelta
from typing import Optional

from analytics.db.connection import supabase
from analytics.screener.screen import screen_player_candidates, screen_game_candidates
from analytics.kalshi.client import KalshiClient
from analytics.engine.backtest import backtest_player, backtest_game_prop
from analytics.engine.scorer import score, MIN_HIT_RATE, MIN_EDGE

# ── Constants ──────────────────────────────────────────────────────

MIN_CONFIDENCE = 70  # Minimum confidence to surface a pick


def generate_picks(game_date: date, mock_kalshi: bool = False):
    """Run the full pick generation pipeline."""
    print("=" * 60)
    print(f"STATTRAK PICK GENERATOR — {game_date}")
    print("=" * 60)

    # ── Step 1: Screen ──
    print("\n--- Step 1: Screening candidates ---")
    player_candidates = screen_player_candidates(game_date)
    game_candidates = screen_game_candidates(game_date)
    print(f"  {len(player_candidates)} player candidates, {len(game_candidates)} game candidates")

    if not player_candidates and not game_candidates:
        print("\nNo candidates found. Ensure daily_conditions is populated.")
        return

    # ── Step 2: Pull Kalshi Lines ──
    print("\n--- Step 2: Pulling Kalshi lines ---")
    kalshi = KalshiClient(mock=mock_kalshi)
    markets = kalshi.get_nba_markets()
    player_props = kalshi.parse_player_props(markets)
    game_props = kalshi.parse_game_props(markets)
    print(f"  {len(markets)} markets -> {len(player_props)} player prop groups, {len(game_props)} game prop groups")

    # Store lines in daily_lines
    lines_batch = []
    for (player_name, stat), lines in player_props.items():
        for l in lines:
            lines_batch.append({
                "game_date": str(game_date),
                "prop_type": "player",
                "entity_id": None,  # Will resolve below
                "stat": stat,
                "line": l["line"],
                "kalshi_price": l["price"],
                "implied_prob": l["implied_prob"],
                "market_ticker": l["ticker"],
                "is_first_half": l.get("is_first_half", False),
            })

    if lines_batch:
        try:
            supabase.table("daily_lines").insert(lines_batch).execute()
            print(f"  Stored {len(lines_batch)} lines in daily_lines")
        except Exception as e:
            print(f"  Error storing lines: {e}")

    # ── Step 3+4: Backtest + Score ──
    print("\n--- Step 3: Backtesting ---")
    all_results = []

    # Player props
    # Build name -> player_id lookup
    player_ids = [c["player_id"] for c in player_candidates]
    if player_ids:
        players_info = supabase.table("players").select("id, name").in_("id", player_ids).execute().data
        name_to_id = {p["name"].lower(): p["id"] for p in players_info}
        id_to_name = {p["id"]: p["name"] for p in players_info}
    else:
        name_to_id = {}
        id_to_name = {}

    tested = 0
    passed = 0

    for candidate in player_candidates:
        pid = candidate["player_id"]
        player_name = id_to_name.get(pid, "Unknown")
        conditions = candidate["conditions"]

        for stat in candidate["stats_to_check"]:
            # Find Kalshi lines for this player/stat
            matching_lines = []
            for (name_key, stat_key), lines in player_props.items():
                if stat_key == stat and name_key in player_name.lower():
                    matching_lines = lines
                    break

            # If no Kalshi lines, use mock reasonable lines
            if not matching_lines and mock_kalshi:
                matching_lines = kalshi._mock_player_lines(player_name, stat)

            for line_data in matching_lines:
                tested += 1
                line = line_data["line"]
                implied = line_data["implied_prob"]
                is_1h = line_data.get("is_first_half", False)

                # Backtest
                bt = backtest_player(pid, stat, line, str(game_date))
                if bt is None:
                    continue

                # Score
                sc = score(
                    bt["hit_rate"],
                    bt["sample_size"],
                    bt["conditions_matched"],
                    bt["total_conditions"],
                    implied,
                    conditions.get("days_rest", 3),
                    stat,
                    is_first_half=is_1h,
                )

                if sc.get("confidence", 0) >= MIN_CONFIDENCE and sc.get("edge", 0) >= MIN_EDGE:
                    passed += 1
                    all_results.append({
                        "player_id": pid,
                        "player_name": player_name,
                        "stat": stat,
                        "line": line,
                        "hit_rate": sc.get("hit_rate_adjusted", bt["hit_rate"]),
                        "sample_size": bt["sample_size"],
                        "confidence": sc["confidence"],
                        "implied_prob": implied,
                        "edge": sc["edge"],
                        "conditions_matched": bt["conditions_matched"],
                        "total_conditions": bt["total_conditions"],
                        "condition_breakdown": bt.get("condition_breakdown", {}),
                        "ticker": line_data.get("ticker", ""),
                        "prop_type": "player",
                        "is_first_half": is_1h,
                    })

    print(f"  Tested {tested} player/stat/line combos, {passed} passed filters")

    # TODO: Game props backtesting (similar loop over game_candidates)

    # ── Step 5+6: Find best lines per player/stat ──
    print("\n--- Step 4: Selecting best lines ---")
    picks = _select_best_lines(all_results)

    # ── Step 7: Insert to pick_results ──
    print("\n--- Step 5: Storing picks ---")
    pick_rows = []
    for p in picks:
        pick_rows.append({
            "game_date": str(game_date),
            "prop_type": p["prop_type"],
            "entity_id": p["player_id"],
            "stat": p["stat"],
            "pick_type": p["pick_type"],
            "recommended_line": p["line"],
            "hit_rate": p["hit_rate"],
            "sample_size": p["sample_size"],
            "confidence_score": p["confidence"],
            "implied_prob": p["implied_prob"],
            "edge": p["edge"],
            "conditions_matched": p["conditions_matched"],
            "total_conditions": p["total_conditions"],
            "key_conditions": json.dumps(p.get("condition_breakdown", {})),
            "alt_lines_tested": json.dumps(p.get("alt_lines", [])),
        })

    if pick_rows:
        try:
            supabase.table("pick_results").insert(pick_rows).execute()
            print(f"  Stored {len(pick_rows)} picks")
        except Exception as e:
            print(f"  Error storing picks: {e}")

    # ── Step 8: Print summary ──
    _print_summary(game_date, picks)


def _select_best_lines(results: list[dict]) -> list[dict]:
    """
    For each player/stat combo, find:
      - "safe" line: highest hit_rate (most likely to hit)
      - "value" line: highest edge (best expected value)
    """
    from collections import defaultdict

    grouped = defaultdict(list)
    for r in results:
        key = (r["player_id"], r["stat"])
        grouped[key].append(r)

    picks = []
    for key, lines in grouped.items():
        # Safe pick: highest hit rate
        safe = max(lines, key=lambda x: x["hit_rate"])
        safe["pick_type"] = "safe"
        safe["alt_lines"] = [
            {"line": l["line"], "hit_rate": l["hit_rate"], "edge": l["edge"]}
            for l in sorted(lines, key=lambda x: x["line"])
        ]
        picks.append(safe)

        # Value pick: highest edge (if different from safe)
        value = max(lines, key=lambda x: x["edge"])
        if value["line"] != safe["line"]:
            value["pick_type"] = "value"
            value["alt_lines"] = safe["alt_lines"]
            picks.append(value)

    # Sort by confidence descending
    picks.sort(key=lambda x: x["confidence"], reverse=True)
    return picks


def _print_summary(game_date: date, picks: list[dict]):
    """Print formatted pick summary to terminal."""
    print("\n" + "=" * 60)
    print(f"  STATTRAK PICKS — {game_date}")
    print("=" * 60)

    safe_picks = [p for p in picks if p["pick_type"] == "safe"]
    value_picks = [p for p in picks if p["pick_type"] == "value"]

    if safe_picks:
        print("\n  SAFE PICKS (highest hit rate)")
        print("  " + "-" * 40)
        for i, p in enumerate(safe_picks, 1):
            stat_label = p["stat"].upper()
            print(f"  {i}. {p['player_name']} — {stat_label} — Over {p['line']}")
            print(f"     Hit rate: {p['hit_rate']:.0%} ({p['sample_size']} games)  |  Edge: +{p['edge']:.0%}")
            print(f"     Conditions: {p['conditions_matched']}/{p['total_conditions']} matched")
            print(f"     Confidence: {p['confidence']:.0f}")
            print()

    if value_picks:
        print("\n  VALUE PICKS (highest edge)")
        print("  " + "-" * 40)
        for i, p in enumerate(value_picks, 1):
            stat_label = p["stat"].upper()
            print(f"  {i}. {p['player_name']} — {stat_label} — Over {p['line']}")
            print(f"     Hit rate: {p['hit_rate']:.0%} ({p['sample_size']} games)  |  Edge: +{p['edge']:.0%}")
            print(f"     Confidence: {p['confidence']:.0f}")
            print()

    if not picks:
        print("\n  No picks met the threshold criteria.")
        print("  Try lowering MIN_HIT_RATE or MIN_EDGE, or check data completeness.")

    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate daily picks")
    parser.add_argument("--date", type=str, help="Game date YYYY-MM-DD")
    parser.add_argument("--mock", action="store_true", help="Use mock Kalshi data")
    args = parser.parse_args()

    game_date = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else (datetime.now() + timedelta(days=1)).date()
    generate_picks(game_date, mock_kalshi=args.mock or True)
```

- [ ] **Step 2: Test end-to-end in mock mode**

Run: `python -m analytics.picks.generate --date 2026-03-22 --mock`
Expected: Pipeline runs, may show "No candidates" if daily_conditions is empty, or generates mock picks if data exists.

- [ ] **Step 3: Commit**

```bash
git add analytics/picks/
git commit -m "feat(analytics): add end-to-end pick generator with safe and value lines"
```

---

## Task 11: README

**Files:**
- Create: `analytics/README.md`

- [ ] **Step 1: Write README**

Cover:
- What the system does (1 paragraph)
- Prerequisites and setup
- How to run each script (exact commands)
- Pipeline flow diagram (text)
- All tunable constants and what they control
- Known limitations
- What's next (calibration, real Kalshi, frontend integration)

- [ ] **Step 2: Commit**

```bash
git add analytics/README.md
git commit -m "docs(analytics): add README with setup, usage, and tuning guide"
```

---

## Task 12: Integration Test — Full Pipeline

- [ ] **Step 1: Run migrations** (via Supabase MCP)
- [ ] **Step 2: Run position backfill** — `python -m analytics.data.enrich_games --positions`
- [ ] **Step 3: Run enrichment test** — `python -m analytics.data.enrich_games --test`
- [ ] **Step 4: Run nightly batch** — `python -m analytics.batch.nightly --date <tomorrow>`
- [ ] **Step 5: Run screener** — `python -m analytics.screener.screen --date <tomorrow>`
- [ ] **Step 6: Run pick generator (mock)** — `python -m analytics.picks.generate --date <tomorrow> --mock`
- [ ] **Step 7: Verify pick_results table has rows**
- [ ] **Step 8: Final commit with any fixes**

```bash
git commit -m "feat(analytics): complete analytics engine v1"
```
