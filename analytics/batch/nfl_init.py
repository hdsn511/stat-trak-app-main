"""
analytics/batch/nfl_init.py

NFL init/backfill via ESPN — seeds teams + rosters into the shared tables
(league_id = NFL_LEAGUE_ID) and ingests final games + per-player box scores
into `nfl_player_stats`. Thin CLI over analytics/batch/espn_init.py.

CLI:
    python -m analytics.batch.nfl_init --teams --rosters
    python -m analytics.batch.nfl_init --start-date 2025-12-25 --end-date 2025-12-29
    python -m analytics.batch.nfl_init --teams --rosters --season 2025 --resume
"""

from __future__ import annotations

import sys

from analytics.batch.espn_init import LeagueSpec, build_arg_parser, run_cli
from analytics.data.nfl.ingest import parse_summary_boxscore
from analytics.db.connection import NFL_LEAGUE_ID

DEFAULT_SEASON = 2025

# Season start year -> (first game date, last game date incl. playoffs).
# 2025: kickoff 2025-09-04 through Super Bowl LX on 2026-02-08 (buffer to 02-09).
SEASON_RANGES = {
    2025: ("2025-09-04", "2026-02-09"),
}

SPEC = LeagueSpec(
    code="nfl",
    sport="football",
    league="nfl",
    league_id=NFL_LEAGUE_ID,
    stats_table="nfl_player_stats",
    parse_summary=parse_summary_boxscore,
    season_ranges=SEASON_RANGES,
    # ESPN already uses the start-year convention for NFL (Jan/Feb playoff
    # games carry season.year of the previous fall).
    season_from_espn_year=lambda y: y,
)


def main() -> int:
    parser = build_arg_parser("Seed + backfill NFL data from ESPN", DEFAULT_SEASON)
    return run_cli(SPEC, parser.parse_args(), DEFAULT_SEASON)


if __name__ == "__main__":
    sys.exit(main())
