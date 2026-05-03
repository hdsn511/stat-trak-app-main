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

MIN_ROLLING_MINUTES = 25    # Baseline minutes gate for scoring/assist/3pm props
MIN_ROLLING_MINUTES_REB = 14  # Lower gate for rebounders: bigs get pulled for fouls
                               # but dominate the glass in shorter bursts (e.g. Robinson)
MIN_ROLLING_PTS = 8         # Min rolling pts avg to check pts props
MIN_ROLLING_REB = 3         # Min rolling reb avg to check reb props
MIN_ROLLING_AST = 2         # Min rolling ast avg to check ast props
MIN_ROLLING_FG3M = 1        # Min rolling 3pm avg to check fg3m props

# Picks v2: gate on touches as the direct opportunity signal (replacing the
# inferred-usage gate). TOP was dropped intentionally — V3 doesn't expose it
# and V2 returns invalid JSON for many games. See fetch_player_track docstring.
# TODO: tune against the distribution of touches across active NBA rotations.
# Current estimate: bench rotation players average ~25 touches per game.
MIN_ROLLING_TOUCHES = 25.0


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
        rolling_touches = row.get("rolling_touches_5g")
        rolling_usg = row.get("rolling_usg_5g")

        # Hard gate: must have sufficient minutes
        if rolling_min is None:
            continue

        # Picks v2: gate on touches when available. During the backfill rampup,
        # rolling_touches_5g will be NULL for players whose 5-game window has
        # no touches data yet — fall back to the legacy usage gate to avoid
        # screening out the entire slate while history fills in.
        if rolling_touches is not None:
            if rolling_touches < MIN_ROLLING_TOUCHES:
                continue
        else:
            if rolling_usg is None:
                continue  # neither signal available — cannot judge opportunity

        stats_to_check: list[str] = []

        # Points/assists/3pm require full-rotation minutes
        if rolling_min >= MIN_ROLLING_MINUTES:
            pts = row.get("rolling_pts_5g")
            if pts is not None and pts >= MIN_ROLLING_PTS:
                stats_to_check.append("pts")

        # Rebounds use a lower minutes floor — specialist bigs (e.g. Robinson)
        # grab boards at high rates in limited minutes due to foul trouble
        reb = row.get("rolling_reb_5g")
        if rolling_min >= MIN_ROLLING_MINUTES_REB and reb is not None and reb >= MIN_ROLLING_REB:
            stats_to_check.append("reb")

        if rolling_min >= MIN_ROLLING_MINUTES:
            ast = row.get("rolling_ast_5g")
            if ast is not None and ast >= MIN_ROLLING_AST:
                stats_to_check.append("ast")

        if rolling_min >= MIN_ROLLING_MINUTES:
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
        touches = cond.get("rolling_touches_5g")
        usg = cond.get("rolling_usg_5g")
        print(
            f"  player_id={p['player_id']}  "
            f"game_id={p['game_id']}  "
            f"stats={p['stats_to_check']}  "
            f"min={cond.get('rolling_min_5g')}  "
            f"touches={touches if touches is not None else '-'}  "
            f"usg={usg if usg is not None else '-'}"
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
