"""
Shared Supabase client, configuration, and constants.
All analytics modules import from here. Single source of truth.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client, ClientOptions

# ── Environment ────────────────────────────────────────────────────
# Load server/.env relative to this file
_env_path = Path(__file__).resolve().parents[2] / "server" / ".env"
load_dotenv(_env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    print(f"ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in {_env_path}")
    sys.exit(1)

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    options=ClientOptions(postgrest_client_timeout=30),
)

# ── Kalshi Config ──────────────────────────────────────────────────
KALSHI_API_KEY = os.getenv("KALSHI_API_KEY", "")
KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"

# Resolve Kalshi key path relative to server/ directory
_kalshi_key_rel = os.getenv("KALSHI_PRIVATE_KEY_PATH", "")
if _kalshi_key_rel:
    KALSHI_PRIVATE_KEY_PATH = str(Path(__file__).resolve().parents[2] / "server" / _kalshi_key_rel)
else:
    KALSHI_PRIVATE_KEY_PATH = ""

# ── NBA Seasons ────────────────────────────────────────────────────
SEASONS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
SEASON_INTS = [2019, 2020, 2021, 2022, 2023, 2024, 2025]

def season_str_to_int(s: str) -> int:
    """Convert '2024-25' -> 2024"""
    return int(s.split("-")[0])

def season_int_to_str(y: int) -> str:
    """Convert 2024 -> '2024-25'"""
    return f"{y}-{str(y + 1)[-2:]}"

# ── Shared Pipeline Constants ──────────────────────────────────────
# These are used across multiple modules. Module-specific constants
# live at the top of their own files.

API_DELAY_SECONDS = 1.0          # Min seconds between nba_api calls
BACKOFF_BASE_SECONDS = 5         # Exponential backoff starting point
BACKOFF_MAX_SECONDS = 60         # Max backoff wait
MAX_RETRIES = 5                  # Max retry attempts per API call
BATCH_SIZE = 500                 # Default rows per Supabase upsert batch

# Position mapping: granular position -> group (G, F, C)
POSITION_GROUP_MAP = {
    "G": "G", "PG": "G", "SG": "G",
    "F": "F", "SF": "F", "PF": "F",
    "C": "C",
    "G-F": "G", "F-G": "F", "F-C": "F", "C-F": "C",
}

# NBA league_id in the local DB (integer FK, not string)
NBA_LEAGUE_ID = 1

# ── MLB ────────────────────────────────────────────────────────────
# MLB league_id in the local DB. The `leagues` table is empty and league_id
# is used as a magic integer (no enforced FK), mirroring NBA_LEAGUE_ID=1.
MLB_LEAGUE_ID = 2

# MLB seasons are single calendar years (season runs ~Apr–Oct within one year),
# so the season int for a date is simply its year.
MLB_SEASONS = [2021, 2022, 2023, 2024, 2025, 2026]

def mlb_season_for_date(date_str: str) -> int:
    """MLB season = calendar year of the date (YYYY-MM-DD)."""
    return int(date_str[:4])

# MLB stat key -> mlb_player_stats column name.
# Batter props + the marquee pitcher prop (strikeouts). Mirrors the NBA
# STAT_COLUMN_MAP pattern in analytics/engine/backtest.py.
MLB_STAT_COLUMN_MAP = {
    "hits": "hits",
    "tb":   "total_bases",
    "rbi":  "rbi",
    "runs": "runs",
    "hr":   "home_runs",
    "ks":   "strikeouts_pitched",   # pitcher strikeouts
}
