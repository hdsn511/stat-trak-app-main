"""
analytics/screener/screen.py

Pre-filter for player and game candidates before Kalshi market calls.
Reads from daily_conditions and games tables; applies minimum thresholds
to identify which players are worth checking for each prop type.

CLI:
    python -m analytics.screener.screen --date 2026-03-22
    python -m analytics.screener.screen          (default: tomorrow)
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta
from typing import Optional

from analytics.db.connection import NBA_LEAGUE_ID, supabase


# ── Screening thresholds ──────────────────────────────────────────────────────

MIN_ROLLING_MINUTES = 25   # Only players averaging 25+ min/game in last 5
MIN_ROLLING_PTS = 8        # Min rolling pts avg to check pts props
MIN_ROLLING_REB = 3        # Min rolling reb avg to check reb props
MIN_ROLLING_AST = 2        # Min rolling ast avg to check ast props
MIN_ROLLING_FG3M = 1       # Min rolling 3pm avg to check fg3m props


# ── Player screener ───────────────────────────────────────────────────────────

def screen_player_candidates(game_date: date) -> list[dict]:
    """
    Query daily_conditions for game_date, apply minute and usage filters,
    and determine which prop types to check for each passing player.

    Returns:
        List of dicts:
        {
            player_id: int,
            game_id: int,
            stats_to_check: ["pts", "reb", ...],
            conditions: { ...all daily_conditions fields... }
        }
    """
    date_str = game_date.strftime("%Y-%m-%d")

    result = (
        supabase.table("daily_conditions")
        .select("*")
        .eq("game_date", date_str)
        .execute()
    )
    rows = result.data or []

    candidates: list[dict] = []

    for row in rows:
        rolling_min = row.get("rolling_min_5g")
        rolling_usg = row.get("rolling_usg_5g")

        # Hard gate: must have sufficient minutes and usage data
        if rolling_min is None or rolling_min < MIN_ROLLING_MINUTES:
            continue
        if rolling_usg is None:
            continue

        stats_to_check: list[str] = []

        pts = row.get("rolling_pts_5g")
        if pts is not None and pts >= MIN_ROLLING_PTS:
            stats_to_check.append("pts")

        reb = row.get("rolling_reb_5g")
        if reb is not None and reb >= MIN_ROLLING_REB:
            stats_to_check.append("reb")

        ast = row.get("rolling_ast_5g")
        if ast is not None and ast >= MIN_ROLLING_AST:
            stats_to_check.append("ast")

        fg3m = row.get("rolling_fg3m_5g")
        if fg3m is not None and fg3m >= MIN_ROLLING_FG3M:
            stats_to_check.append("fg3m")

        if not stats_to_check:
            continue

        candidates.append({
            "player_id": row["player_id"],
            "game_id": row.get("game_id"),
            "stats_to_check": stats_to_check,
            "conditions": row,
        })

    return candidates


# ── Game screener ─────────────────────────────────────────────────────────────

def screen_game_candidates(game_date: date) -> list[dict]:
    """
    Return all NBA games scheduled for game_date. All games qualify for
    total and spread props.

    Returns:
        List of dicts:
        {
            game_id: int,
            home_team_id: int,
            away_team_id: int,
            prop_types: ["total", "spread"]
        }
    """
    date_str = game_date.strftime("%Y-%m-%d")

    result = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id")
        .eq("game_date", date_str)
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    rows = result.data or []

    return [
        {
            "game_id": row["id"],
            "home_team_id": row["home_team_id"],
            "away_team_id": row["away_team_id"],
            "prop_types": ["total", "spread"],
        }
        for row in rows
    ]


# ── Runner ────────────────────────────────────────────────────────────────────

def run_screener(game_date: date) -> None:
    """Run both screeners and print results."""
    date_str = game_date.strftime("%Y-%m-%d")

    print("=" * 60)
    print(f"StatTrak Screener  |  date: {date_str}")
    print("=" * 60)

    player_candidates = screen_player_candidates(game_date)
    game_candidates = screen_game_candidates(game_date)

    print(f"\nGame candidates: {len(game_candidates)}")
    for g in game_candidates:
        print(
            f"  game_id={g['game_id']}  "
            f"home={g['home_team_id']} vs away={g['away_team_id']}  "
            f"props={g['prop_types']}"
        )

    print(f"\nPlayer candidates: {len(player_candidates)}")
    for p in player_candidates:
        cond = p["conditions"]
        print(
            f"  player_id={p['player_id']}  "
            f"game_id={p['game_id']}  "
            f"stats={p['stats_to_check']}  "
            f"min={cond.get('rolling_min_5g')}  "
            f"usg={cond.get('rolling_usg_5g')}"
        )

    print("=" * 60)
    print(
        f"Summary: {len(game_candidates)} game(s), "
        f"{len(player_candidates)} player prop candidate(s)."
    )


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="StatTrak candidate screener",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m analytics.screener.screen --date 2026-03-22
  python -m analytics.screener.screen          (default: tomorrow)
        """,
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date in YYYY-MM-DD format (default: tomorrow)",
    )

    args = parser.parse_args()

    if args.date:
        try:
            game_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(f"ERROR: invalid date format '{args.date}'. Use YYYY-MM-DD.")
            return 1
    else:
        game_date = date.today() + timedelta(days=1)

    run_screener(game_date)
    return 0


if __name__ == "__main__":
    sys.exit(main())
