"""
analytics/batch/freshness_check.py

READ-ONLY data freshness check, run as the last step of the daily data sync.

Per league (NBA, MLB, NFL, NHL) it reports:
  * latest game_date that has player box-score rows,
  * whether the league is IN-SEASON (any game row dated within +/-3 days of
    today -- so the NBA offseason does not fail the check),
  * final games from the last 7 days that have no stat rows.

Exit code 1 if an in-season league's latest box-score date is more than
--max-stale-days (default 2) days old, or if it has no box scores at all.
Missing-stat finals are reported but only warn (a single late-final game is
normal and self-heals on the next ingest window).

Never writes to the database.

CLI:
    python -m analytics.batch.freshness_check
    python -m analytics.batch.freshness_check --league mlb --max-stale-days 1
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from typing import Optional

from analytics.db.connection import supabase

# slug -> (league_id, stats table). Mirrors server/src/config/leagues.ts.
LEAGUES: dict[str, tuple[int, str]] = {
    "nba": (1, "nba_player_stats"),
    "mlb": (2, "mlb_player_stats"),
    "nfl": (3, "nfl_player_stats"),
    "nhl": (4, "nhl_player_stats"),
}

SEASON_WINDOW_DAYS = 3
MISSING_WINDOW_DAYS = 7
PAGE = 1000


def _latest_stat_date(table: str, today: date) -> Optional[date]:
    """Latest game_date with box-score rows (ignoring bogus future dates)."""
    res = (
        supabase.table(table)
        .select("game_date")
        .lte("game_date", today.isoformat())
        .order("game_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return date.fromisoformat(rows[0]["game_date"]) if rows else None


def _in_season(league_id: int, today: date) -> tuple[bool, int]:
    lo = (today - timedelta(days=SEASON_WINDOW_DAYS)).isoformat()
    hi = (today + timedelta(days=SEASON_WINDOW_DAYS)).isoformat()
    res = (
        supabase.table("games")
        .select("id", count="exact")
        .eq("league_id", league_id)
        .gte("game_date", lo)
        .lte("game_date", hi)
        .limit(1)
        .execute()
    )
    n = res.count or 0
    return n > 0, n


def _stat_game_ids(table: str, lo: date, hi: date) -> set[int]:
    ids: set[int] = set()
    offset = 0
    while True:
        res = (
            supabase.table(table)
            .select("game_id")
            .gte("game_date", lo.isoformat())
            .lte("game_date", hi.isoformat())
            .order("game_id")
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        rows = res.data or []
        ids.update(r["game_id"] for r in rows)
        if len(rows) < PAGE:
            return ids
        offset += PAGE


def _final_games_missing_stats(league_id: int, table: str, today: date) -> list[dict]:
    """Final games (status=2, or both scores present on a past date -- the NBA
    status code lags the data) in the last 7 days with no stat rows."""
    lo = today - timedelta(days=MISSING_WINDOW_DAYS)
    hi = today
    games = (
        supabase.table("games")
        .select("id,game_date,status,home_score,away_score")
        .eq("league_id", league_id)
        .gte("game_date", lo.isoformat())
        .lte("game_date", hi.isoformat())
        .execute()
    ).data or []
    finals = [
        g for g in games
        if g.get("status") == 2
        or (g.get("home_score") is not None and g.get("away_score") is not None
            and g["game_date"] < today.isoformat())
    ]
    if not finals:
        return []
    have = _stat_game_ids(table, lo, hi)
    return sorted(
        (g for g in finals if g["id"] not in have),
        key=lambda g: (g["game_date"], g["id"]),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="StatTrak read-only data freshness check")
    parser.add_argument("--league", choices=sorted(LEAGUES), default=None,
                        help="Check a single league (default: all)")
    parser.add_argument("--max-stale-days", type=int, default=2, dest="max_stale",
                        help="In-season league fails if latest box score is older (default: 2)")
    parser.add_argument("--today", type=str, default=None, help="Override today (YYYY-MM-DD)")
    args = parser.parse_args()

    today = date.fromisoformat(args.today) if args.today else date.today()
    slugs = [args.league] if args.league else list(LEAGUES)

    print(f"Data freshness check  |  today {today.isoformat()}  |  "
          f"stale if in-season and latest box score > {args.max_stale}d old")
    print(f"{'league':<7}{'in-season':<11}{'games +/-3d':<13}{'latest box':<12}{'age(d)':<8}"
          f"{'final w/o stats (7d)':<22}status")

    failed = False
    detail: list[str] = []
    for slug in slugs:
        league_id, table = LEAGUES[slug]
        in_season, n_near = _in_season(league_id, today)
        latest = _latest_stat_date(table, today)
        missing = _final_games_missing_stats(league_id, table, today)
        age = (today - latest).days if latest else None

        if not in_season:
            status = "OK (off-season)"
        elif latest is None:
            status, failed = "STALE (no box scores)", True
        elif age is not None and age > args.max_stale:
            status, failed = f"STALE ({age}d)", True
        else:
            status = "OK"

        print(f"{slug:<7}{('yes' if in_season else 'no'):<11}{n_near:<13}"
              f"{(latest.isoformat() if latest else '-'):<12}"
              f"{(str(age) if age is not None else '-'):<8}{len(missing):<22}{status}")
        for g in missing:
            detail.append(f"  {slug}: game id={g['id']} {g['game_date']} "
                          f"({g.get('away_score')}-{g.get('home_score')}) final but no stat rows")

    if detail:
        print("\nFinal games from the last 7 days with no stat rows:")
        print("\n".join(detail))

    if failed:
        print("\nFRESHNESS CHECK FAILED: an in-season league is stale.")
        return 1
    print("\nFreshness check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
