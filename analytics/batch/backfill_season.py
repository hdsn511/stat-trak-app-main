"""
analytics/batch/backfill_season.py

Backfills missing nba_player_stats box-score rows for any date range.
Walks every game date that has entries in the `games` table but is
missing rows in nba_player_stats, then fetches box scores via
BoxScoreTraditionalV2.

Usage:
    python -m analytics.batch.backfill_season                        # 2025-26 season
    python -m analytics.batch.backfill_season --since 2024-10-01    # 2024-25 season
    python -m analytics.batch.backfill_season --dry-run              # show gaps only
    python -m analytics.batch.backfill_season --since 2026-04-23    # specific range
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timedelta

from analytics.db.connection import API_DELAY_SECONDS, NBA_LEAGUE_ID, supabase
from analytics.batch.nightly import _fetch_and_insert_box_scores


def _current_season_start() -> str:
    today = date.today()
    year = today.year if today.month >= 10 else today.year - 1
    return f"{year}-10-01"


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _get_game_dates_in_range(since: date, until: date) -> list[str]:
    """All distinct game dates in [since, until] that exist in the games table.

    Paginates in 1000-row batches because Supabase enforces a server-side
    max-rows cap that ignores client-supplied limit values.
    """
    all_dates: set[str] = set()
    batch = 1000
    offset = 0
    while True:
        rows = (
            supabase.table("games")
            .select("game_date")
            .eq("league_id", NBA_LEAGUE_ID)
            .gte("game_date", since.isoformat())
            .lte("game_date", until.isoformat())
            .range(offset, offset + batch - 1)
            .execute()
        )
        chunk = rows.data or []
        all_dates.update(r["game_date"] for r in chunk)
        if len(chunk) < batch:
            break
        offset += batch
    return sorted(all_dates)


def _games_on_date(date_str: str) -> int:
    """Return the number of NBA games scheduled on this date."""
    result = (
        supabase.table("games")
        .select("id")
        .eq("game_date", date_str)
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    return len(result.data or [])


def _stats_games_on_date(date_str: str) -> int:
    """Return distinct game_ids with stats on this date."""
    result = (
        supabase.table("nba_player_stats")
        .select("game_id")
        .eq("game_date", date_str)
        .execute()
    )
    return len({r["game_id"] for r in (result.data or [])})


def find_missing_dates(since: date, until: date) -> list[date]:
    """
    Return dates where nba_player_stats is missing coverage for at least
    one scheduled game. A date is considered incomplete when the number of
    distinct game_ids with stats is less than the number of scheduled games.
    """
    game_dates = _get_game_dates_in_range(since, until)
    missing = []
    for date_str in game_dates:
        scheduled = _games_on_date(date_str)
        covered = _stats_games_on_date(date_str)
        if covered < scheduled:
            missing.append(_parse_date(date_str))
    return missing


def backfill(since: date, until: date, dry_run: bool = False) -> None:
    print(f"Scanning {since} → {until} for missing box scores ...")
    missing = find_missing_dates(since, until)

    if not missing:
        print("No gaps found — stats are current.")
        return

    print(f"\nFound {len(missing)} date(s) with missing stats:")
    for d in missing:
        print(f"  {d}")

    if dry_run:
        print("\n(dry-run: no fetches performed)")
        return

    print()
    for i, target in enumerate(missing, 1):
        print(f"[{i}/{len(missing)}] {target}")
        game_rows = (
            supabase.table("games")
            .select("ext_id")
            .eq("game_date", target.isoformat())
            .eq("league_id", NBA_LEAGUE_ID)
            .execute()
        )
        ext_ids = [r["ext_id"] for r in (game_rows.data or [])]
        if not ext_ids:
            print("  No game ext_ids in DB for this date. Skipping.")
            continue

        _fetch_and_insert_box_scores(target, game_ext_ids=ext_ids)
        time.sleep(API_DELAY_SECONDS)

    print(f"\nBackfill complete — {len(missing)} date(s) processed.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill missing NBA box scores from the games table",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m analytics.batch.backfill_season                       # current season
  python -m analytics.batch.backfill_season --since 2024-10-01   # 2024-25 season
  python -m analytics.batch.backfill_season --dry-run             # preview gaps
  python -m analytics.batch.backfill_season --since 2026-04-23   # recent gap only
        """,
    )
    parser.add_argument(
        "--since",
        default=_current_season_start(),
        help="Start date YYYY-MM-DD (default: current season start)",
    )
    parser.add_argument(
        "--until",
        default=date.today().isoformat(),
        help="End date YYYY-MM-DD inclusive (default: today)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print missing dates without fetching any data",
    )
    args = parser.parse_args()

    since = _parse_date(args.since)
    until = _parse_date(args.until)

    backfill(since, until, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
