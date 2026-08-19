"""
analytics/batch/nhl_init.py

NHL init/backfill via ESPN — seeds teams + rosters into the shared tables
(league_id = NHL_LEAGUE_ID) and ingests final games + per-player box scores
(skaters + goalies) into `nhl_player_stats`. Thin CLI over
analytics/batch/espn_init.py.

CLI:
    python -m analytics.batch.nhl_init --teams --rosters
    python -m analytics.batch.nhl_init --start-date 2026-01-15 --end-date 2026-01-17
    python -m analytics.batch.nhl_init --teams --rosters --season 2025 --resume
"""

from __future__ import annotations

import sys

from analytics.batch.espn_init import LeagueSpec, build_arg_parser, run_cli
from analytics.data.nhl.ingest import parse_summary_boxscore
from analytics.db.connection import NHL_LEAGUE_ID

DEFAULT_SEASON = 2025

# Season start year -> (first game date, last game date incl. playoffs).
# 2025 = the 2025-26 season: opening night 2025-10-07 through the latest
# possible Stanley Cup Final date (buffer to 2026-06-20).
SEASON_RANGES = {
    2025: ("2025-10-07", "2026-06-20"),
}

SPEC = LeagueSpec(
    code="nhl",
    sport="hockey",
    league="nhl",
    league_id=NHL_LEAGUE_ID,
    stats_table="nhl_player_stats",
    parse_summary=parse_summary_boxscore,
    season_ranges=SEASON_RANGES,
    # ESPN labels NHL seasons by END year (2025-26 -> 2026); our convention is
    # the start year (2025), mirroring the NBA season ints.
    season_from_espn_year=lambda y: y - 1,
)


def main() -> int:
    parser = build_arg_parser("Seed + backfill NHL data from ESPN", DEFAULT_SEASON)
    return run_cli(SPEC, parser.parse_args(), DEFAULT_SEASON)


if __name__ == "__main__":
    sys.exit(main())
