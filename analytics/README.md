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

1. **Enrich** -- Backfill advanced/basic box scores and player positions from `nba_api` into Supabase.
2. **Nightly** -- Reconcile yesterday's picks, fetch today's slate, compute rolling conditions per player.
3. **Screen** -- Pre-filter player and game candidates by minutes, usage, and stat thresholds.
4. **Generate** -- Pull Kalshi markets, run condition-matched backtests, score confidence/edge, select and store picks.

---

## Modules

| Module | Path | Purpose |
|--------|------|---------|
| **connection** | `db/connection.py` | Shared Supabase client, env loading from `server/.env`, constants (seasons, position groups, API delays) |
| **migrate** | `db/migrate.py` | Reference migration for 7 tables (`player_game_conditions`, `team_game_stats`, `opponent_position_defense`, `player_availability`, `daily_conditions`, `daily_lines`, `pick_results`). Supports `--verify` and `--print-sql` |
| **enrich_games** | `data/enrich_games.py` | Backfills advanced stats (BoxScoreAdvancedV2), basic stats (BoxScoreTraditionalV2), and player positions (CommonTeamRoster) from `nba_api` |
| **nightly** | `batch/nightly.py` | Daily batch job: reconciles yesterday's picks, fetches today's slate, computes `daily_conditions` (rolling 5-game averages, rest days, opponent defense) |
| **screen** | `screener/screen.py` | Pre-filters player candidates (min minutes, usage, stat thresholds) and game candidates |
| **client** | `kalshi/client.py` | Kalshi API client with RSA-PSS authentication. Discovers NBA series, pulls markets, parses into player/game props. Auto-fallback to mock mode |
| **backtest** | `engine/backtest.py` | Condition-matched backtesting with 5 conditions (usage +/-0.03, pace +/-3.0, rest bucket, matchup tier, home/away). Loosening fallback requires min 3 active conditions |
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
pip install supabase nba_api cryptography requests python-dotenv

# Verify all 7 analytics tables exist in Supabase
python -m analytics.db.migrate --verify
```

---

## Commands

### One-Time Data Backfill

```bash
# Backfill player positions (approx 30 API calls)
python -m analytics.data.enrich_games --positions

# Enrich a full season of game data (advanced + basic stats)
python -m analytics.data.enrich_games --season 2024

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
| `API_DELAY_SECONDS` | `connection.py` | 1.0 | Delay between `nba_api` calls |
| `BACKOFF_BASE_SECONDS` | `connection.py` | 5 | Retry backoff base for failed requests |
| `BATCH_SIZE` | `connection.py` | 500 | Supabase upsert batch size |

---

## Known Limitations

- **NBA only.** NFL, MLB, and NHL are not yet supported.
- **Kalshi market parsing is title-based.** If Kalshi changes their naming conventions, the parser will break.
- **1H props use total/2 approximation.** There is no separate first-half backtesting dataset.
- **Position backfill is season-specific.** Must re-run `--positions` after mid-season trades.
- **Condition loosening trades precision for sample size.** When few games match all 5 conditions, the engine drops conditions to meet `MIN_SAMPLE_SIZE`, which may reduce signal quality.

---

## Roadmap

- **Calibration analysis** -- Track pick accuracy over time to tune hit rate and edge thresholds.
- **Live Kalshi integration** -- Move from mock to real-time market data for production use.
- **Frontend integration** -- Surface daily picks in the StatTrak React UI.
- **Automated scheduling** -- Cron job for nightly batch and pick generation.
- **Multi-sport expansion** -- Extend the pipeline to NFL, MLB, and NHL.
