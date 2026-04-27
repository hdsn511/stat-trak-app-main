"""
analytics/picks/generate.py

End-to-end pick generator for StatTrak Analytics.

Ties together the screener, Kalshi client, backtester, and scorer into a
single pipeline that produces recommended picks for a given game date.

Pipeline steps:
  1. Screen player and game candidates
  2. Fetch Kalshi lines (live or mock)
  3. Backtest + score player props
  3b. Backtest + score game props
  5+6. Select best lines (safe + value) per entity/stat
  7. Store picks to pick_results table
  8. Print summary

CLI:
    python -m analytics.picks.generate --date 2026-03-22 --mock
    python -m analytics.picks.generate          (default: tomorrow, live Kalshi)
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date as _date
from datetime import date, datetime, timedelta
from typing import Optional

from analytics.db.connection import supabase
from analytics.engine.backtest import backtest_player, backtest_game_prop, backtest_winner, build_tgs_cache, load_completed_games
from analytics.engine.scorer import score, MIN_HIT_RATE, MIN_EDGE
from analytics.kalshi.client import KalshiClient
from analytics.screener.screen import screen_player_candidates, screen_game_candidates

# ── Constants ────────────────────────────────────────────────────────────────

MIN_CONFIDENCE = 70

# Minimum prop line per stat — filters out garbage low lines from Kalshi
MIN_PROP_LINE: dict[str, float] = {
    "pts":  10.0,
    "reb":   3.5,
    "ast":   1.5,
    "fg3m":  1.5,
}

# ── Ticker date parsing ──────────────────────────────────────────────────────

_TICKER_DATE_RE = re.compile(r'^KX[A-Z]+-(\d{2})([A-Z]{3})(\d{2})')
_MONTH_MAP = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5,  "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def _parse_ticker_game_date(ticker: str, fallback: str) -> str:
    """Parse '26APR21' from a Kalshi ticker prefix into an ISO date string.
    Falls back to the provided string if the ticker doesn't match (e.g., mock data)."""
    m = _TICKER_DATE_RE.match(ticker or "")
    if not m:
        return fallback
    try:
        yr = 2000 + int(m.group(1))
        mo = _MONTH_MAP[m.group(2)]
        dy = int(m.group(3))
        return _date(yr, mo, dy).isoformat()
    except (KeyError, ValueError):
        return fallback


# ── Helper: store daily lines ────────────────────────────────────────────────

def _store_daily_lines(
    game_date: date,
    player_props: dict,
    game_props: dict,
    name_to_id: dict[str, int],
    event_key_to_game_id: dict[str, int],
    abbr_to_team_id: dict[str, int],
) -> None:
    """Insert fetched Kalshi lines into the daily_lines table."""
    date_str = game_date.strftime("%Y-%m-%d")
    rows: list[dict] = []

    for (player_name, stat), lines in player_props.items():
        entity_id = name_to_id.get(player_name)
        for entry in lines:
            rows.append({
                "game_date": _parse_ticker_game_date(entry.get("ticker", ""), date_str),
                "prop_type": "player",
                "entity_id": entity_id,
                "stat": stat,
                "line": entry["line"],
                "kalshi_price": entry["price"],
                "implied_prob": entry["implied_prob"],
                "market_ticker": entry.get("ticker", ""),
                "is_first_half": entry.get("is_first_half", False),
            })

    for (event_key, prop_type), lines in game_props.items():
        game_id = event_key_to_game_id.get(event_key)
        for entry in lines:
            team_abbr = entry.get("team_abbr")
            team_id = abbr_to_team_id.get(team_abbr) if team_abbr else None
            rows.append({
                "game_date": _parse_ticker_game_date(entry.get("ticker", ""), date_str),
                "prop_type": prop_type,
                "entity_id": game_id,
                "team_id": team_id,
                "stat": prop_type,
                "line": entry["line"],
                "kalshi_price": entry["price"],
                "implied_prob": entry["implied_prob"],
                "market_ticker": entry.get("ticker", ""),
                "is_first_half": entry.get("is_first_half", False),
            })

    if rows:
        BATCH = 500
        for i in range(0, len(rows), BATCH):
            supabase.table("daily_lines").insert(rows[i : i + BATCH]).execute()
        print(f"  Stored {len(rows)} daily_lines rows.")
    else:
        print("  No daily_lines to store.")


# ── Step 5+6: Select best lines ─────────────────────────────────────────────

def _select_best_lines(results: list[dict]) -> list[dict]:
    """
    Group results by (entity_id, stat) and select:
      - "safe" pick: highest hit_rate
      - "value" pick: highest edge (only if different line than safe)

    Returns a list of pick dicts sorted by confidence descending.
    """
    from collections import defaultdict

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in results:
        key = (r["entity_id"], r["stat"])
        groups[key].append(r)

    picks: list[dict] = []

    for (entity_id, stat), entries in groups.items():
        # Safe pick: highest hit_rate
        safe = max(entries, key=lambda x: x["hit_rate"])
        safe_pick = {**safe, "pick_type": "safe"}
        picks.append(safe_pick)

        # Value pick: highest edge, only if different line
        value = max(entries, key=lambda x: x["edge"])
        if value["line"] != safe["line"]:
            value_pick = {**value, "pick_type": "value"}
            picks.append(value_pick)

    # Sort by confidence descending
    picks.sort(key=lambda x: x["confidence"], reverse=True)
    return picks


# ── Step 7: Store picks ─────────────────────────────────────────────────────

def _store_picks(game_date: date, picks: list[dict]) -> None:
    """Insert picks into the pick_results table."""
    if not picks:
        print("  No picks to store.")
        return

    date_str = game_date.strftime("%Y-%m-%d")
    rows: list[dict] = []

    for p in picks:
        rows.append({
            "game_date": date_str,
            "prop_type": p.get("prop_type", "player"),
            "entity_id": p["entity_id"],
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
            "key_conditions": p.get("condition_breakdown"),
            "alt_lines_tested": p.get("alt_lines_tested"),
        })

    BATCH = 500
    for i in range(0, len(rows), BATCH):
        supabase.table("pick_results").insert(rows[i : i + BATCH]).execute()

    print(f"  Stored {len(rows)} pick_results rows.")


# ── Step 8: Print summary ───────────────────────────────────────────────────

def _print_summary(picks: list[dict]) -> None:
    """Print a formatted summary of recommended picks."""
    if not picks:
        print("\n  No picks generated.")
        return

    safe_picks = [p for p in picks if p["pick_type"] == "safe"]
    value_picks = [p for p in picks if p["pick_type"] == "value"]

    print("\n" + "=" * 70)
    print("  RECOMMENDED PICKS")
    print("=" * 70)

    if safe_picks:
        print(f"\n  SAFE PICKS ({len(safe_picks)})")
        print("  " + "-" * 66)
        for p in safe_picks:
            entity_label = p.get("entity_name") or f"id={p['entity_id']}"
            print(
                f"  {entity_label:<25} {p['stat']:<6} "
                f"line={p['line']:<7} "
                f"hit={p['hit_rate']:.1%}  "
                f"conf={p['confidence']:.1f}  "
                f"edge={p['edge']:.1%}  "
                f"n={p['sample_size']}"
            )

    if value_picks:
        print(f"\n  VALUE PICKS ({len(value_picks)})")
        print("  " + "-" * 66)
        for p in value_picks:
            entity_label = p.get("entity_name") or f"id={p['entity_id']}"
            print(
                f"  {entity_label:<25} {p['stat']:<6} "
                f"line={p['line']:<7} "
                f"hit={p['hit_rate']:.1%}  "
                f"conf={p['confidence']:.1f}  "
                f"edge={p['edge']:.1%}  "
                f"n={p['sample_size']}"
            )

    print("\n" + "=" * 70)
    print(f"  Total: {len(safe_picks)} safe + {len(value_picks)} value = {len(picks)} picks")
    print("=" * 70)


# ── Main pipeline ────────────────────────────────────────────────────────────

def generate_picks(game_date: date, mock_kalshi: bool = False) -> list[dict]:
    """
    Run the full pick generation pipeline for the given game date.

    Args:
        game_date:     Target date for picks.
        mock_kalshi:   If True, use mock Kalshi data instead of live API.

    Returns:
        List of recommended pick dicts.
    """
    date_str = game_date.strftime("%Y-%m-%d")
    print("=" * 70)
    print(f"StatTrak Pick Generator  |  date: {date_str}  |  mock={mock_kalshi}")
    print("=" * 70)

    # ── Step 1: Screen candidates ────────────────────────────────────────────
    print("\n[Step 1] Screening candidates ...")
    player_candidates = screen_player_candidates(game_date)
    game_candidates = screen_game_candidates(game_date)
    print(f"  Players: {len(player_candidates)}  |  Games: {len(game_candidates)}")

    if not player_candidates and not game_candidates:
        print("  No candidates found. Exiting.")
        return []

    # ── Step 2: Fetch Kalshi lines ───────────────────────────────────────────
    print("\n[Step 2] Fetching Kalshi lines ...")
    kalshi = KalshiClient(mock=mock_kalshi)
    markets = kalshi.get_nba_markets()
    player_props = kalshi.parse_player_props(markets)
    game_props = kalshi.parse_game_props(markets)
    print(f"  Player prop combos: {len(player_props)}  |  Game prop combos: {len(game_props)}")

    # Build name -> player_id lookup from DB
    player_rows = (
        supabase.table("players")
        .select("id,name")
        .eq("league", "nba")
        .execute()
    )
    name_to_id: dict[str, int] = {}
    id_to_name: dict[int, str] = {}
    for row in (player_rows.data or []):
        name_lower = row["name"].lower()
        name_to_id[name_lower] = row["id"]
        id_to_name[row["id"]] = row["name"]

    # Build event_key -> game_id map so game-prop rows get a joinable entity_id.
    # Kalshi event_ticker strings (e.g. "LAL-GSW") embed team abbreviations; we
    # match against the home/away abbreviations for each scheduled game.
    team_abbr_rows = (
        supabase.table("teams")
        .select("id,abbreviation")
        .execute()
    )
    team_id_to_abbr: dict[int, str] = {
        r["id"]: r["abbreviation"].upper()
        for r in (team_abbr_rows.data or [])
        if r.get("abbreviation")
    }
    abbr_to_team_id: dict[str, int] = {
        v.upper(): k for k, v in team_id_to_abbr.items() if v
    }
    event_key_to_game_id: dict[str, int] = {}
    for event_key, _prop_type in game_props:
        ek_upper = event_key.upper()
        for candidate in game_candidates:
            home_abbr = team_id_to_abbr.get(candidate["home_team_id"], "")
            away_abbr = team_id_to_abbr.get(candidate["away_team_id"], "")
            if home_abbr and away_abbr and home_abbr in ek_upper and away_abbr in ek_upper:
                event_key_to_game_id[event_key] = candidate["game_id"]
                break

    # Warn on event_keys that had no matching scheduled game so failures are
    # visible rather than silently producing entity_id=None rows.
    unmatched = [
        (ek, pt) for (ek, pt) in game_props if ek not in event_key_to_game_id
    ]
    if unmatched:
        preview = unmatched[:5]
        tail = "..." if len(unmatched) > 5 else ""
        print(f"  WARN: {len(unmatched)} game-prop (event_key, prop_type) pairs had no game match: {preview}{tail}")

    # Store lines to daily_lines table
    _store_daily_lines(game_date, player_props, game_props, name_to_id, event_key_to_game_id, abbr_to_team_id)

    # ── Steps 3+4: Backtest + Score Player Props ─────────────────────────────
    print("\n[Steps 3+4] Backtesting + scoring player props ...")
    all_results: list[dict] = []

    for candidate in player_candidates:
        player_id = candidate["player_id"]
        game_id = candidate["game_id"]
        stats_to_check = candidate["stats_to_check"]
        conditions = candidate["conditions"]
        days_rest = conditions.get("days_rest") or 3

        player_name = id_to_name.get(player_id, "")
        player_name_lower = player_name.lower()

        for stat in stats_to_check:
            # Find matching Kalshi lines for this player + stat
            lines = player_props.get((player_name_lower, stat), [])

            # If no matching lines and mock mode, generate mock lines
            if not lines and mock_kalshi:
                lines = kalshi._mock_player_lines(player_name, stat)

            if not lines:
                continue

            alt_lines_tested: list[dict] = []

            for line_entry in lines:
                line_val = line_entry["line"]
                implied_prob = line_entry["implied_prob"]
                is_first_half = line_entry.get("is_first_half", False)

                # Skip garbage low lines (e.g. 1.5 REB, floor props)
                if line_val < MIN_PROP_LINE.get(stat, 0):
                    continue

                # Backtest
                bt = backtest_player(player_id, stat, line_val, date_str)
                if bt is None:
                    continue

                # Score
                sc = score(
                    hit_rate=bt["hit_rate"],
                    sample_size=bt["sample_size"],
                    conditions_matched=bt["conditions_matched"],
                    total_conditions=bt["total_conditions"],
                    implied_prob=implied_prob,
                    days_rest=days_rest,
                    stat=stat,
                    is_first_half=is_first_half,
                )

                # Track tested lines
                alt_lines_tested.append({
                    "line": line_val,
                    "hit_rate": bt["hit_rate"],
                    "confidence": sc.get("confidence", 0),
                    "edge": sc.get("edge", 0),
                })

                # Filter: must pass scoring and meet minimum confidence + edge
                if "reason" in sc:
                    continue
                if sc["confidence"] < MIN_CONFIDENCE:
                    continue
                if sc["edge"] < MIN_EDGE:
                    continue

                all_results.append({
                    "entity_id": player_id,
                    "entity_name": player_name,
                    "prop_type": "player",
                    "stat": stat,
                    "line": line_val,
                    "implied_prob": implied_prob,
                    "hit_rate": bt["hit_rate"],
                    "sample_size": bt["sample_size"],
                    "conditions_matched": bt["conditions_matched"],
                    "total_conditions": bt["total_conditions"],
                    "condition_breakdown": bt.get("condition_breakdown"),
                    "confidence": sc["confidence"],
                    "edge": sc["edge"],
                    "hit_rate_adjusted": sc.get("hit_rate_adjusted"),
                    "is_first_half": is_first_half,
                    "alt_lines_tested": alt_lines_tested,
                })

    print(f"  Player prop results passing filters: {len(all_results)}")

    # ── Step 3b: Backtest + Score Game Props ─────────────────────────────────
    print("\n[Step 3b] Backtesting + scoring game props ...")
    game_results_count = 0

    # Pre-load expensive data once — shared across all game prop calls
    _tgs_cache = build_tgs_cache()
    _completed_games = load_completed_games(date_str)

    for game_candidate in game_candidates:
        game_id = game_candidate["game_id"]
        game_results_this_game = 0

        for (event_key, prop_type), lines in game_props.items():
            # Scope each game's loop to only that game's Kalshi lines.
            if event_key_to_game_id.get(event_key) != game_id:
                continue

            for line_entry in lines:
                line_val = line_entry["line"]
                implied_prob = line_entry["implied_prob"]
                is_first_half = line_entry.get("is_first_half", False)

                if prop_type == "winner":
                    bt = backtest_winner(game_id, date_str)
                else:
                    bt = backtest_game_prop(game_id, prop_type, line_val, date_str,
                                            tgs_cache=_tgs_cache, completed_games=_completed_games)

                if bt is None:
                    continue

                # conditions_matched from backtest_winner is a string ("self_accuracy"),
                # not an int. score() expects an int — cast here at the call site.
                cond_matched = bt["conditions_matched"]
                cond_matched_for_score = (
                    bt["total_conditions"] if isinstance(cond_matched, str) else cond_matched
                )

                # Game props use days_rest=3 (not applicable) and stat=prop_type
                sc = score(
                    hit_rate=bt["hit_rate"],
                    sample_size=bt["sample_size"],
                    conditions_matched=cond_matched_for_score,
                    total_conditions=bt["total_conditions"],
                    implied_prob=implied_prob,
                    days_rest=3,
                    stat=prop_type,
                    is_first_half=is_first_half,
                )

                if "reason" in sc:
                    continue
                if sc["confidence"] < MIN_CONFIDENCE:
                    continue
                if sc["edge"] < MIN_EDGE:
                    continue

                all_results.append({
                    "entity_id": game_id,
                    "entity_name": event_key,
                    "prop_type": prop_type,
                    "stat": prop_type,
                    "line": line_val,
                    "implied_prob": implied_prob,
                    "hit_rate": bt["hit_rate"],
                    "sample_size": bt["sample_size"],
                    "conditions_matched": bt["conditions_matched"],
                    "total_conditions": bt["total_conditions"],
                    "condition_breakdown": bt.get("condition_breakdown"),
                    "confidence": sc["confidence"],
                    "edge": sc["edge"],
                    "hit_rate_adjusted": sc.get("hit_rate_adjusted"),
                    "is_first_half": is_first_half,
                    "alt_lines_tested": None,
                })
                game_results_count += 1
                game_results_this_game += 1

        if game_results_this_game == 0:
            print(f"  game_id={game_id}: no game prop lines passed filters")

    print(f"  Game prop results passing filters: {game_results_count}")

    # ── Steps 5+6: Select best lines ─────────────────────────────────────────
    print(f"\n[Steps 5+6] Selecting best lines from {len(all_results)} results ...")
    picks = _select_best_lines(all_results)
    print(f"  Final picks: {len(picks)}")

    # ── Step 7: Store picks ──────────────────────────────────────────────────
    print("\n[Step 7] Storing picks ...")
    _store_picks(game_date, picks)

    # ── Step 8: Print summary ────────────────────────────────────────────────
    _print_summary(picks)

    return picks


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="StatTrak end-to-end pick generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m analytics.picks.generate --date 2026-03-22 --mock
  python -m analytics.picks.generate --mock
  python -m analytics.picks.generate          (default: tomorrow, live Kalshi)
        """,
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date in YYYY-MM-DD format (default: tomorrow)",
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Use mock Kalshi data instead of live API",
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

    generate_picks(game_date, mock_kalshi=args.mock)
    return 0


if __name__ == "__main__":
    sys.exit(main())
