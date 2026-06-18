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
from analytics.engine.calibration import apply_calibration
from analytics.kalshi.client import KalshiClient
from analytics.screener.screen_mlb import screen_player_candidates, screen_game_candidates

MIN_CONFIDENCE = 55
MIN_IMPLIED_PROB = 0.47

# Market-shrink fallback for GAME props (spreads), which have no empirical
# calibration curve: calibrated = w*model + (1-w)*market. Player props instead
# use the per-stat empirical predicted->actual curve (analytics/engine/
# calibration.py), which de-biases the recency over-extrapolation directly.
CALIBRATION_WEIGHT = 0.5

# Minimum prop line per stat — filter garbage low markets.
MIN_PROP_LINE = {"hits": 0.5, "hr": 0.5, "rbi": 0.5, "ks": 3.5, "tb": 0.5, "hrr": 0.5}


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
    if not rows:
        print("  No daily_lines to store (keeping existing snapshot).")
        return
    # Snapshot semantics: each pipeline run REPLACES this date's lines instead of
    # appending. Kalshi prices/markets drift through the day, so without this the
    # 3 daily runs stacked ~3x duplicate rows per date. The empty-run guard above
    # means a late run that finds no markets never wipes a good snapshot.
    supabase.table("daily_lines").delete().eq("game_date", game_date)\
        .eq("league_id", MLB_LEAGUE_ID).execute()
    for i in range(0, len(rows), 500):
        supabase.table("daily_lines").insert(rows[i:i + 500]).execute()
    print(f"  Stored {len(rows)} daily_lines rows (snapshot replace).")


def _store_picks(game_date: str, picks: list[dict]) -> None:
    if not picks:
        print("  No picks to store.")
        return
    rows = [{
        "game_date": game_date, "prop_type": p.get("prop_type", "player"), "entity_id": p["entity_id"],
        "stat": p["stat"], "pick_type": p["pick_type"], "recommended_line": p["line"],
        "hit_rate": p.get("hit_rate_adjusted") or p["hit_rate"], "sample_size": p["sample_size"],
        "confidence_score": p["confidence"], "implied_prob": p["implied_prob"],
        "edge": p["edge"], "conditions_matched": p["conditions_matched"],
        "total_conditions": p["total_conditions"], "key_conditions": p.get("condition_breakdown"),
        "modifiers": p.get("modifiers", {}), "alt_lines_tested": p.get("alt_lines_tested"),
        "league_id": MLB_LEAGUE_ID,
    } for p in picks]
    # Snapshot semantics: replace this date's *ungraded* MLB picks with the current
    # run instead of accumulating across the 3 daily pipeline runs. The slate's
    # inputs (Kalshi markets/prices + confirmed lineups) drift hour-to-hour, so each
    # run surfaced a different set and the table grew to the union of all runs.
    # Already-graded rows (actual_result set by reconcile, which runs only for past
    # dates) are preserved; the empty-run guard above means a late/empty run is a
    # no-op and never wipes the slate.
    supabase.table("pick_results").delete().eq("game_date", game_date)\
        .eq("league_id", MLB_LEAGUE_ID).is_("actual_result", "null").execute()
    for i in range(0, len(rows), 500):
        supabase.table("pick_results").insert(rows[i:i + 500]).execute()
    print(f"  Stored {len(rows)} pick_results rows (snapshot replace).")


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
                # Empirical predicted->actual calibration (per stat) de-biases the
                # backtest hit rate's recency over-extrapolation; edge is computed
                # on the calibrated value. Quality floor still gates on raw hit_rate.
                cal_hr = apply_calibration(stat, bt["hit_rate"])
                sc = score(hit_rate=bt["hit_rate"], sample_size=bt["sample_size"],
                           conditions_matched=bt["conditions_matched"],
                           total_conditions=bt["total_conditions"],
                           implied_prob=implied, days_rest=3, stat=stat,
                           calibrated_prob=cal_hr)
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
    # A doubleheader (two same-team games on one date) is ambiguous by teams
    # alone, and we don't yet reconcile the event key's start time against a
    # stored game time — so we SKIP game props for any matchup that resolves to
    # more than one game, rather than risk pinning a market to the wrong game.
    event_to_game: dict[str, int] = {}
    ambiguous: set[str] = set()
    for ek, _pt in game_props:
        if ek in event_to_game or ek in ambiguous:
            continue
        eu = ek.upper()
        matches = [
            c["game_id"] for c in game_candidates
            if id_to_abbr.get(c["home_team_id"], "") and id_to_abbr.get(c["away_team_id"], "")
            and id_to_abbr.get(c["home_team_id"], "") in eu
            and id_to_abbr.get(c["away_team_id"], "") in eu
        ]
        if len(matches) == 1:
            event_to_game[ek] = matches[0]
        elif len(matches) > 1:
            ambiguous.add(ek)
            print(f"  SKIP {ek}: matches {len(matches)} same-day games (doubleheader) — no game prop")

    # Game props need BOTH positive edge AND a respectable market price, so we
    # floor implied prob the same way player props do (excludes heavy longshot
    # alts). Game lines are efficiently priced, so the model's real edge is small
    # and lives where the market misprices — require a small POSITIVE calibrated
    # edge (never a contrarian pick) and cap to the few strongest per slate.
    #
    # SPREAD line selection: a 972-game OOS calibration
    # (analytics/engine/validate_game_lines.py) showed cover_prob is well
    # calibrated at EVERY run line, incl. the underdog +1.5/+2.5/+3.5 cushions
    # (gap <=0.03 at the tails). So instead of forcing the line closest to the
    # main number, we take the best-VALUE alt line per game. One pick per game:
    # alt lines on the same game are correlated, so we don't stack them.
    # WINNER keeps the line closest to the main number (highest implied prob).
    GAME_MIN_EDGE = 0.02
    GAME_MIN_SAMPLE = 12
    GAME_MIN_IMPLIED_PROB = 0.47   # no heavy alt lines; mirrors player MIN_IMPLIED_PROB
    MAX_WINNER_PICKS = 3
    MAX_SPREAD_PICKS = 4           # alt run lines now eligible (best-value per game)
    # Totals are disabled: a 4,448-game backtest (2024+) showed both the pooled
    # model AND a pitcher-aware run projection (team offense × opposing-starter
    # recent ER, log5) correlate only ~0.08-0.10 with actual game totals — i.e.
    # they barely beat guessing the league mean (8.76) and are badly miscalibrated
    # (projects 6.2 for games that average 8.2). The market already prices these
    # public features plus weather/lineups/bullpen, so there's no residual edge.
    # Re-enable only if a model with real out-of-sample signal is built + validated.
    ENABLE_TOTAL_PICKS = False

    # game_id -> (home_abbr, away_abbr), used to price the underdog +cushion (the
    # NO side of the opponent's "wins by more than" market).
    game_abbrs: dict[int, tuple[str, str]] = {
        c["game_id"]: (id_to_abbr.get(c["home_team_id"], ""), id_to_abbr.get(c["away_team_id"], ""))
        for c in game_candidates
    }

    def add_cand(cands: list, game_id: int, ek: str, prop_type: str,
                 team_abbr, line_val, implied, model_hit, bt) -> None:
        """Gate one market side; append a candidate if it clears. `line_val` follows
        the backtest convention: >0 = team wins by more than line (lays runs),
        <0 = team +|line| cushion (gets runs)."""
        if implied is None or implied > 0.92 or implied < GAME_MIN_IMPLIED_PROB:
            return
        # Calibrate toward market (same blend as player props), gate edge on it.
        cal = CALIBRATION_WEIGHT * model_hit + (1.0 - CALIBRATION_WEIGHT) * implied
        edge = cal - implied
        if edge < GAME_MIN_EDGE:
            return
        # Conservative confidence for game props — the margin model is crude, so
        # cap below strong player picks (keeps POTD a player).
        confidence = round(min(72.0, 45.0 + edge * 120.0), 2)
        cands.append({
            "entity_id": game_id, "entity_name": ek, "prop_type": prop_type,
            "stat": prop_type, "pick_type": "game", "line": line_val,
            "implied_prob": implied, "hit_rate": cal,
            "sample_size": bt["sample_size"], "conditions_matched": bt["conditions_matched"],
            "total_conditions": bt["total_conditions"],
            "condition_breakdown": bt.get("condition_breakdown"),
            "confidence": confidence, "edge": round(edge, 4),
            "modifiers": {"team_abbr": team_abbr} if team_abbr else {},
            "alt_lines_tested": None,
        })

    game_results: list[dict] = []
    for (ek, prop_type), lines in game_props.items():
        if prop_type == "total" and not ENABLE_TOTAL_PICKS:
            continue
        game_id = event_to_game.get(ek)
        if game_id is None:
            continue
        cands: list[dict] = []
        for le in lines:
            line_val, implied, team_abbr = le["line"], le["implied_prob"], le.get("team_abbr")
            bt = backtest_game_mlb(game_id, prop_type, line_val, date_str, team_abbr=team_abbr)
            if bt is None or bt["sample_size"] < GAME_MIN_SAMPLE:
                continue
            model = bt["hit_rate"]
            # Listed side: "team wins by more than line" (favorite lays runs).
            add_cand(cands, game_id, ek, prop_type, team_abbr, line_val, implied, model, bt)
            # Spread complement: the underdog +line cushion (e.g. +1.5/+2.5/+3.5) is
            # the NO side of this market — opponent gets `line` runs. Margins are
            # integral so .5 lines never push, making it the exact complement:
            # P(opp covers +L) = 1 - P(team wins by >L). Implied ~= 1 - YES price.
            if prop_type == "spread" and line_val is not None and team_abbr:
                home_ab, away_ab = game_abbrs.get(game_id, ("", ""))
                opp = away_ab if team_abbr == home_ab else home_ab
                if opp:
                    add_cand(cands, game_id, ek, prop_type, opp, -line_val,
                             1.0 - implied, 1.0 - model, bt)
        if not cands:
            continue
        if prop_type == "spread":
            # Best-value run line for this game — favorite cover OR underdog cushion;
            # alt lines are well calibrated (OOS), so trust the biggest edge.
            best = max(cands, key=lambda c: c["edge"])
            best["alt_lines_tested"] = len(cands)
        else:
            # winner/total: line closest to the main number, tie-broken by edge.
            best = max(cands, key=lambda c: (c["implied_prob"], c["edge"]))
        game_results.append(best)
    # Surface only the strongest few game picks per slate (ranked by edge).
    winners = sorted([r for r in game_results if r["prop_type"] == "winner"],
                     key=lambda r: -r["edge"])[:MAX_WINNER_PICKS]
    spreads = sorted([r for r in game_results if r["prop_type"] == "spread"],
                     key=lambda r: -r["edge"])[:MAX_SPREAD_PICKS]
    game_results = winners + spreads
    print(f"  Game prop picks passing filters: {len(game_results)} "
          f"({len(winners)} ML, {len(spreads)} spread)")
    picks.extend(game_results)

    picks.sort(key=lambda x: x["confidence"], reverse=True)
    print(f"  Final picks: {len(picks)}")

    print("\n[Step 5] Storing picks ...")
    _store_picks(date_str, picks)

    # summary
    print("\n" + "=" * 70)
    for p in picks[:25]:
        # Game props (moneyline) have no line, and a name can be missing — keep
        # the summary print defensive so it never crashes the pipeline.
        name = p.get("entity_name") or "—"
        stat = p.get("stat") or "—"
        line = p.get("line")
        line_s = f"{line:<5}" if line is not None else "—    "
        print(f"  {name:<22} {stat:<5} [{p['pick_type']:<5}] "
              f"line={line_s} hit={p['hit_rate']:.1%} conf={p['confidence']:.0f} "
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
