# StatTrak Analytics Engine

Python analytics system that identifies high-value NBA player and game prop bets. It combines historical condition-matched backtesting with live Kalshi prediction market pricing to surface **safe** (high hit rate) and **value** (high edge) picks.

---

## Table of Contents

- [Architecture](#architecture)
- [Modules](#modules)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Commands](#commands)
- [Key Tunable Constants](#key-tunable-constants)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## Architecture

The pipeline runs left to right. Each stage feeds the next.

```
enrich_games.py -> nightly.py -> screen.py -> generate.py
                                                |-- kalshi/client.py  (market data)
                                                |-- backtest.py       (condition matching)
                                                +-- scorer.py         (confidence + edge)
```

1. **Enrich** -- Backfill box scores and player positions into Supabase. NBA is ESPN-only: basic box scores, rosters/positions, slate/schedule and playoff scores come from ESPN's hidden API; `player_game_conditions` (minutes, rest, home/away, opponent) is derived from those box scores. No `nba_api` / stats.nba.com anywhere.
2. **Nightly** -- Reconcile yesterday's picks, fetch today's slate, compute rolling conditions per player.
3. **Screen** -- Pre-filter player and game candidates by minutes and rolling stat thresholds.
4. **Generate** -- Pull Kalshi markets, run condition-matched backtests, score confidence/edge, select and store picks.

---

## Modules

| Module | Path | Purpose |
|--------|------|---------|
| **connection** | `db/connection.py` | Shared Supabase client, env loading from `server/.env`, constants (seasons, position groups, API delays) |
| **migrate** | `db/migrate.py` | Reference migration for 7 tables (`player_game_conditions`, `team_game_stats`, `opponent_position_defense`, `player_availability`, `daily_conditions`, `daily_lines`, `pick_results`). Supports `--verify` and `--print-sql` |
| **enrich_games** | `data/enrich_games.py` | ESPN-backed positions + basic-stats gap fill, opponent-position-defense ranks, and DB-derived `player_game_conditions` (`--conditions`) |
| **nba_espn ingest** | `data/nba_espn/ingest.py` | ESPN NBA layer: scoreboard→games, summary→`nba_player_stats` basic rows, espn_id-only player resolution with loud self-heal, `--compare` parity mode |
| **map_espn_ids** | `batch/map_espn_ids.py` | Populates `espn_id` on NBA `teams`/`players` (abbreviation + normalized-name matching; ambiguous → reported and skipped, never guessed) |
| **nightly** | `batch/nightly.py` | Daily batch job: reconciles yesterday's picks, fetches today's slate (ESPN scoreboard), computes `daily_conditions` (rolling 5-game averages, rest days, opponent defense) |
| **screen** | `screener/screen.py` | Pre-filters player candidates (min minutes, stat thresholds) and game candidates |
| **client** | `kalshi/client.py` | Kalshi API client with RSA-PSS authentication. Discovers NBA series, pulls markets, parses into player/game props. Auto-fallback to mock mode |
| **backtest** | `engine/backtest.py` | Condition-matched backtesting on basic box-score data. Player props: minutes (+/-6), rest bucket, opponent position-defense rank, home/away (4 conditions; loosening drops home/away, matchup, rest in order). Game props: each team's rolling 10-game points for/against (+/-5) |
| **scorer** | `engine/scorer.py` | Confidence (0-100) and edge scoring. Gates: min 82% hit rate, min 8% edge, B2B penalty on points, 1H confidence cap at 50 |
| **generate** | `picks/generate.py` | End-to-end pipeline: screen, pull Kalshi markets, backtest, score, select safe/value picks, store to Supabase |

---

## Prerequisites

- Python 3.10+
- A running Supabase project with the base StatTrak tables already populated (see `server/scripts/`)
- `server/.env` with the following keys:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `KALSHI_API_KEY`
  - `KALSHI_PRIVATE_KEY_PATH`
- `server/kalshi_key.pem` for live Kalshi mode (mock mode works without it)

---

## Setup

```bash
# Create and activate virtual environment
python -m venv venv
source venv/Scripts/activate   # Windows
source venv/bin/activate       # Linux / macOS

# Install dependencies
pip install supabase cryptography requests python-dotenv

# Verify all 7 analytics tables exist in Supabase
python -m analytics.db.migrate --verify
```

---

## Commands

### One-Time Data Backfill

```bash
# Backfill player positions (approx 30 API calls)
python -m analytics.data.enrich_games --positions

# Derive player_game_conditions (minutes/rest/home-away) from box scores already in the DB
python -m analytics.data.enrich_games --conditions --since 2025-10-01

# Backfill only basic stats for a prior season
python -m analytics.data.enrich_games --basic-stats --season 2023
```

### Daily Pipeline

Run these in order for a given target date.

```bash
# 1. Compute daily conditions (rolling averages, rest, opponent defense)
python -m analytics.batch.nightly --date 2026-03-22

# 2. Preview screened candidates (optional, useful for debugging)
python -m analytics.screener.screen --date 2026-03-22

# 3. Full pick generation with live Kalshi data
python -m analytics.picks.generate --date 2026-03-22

# 3a. Full pick generation with mock Kalshi data (no API key needed)
python -m analytics.picks.generate --date 2026-03-22 --mock
```

### Testing and Debugging

```bash
# Run scorer self-test
python -m analytics.engine.scorer

# Backtest a single player/stat/line combination
python -m analytics.engine.backtest --player-id 123 --stat pts --line 25.5 --date 2026-03-22

# Test Kalshi client in mock mode
python -m analytics.kalshi.client --test
```

---

## ESPN Pipelines (NFL / NHL / NBA hybrid)

NFL and NHL ingestion runs on ESPN's hidden site API (`site.api.espn.com`) — free, keyless, and not IP-blocked, so it uses the same simple bounded-retry style as the MLB client. Validated endpoint inventory: `docs/superpowers/specs/2026-07-28-espn-api-research-findings.md`.

**NBA is ESPN-only (2026-10):** traditional box scores (`nba_player_stats`), rosters/positions, schedule/slate/scoreboard, injuries and playoff scores all come from ESPN. The former `nba_api` advanced-stats path (usage/pace/ratings via BoxScoreAdvancedV3, touches via PlayerTrackV3, inactives via BoxScoreSummaryV2, ScoreboardV3 ext_id healing) was removed; the `usg_pct`/`pace`/rating/touches columns stay in the schema as legacy and are no longer written or read. Identity: `teams.espn_id` / `players.espn_id` / `games.espn_id` sit alongside legacy nba-native `ext_id`s (`batch/map_espn_ids.py`). New games get a permanent ESPN-derived `ext_id` = game-type prefix (001/002/004/005) + ESPN event id so the generated `games.game_type` stays correct. Quirk: ESPN NBA summaries have ONE unnamed boxscore stat group per team (`name: None`) — parsing keys off the `keys` array.

```bash
# One-time: populate espn_id mappings (teams must be 30/30 or it aborts)
python -m analytics.batch.map_espn_ids

# Parity/diagnostics for any date
python -m analytics.data.nba_espn.ingest --compare --date 2026-02-11
python -m analytics.data.nba_espn.ingest --ingest --date 2026-02-11 --dry-run
```

| Module | Path | Purpose |
|--------|------|---------|
| **espn client** | `data/espn/client.py` | One multi-sport client (nfl / nhl / nba): scoreboard-by-date, game summary, teams, rosters, standings, injuries. `python -m analytics.data.espn.client` runs a smoke test |
| **nfl ingest** | `data/nfl/ingest.py` | Parses summary boxscore stat groups (passing/rushing/receiving/fumbles/defensive/kicking) into `nfl_player_stats` rows. Keys-array based, loud warnings, NULL for absent groups |
| **nhl ingest** | `data/nhl/ingest.py` | Skater + goalie parsing into `nhl_player_stats` (`position_type` discriminator, TOI `MM:SS` converted to seconds) |
| **espn_init** | `batch/espn_init.py` | Shared init/backfill engine: seed teams → rosters → per-date final games + box scores, with date-level `--resume` checkpointing and idempotent upserts |
| **nfl_init / nhl_init** | `batch/nfl_init.py`, `batch/nhl_init.py` | Thin league CLIs over the shared engine |

Shared `teams` / `players` / `games` rows use `league_id` 3 (NFL) / 4 (NHL) with ESPN-native ids in `ext_id` (mirroring MLB's `league_id` 2 convention). Per-player box scores land in `nfl_player_stats` / `nhl_player_stats` — PK `(game_id, player_id)`, and NULL means "stat group absent", never a silent zero. Only `STATUS_FINAL` games are ingested (preseason skipped); boxscore players missing from current rosters are self-healed into `players` with `is_active=false`.

```bash
# One-time seed (teams + current rosters)
python -m analytics.batch.nfl_init --teams --rosters
python -m analytics.batch.nhl_init --teams --rosters

# Full-season backfill — single resumable command, safe to re-run after interruption
python -m analytics.batch.nfl_init --teams --rosters --season 2025 --resume   # 2025-09-04 .. 2026-02-09 (incl. playoffs)
python -m analytics.batch.nhl_init --teams --rosters --season 2025 --resume   # 2025-10-07 .. 2026-06-20 (incl. playoffs)

# Arbitrary date slice
python -m analytics.batch.nfl_init --start-date 2025-12-25 --end-date 2025-12-29
```

### League home-page ETL

The ingest above lands raw games and box scores. These four jobs turn them into
the aggregates the NFL/NHL home pages render — standings, trending players and
streaks. All are idempotent and safe to re-run.

| Module | Path | Purpose |
|--------|------|---------|
| **seed_conferences** | `batch/seed_conferences.py` | `teams.conference` / `teams.division` from ESPN standings at `level=3` (the flat default has no divisions). Seed job — only re-run on realignment |
| **backfill_game_ot** | `batch/backfill_game_ot.py` | `games.ot` = `'OT'`/`'SO'`/NULL, read from `status.type.detail` on the scoreboard. NHL standings are points-based and an overtime loss scores a point, which the final score alone cannot tell you |
| **compute_standings** | `batch/compute_standings.py` | Derives `team_standings` from `games`. Computed, not fetched: ESPN's standings resource is current-state only and cannot produce a historical or final table |
| **compute_trends** | `batch/compute_trends.py` | Rolling-window z-scores into `nfl_trends` / `nhl_trends`. Faithful port of `server/src/jobs/computeNBATrends.ts` so all four leagues rank on the same number |
| **backfill_positions** | `batch/backfill_positions.py` | Fills `players.position` for players with box-score rows but no position. `refresh_positions.py` reads current rosters and structurally cannot see a retired or released player |

```bash
# Order matters once: conferences and OT are inputs to standings.
python -m analytics.batch.seed_conferences
python -m analytics.batch.backfill_game_ot
python -m analytics.batch.compute_standings --season 2025
python -m analytics.batch.compute_trends --season 2025
python -m analytics.batch.backfill_positions

# Every job takes --league and --dry-run.
python -m analytics.batch.compute_standings --league nhl --dry-run
```

In season, `backfill_game_ot` → `compute_standings` → `compute_trends` is the
nightly sequence, after the day's `*_init` ingest. `seed_conferences` and
`backfill_positions` are event-driven: realignment and post-cutdown roster
churn respectively.

Stat ids in `*_trends.stat` are a **wire contract**, not a local choice — they
are defined by `statConfig` in `server/src/config/leagues.ts` and read by the
league-agnostic controllers:

| League | Stat ids |
|--------|----------|
| NFL | `payds`=0 `patd`=1 `ruyds`=2 `rutd`=3 `recyds`=4 `rec`=5 `rectd`=6 `tkl`=7 |
| NHL | `g`=0 `a`=1 `p`=2 `sog`=3 `blk`=4 `hits`=5 |

**Paginating Supabase reads:** always `.order()` on a *total* order before
`.range()`. Paging over a partial order (or none) silently drops and repeats
rows across page boundaries — this cost a full re-run of the position backfill,
which quietly skipped 60 of 235 players. `game_date` alone is not a total
order; a single slate is hundreds of rows.

---

## Key Tunable Constants

| Constant | File | Default | Description |
|----------|------|---------|-------------|
| `MIN_HIT_RATE` | `scorer.py` | 0.82 | Minimum historical hit rate to recommend a pick |
| `MIN_EDGE` | `scorer.py` | 0.08 | Minimum edge (hit_rate - implied_prob) |
| `MIN_CONFIDENCE` | `generate.py` | 70 | Minimum confidence score (0-100) |
| `USG_BUCKET_WIDTH` | `backtest.py` | 0.03 | Usage rate matching tolerance |
| `PACE_BUCKET_WIDTH` | `backtest.py` | 3.0 | Pace matching tolerance |
| `MIN_SAMPLE_SIZE` | `backtest.py` | 10 | Minimum games for a valid backtest |
| `MIN_CONDITIONS_ACTIVE` | `backtest.py` | 3 | Minimum conditions before giving up |
| `B2B_PTS_PENALTY` | `scorer.py` | 0.93 | Multiplier on points hit rate for back-to-backs |
| `FIRST_HALF_CONFIDENCE_CAP` | `scorer.py` | 50 | Maximum confidence for 1H props |
| `MIN_ROLLING_MINUTES` | `screen.py` | 25 | Rolling minutes filter for candidate screening |
| `API_DELAY_SECONDS` | `connection.py` | 1.0 | Legacy external-API delay (unused by the ESPN path) |
| `BACKOFF_BASE_SECONDS` | `connection.py` | 5 | Retry backoff base for failed requests |
| `BATCH_SIZE` | `connection.py` | 500 | Supabase upsert batch size |

---

## Known Limitations

- **Pick engine is NBA/MLB only.** NFL and NHL have ESPN-backed data ingestion (see above) but no screener/picks engine yet.
- **Kalshi market parsing is title-based.** If Kalshi changes their naming conventions, the parser will break.
- **1H props use total/2 approximation.** There is no separate first-half backtesting dataset.
- **Position backfill reflects ESPN's current rosters** (not season-pinned). Re-run `--positions` after trades; during the offseason it will apply offseason moves to `players.team`. Players who have since left the league are invisible to the roster path entirely — `batch/backfill_positions.py` covers them via the per-athlete endpoint.
- **NFL/NHL standings need a hand-maintained season boundary.** `games.game_type` is `'other'` for every ESPN-ingested row, so `compute_standings.py` reads the regular-season cutoff from its `regular_season_end` map. A missing season aborts the job rather than folding playoff games into the table; the result is validated against the league's games-per-team before anything is written.
- **NBA players table only covers rows seeded earlier.** Boxscore athletes with no `players` row (e.g. new draft classes) are warned and skipped, never fabricated — extend `players` before expecting their stats.
- **Condition loosening trades precision for sample size.** When few games match all 5 conditions, the engine drops conditions to meet `MIN_SAMPLE_SIZE`, which may reduce signal quality.

## Scheduling (GitHub Actions)

Production scheduling is GitHub Actions; the in-process `node-cron` scheduler is
local/PM2 only (see `docs/RUNBOOK.md` 3.3).

| Workflow | Cron (UTC) | What |
|----------|-----------|------|
| `daily-data-sync.yml` | `0 11 * * *` | Job `data`: NFL+NHL ESPN ingest (last 3 days, `--rosters`), MLB rosters + `mlb_nightly --today` (reconcile) + enrich + trends, NBA `nightly` (reconcile, backfill, conditions) + 7-day slate sync + trends, then `freshness_check`. Job `picks` (needs `data`, `continue-on-error`): MLB + NBA pick generation. Manual: `league` = all/nba/mlb/nfl/nhl, `force`, NFL/NHL date overrides. |
| `mlb-selfheal-picks.yml` | hourly `13-23`, `0-4` | MLB picks only (additive-lock) as Kalshi opens per-game markets. Feeds the performance report. |
| `injury-check.yml` | hourly `14-23`, `0-3` | NBA + MLB injury invalidation; exits early if no games today or all final. |
| `mlb-performance-report.yml` | `30 17 * * *` | Forward performance + calibration report. |

The old per-league workflows (`nightly-pipeline`, `mlb-nightly-pipeline`,
`espn-nightly-ingest`, `reconcile-picks`, `mlb-reconcile-picks`) are
`workflow_dispatch`-only; reconcile runs inside the NBA/MLB nightly batches.

Read-only freshness check (also runs at the end of the daily sync):
`python -m analytics.batch.freshness_check [--league nba] [--max-stale-days 2]`.

---

## Roadmap

- **Calibration analysis** -- Track pick accuracy over time to tune hit rate and edge thresholds.
- **Live Kalshi integration** -- Move from mock to real-time market data for production use.
- **Frontend integration** -- Surface daily picks in the StatTrak React UI.
- **Multi-sport expansion** -- Extend the pipeline to NFL, MLB, and NHL.
