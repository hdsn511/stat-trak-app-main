"""
analytics/picks/generate_mlb.py

MLB pick generator. Same pipeline shape as analytics/picks/generate.py, but
sport-specific: MLB screener + MLB backtest engine + MLB Kalshi series, sharing
the (sport-neutral) scorer.

Player props only for v1 (hits / home_runs / RBIs / pitcher strikeouts). MLB game
props (totals / spread / winner) are a follow-up.

CLI:
    python -m analytics.picks.generate_mlb --date 2026-06-11
    python -m analytics.picks.generate_mlb --today
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta

from analytics.db.connection import supabase, MLB_LEAGUE_ID
from analytics.engine.backtest_mlb import backtest_player as backtest_player_mlb
from analytics.engine.backtest_mlb import backtest_game as backtest_game_mlb
from analytics.engine.scorer import score, MIN_EDGE
from analytics.kalshi.client import KalshiClient
from analytics.screener.screen_mlb import screen_player_candidates, screen_game_candidates

MIN_CONFIDENCE = 55
MIN_IMPLIED_PROB = 0.47

# Minimum prop line per stat — filter garbage low markets.
MIN_PROP_LINE = {"hits": 0.5, "hr": 0.5, "rbi": 0.5, "ks": 3.5}


def _store_daily_lines(game_date: str, player_props: dict, name_to_id: dict) -> None:
    rows = []
    for (player_name, stat), lines in player_props.items():
        entity_id = name_to_id.get(player_name)
        if entity_id is None:
            continue
        for e in lines:
            rows.append({
                "game_date": game_date, "prop_type": "player", "entity_id": entity_id,
                "stat": stat, "line": e["line"], "kalshi_price": e["price"],
                "implied_prob": e["implied_prob"], "market_ticker": e.get("ticker", ""),
                "is_first_half": False, "league_id": MLB_LEAGUE_ID,
            })
    if rows:
        for i in range(0, len(rows), 500):
            supabase.table("daily_lines").insert(rows[i:i + 500]).execute()
    print(f"  Stored {len(rows)} daily_lines rows.")


def _store_picks(game_date: str, picks: list[dict]) -> None:
    if not picks:
        print("  No picks to store.")
        return
    rows = [{
        "game_date": game_date, "prop_type": p.get("prop_type", "player"), "entity_id": p["entity_id"],
        "stat": p["stat"], "pick_type": p["pick_type"], "recommended_line": p["line"],
        "hit_rate": p["hit_rate"], "sample_size": p["sample_size"],
        "confidence_score": p["confidence"], "implied_prob": p["implied_prob"],
        "edge": p["edge"], "conditions_matched": p["conditions_matched"],
        "total_conditions": p["total_conditions"], "key_conditions": p.get("condition_breakdown"),
        "modifiers": p.get("modifiers", {}), "alt_lines_tested": p.get("alt_lines_tested"),
        "league_id": MLB_LEAGUE_ID,
    } for p in picks]
    for i in range(0, len(rows), 500):
        supabase.table("pick_results").upsert(
            rows[i:i + 500], on_conflict="game_date,entity_id,stat,pick_type").execute()
    print(f"  Stored {len(rows)} pick_results rows.")


def generate_picks(game_date: date) -> list[dict]:
    date_str = game_date.strftime("%Y-%m-%d")
    print("=" * 70)
    print(f"StatTrak MLB Pick Generator  |  date: {date_str}")
    print("=" * 70)

    print("\n[Step 1] Screening candidates ...")
    candidates = screen_player_candidates(game_date)
    print(f"  Player candidates: {len(candidates)}")
    if not candidates:
        print("  No candidates. Exiting.")
        return []

    print("\n[Step 2] Fetching Kalshi MLB lines ...")
    kalshi = KalshiClient(sport="mlb")
    markets = kalshi.get_nba_markets()
    player_props = kalshi.parse_player_props(markets)
    print(f"  Player prop combos: {len(player_props)}")

    rows = (supabase.table("players").select("id,name")
            .eq("league_id", MLB_LEAGUE_ID).execute()).data or []
    name_to_id = {r["name"].lower(): r["id"] for r in rows}
    id_to_name = {r["id"]: r["name"] for r in rows}

    _store_daily_lines(date_str, player_props, name_to_id)

    print("\n[Steps 3+4] Backtesting + scoring ...")
    grouped: dict[tuple[int, str], list[dict]] = {}
    for cand in candidates:
        player_id = cand["player_id"]
        name = id_to_name.get(player_id, "").lower()
        for stat in cand["stats_to_check"]:
            lines = player_props.get((name, stat), [])
            if not lines:
                continue
            stat_passing: list[dict] = []
            alt_lines: list[dict] = []
            for le in lines:
                line_val, implied = le["line"], le["implied_prob"]
                if line_val < MIN_PROP_LINE.get(stat, 0):
                    continue
                if implied < MIN_IMPLIED_PROB:
                    continue
                bt = backtest_player_mlb(player_id, stat, line_val, date_str)
                if bt is None:
                    continue
                sc = score(hit_rate=bt["hit_rate"], sample_size=bt["sample_size"],
                           conditions_matched=bt["conditions_matched"],
                           total_conditions=bt["total_conditions"],
                           implied_prob=implied, days_rest=3, stat=stat)
                alt_lines.append({"line": line_val, "hit_rate": bt["hit_rate"],
                                  "confidence": sc.get("confidence", 0), "edge": sc.get("edge", 0)})
                if "reason" in sc or sc["confidence"] < MIN_CONFIDENCE or sc["edge"] < MIN_EDGE:
                    continue
                stat_passing.append({
                    "entity_id": player_id, "entity_name": id_to_name.get(player_id),
                    "stat": stat, "line": line_val, "implied_prob": implied,
                    "hit_rate": bt["hit_rate"], "hit_rate_adjusted": sc.get("hit_rate_adjusted"),
                    "sample_size": bt["sample_size"], "conditions_matched": bt["conditions_matched"],
                    "total_conditions": bt["total_conditions"],
                    "condition_breakdown": bt.get("condition_breakdown"),
                    "confidence": sc["confidence"], "edge": sc["edge"],
                    "modifiers": sc.get("modifiers", {}), "alt_lines_tested": alt_lines,
                })
            if stat_passing:
                safe = max(stat_passing, key=lambda r: r["hit_rate_adjusted"] or 0)
                value = max(stat_passing, key=lambda r: r["edge"])
                grouped.setdefault((player_id, stat), []).append({**safe, "pick_type": "safe"})
                if value["line"] != safe["line"]:
                    grouped[(player_id, stat)].append({**value, "pick_type": "value"})

    picks = [p for group in grouped.values() for p in group]

    # ── Game props (totals + run line) ───────────────────────────────────────
    print("\n[Step 3b] Backtesting + scoring game props ...")
    game_props = kalshi.parse_game_props(markets)
    game_candidates = screen_game_candidates(game_date)
    team_rows = (supabase.table("teams").select("id,abbreviation")
                 .eq("league_id", MLB_LEAGUE_ID).execute()).data or []
    id_to_abbr = {r["id"]: (r["abbreviation"] or "").upper() for r in team_rows}

    # Match each Kalshi event_key to a scheduled game by team abbreviations.
    event_to_game: dict[str, int] = {}
    for ek, _pt in game_props:
        eu = ek.upper()
        for c in game_candidates:
            h = id_to_abbr.get(c["home_team_id"], ""); a = id_to_abbr.get(c["away_team_id"], "")
            if h and a and h in eu and a in eu:
                event_to_game[ek] = c["game_id"]; break

    # Game props are scored on EDGE, not the 0.55 "safe" hit-rate floor used for
    # player props: a value over priced at 20% that the model hits 30% of the
    # time is +EV even though it's a longshot. Quality is protected by a solid
    # edge bar + sample size.
    GAME_MIN_EDGE = 0.07
    GAME_MIN_SAMPLE = 12
    game_results: list[dict] = []
    for (ek, prop_type), lines in game_props.items():
        game_id = event_to_game.get(ek)
        if game_id is None:
            continue
        best: dict | None = None
        for le in lines:
            line_val, implied = le["line"], le["implied_prob"]
            if implied > 0.92:   # near-certain markets: no value
                continue
            bt = backtest_game_mlb(game_id, prop_type, line_val, date_str, team_abbr=le.get("team_abbr"))
            if bt is None or bt["sample_size"] < GAME_MIN_SAMPLE:
                continue
            edge = bt["hit_rate"] - implied
            if edge < GAME_MIN_EDGE:
                continue
            # Conservative confidence for game props — the run-environment / margin
            # model is crude, so cap below strong player picks (keeps POTD a player).
            confidence = round(min(72.0, 45.0 + edge * 120.0), 2)
            cand = {
                "entity_id": game_id, "entity_name": ek, "prop_type": prop_type,
                "stat": prop_type, "pick_type": "game", "line": line_val,
                "implied_prob": implied, "hit_rate": bt["hit_rate"],
                "sample_size": bt["sample_size"], "conditions_matched": bt["conditions_matched"],
                "total_conditions": bt["total_conditions"],
                "condition_breakdown": bt.get("condition_breakdown"),
                "confidence": confidence, "edge": round(edge, 4),
                "modifiers": {"team_abbr": le.get("team_abbr")} if le.get("team_abbr") else {},
                "alt_lines_tested": None,
            }
            if best is None or cand["edge"] > best["edge"]:
                best = cand
        if best is not None:
            game_results.append(best)
    print(f"  Game prop picks passing filters: {len(game_results)}")
    picks.extend(game_results)

    picks.sort(key=lambda x: x["confidence"], reverse=True)
    print(f"  Final picks: {len(picks)}")

    print("\n[Step 5] Storing picks ...")
    _store_picks(date_str, picks)

    # summary
    print("\n" + "=" * 70)
    for p in picks[:25]:
        print(f"  {p['entity_name']:<22} {p['stat']:<5} [{p['pick_type']:<5}] "
              f"line={p['line']:<5} hit={p['hit_rate']:.1%} conf={p['confidence']:.0f} "
              f"edge={p['edge']:+.1%} n={p['sample_size']}")
    print("=" * 70)
    print(f"  Total: {len(picks)} MLB picks")
    return picks


def main() -> int:
    parser = argparse.ArgumentParser(description="StatTrak MLB pick generator")
    parser.add_argument("--date", type=str, default=None)
    parser.add_argument("--today", action="store_true")
    args = parser.parse_args()
    if args.date:
        d = datetime.strptime(args.date, "%Y-%m-%d").date()
    elif args.today:
        d = date.today()
    else:
        d = date.today()
        print(f"  NOTE: no --date; defaulting to today ({d}).")
    generate_picks(d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
