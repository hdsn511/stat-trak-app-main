"""
analytics/screener/screen_mlb.py

MLB candidate screener — the MLB analog of analytics/screener/screen.py.

Reads mlb_daily_conditions for a date and decides which player/stat combos are
worth a Kalshi market call + backtest. Batters (position != 'P') get the batting
props; pitchers ('P') get the strikeouts prop.

CLI:
    python -m analytics.screener.screen_mlb --date 2026-06-11
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from typing import Optional

from analytics.db.connection import MLB_LEAGUE_ID, supabase

# ── Thresholds ──────────────────────────────────────────────────────────────────
MIN_ROLLING_PA = 2.5         # batter must be a real lineup contributor
MIN_ROLLING_OUTS = 12.0      # pitcher must average >= 4 IP (a starter) for K props

# Per-stat rolling-average floors (batters). Limited to stats with liquid Kalshi
# markets (KXMLBHIT / KXMLBHR / KXMLBRBI). total_bases / runs are computed in
# daily_conditions + trends but have no standalone daily market, so they are not
# screened for picks. See memory: kalshi-mlb-series.
BATTER_STAT_FLOORS = {
    "hits": 0.5,
    "rbi":  0.4,
    "hr":   0.10,
}
ROLLING_COL = {
    "hits": "rolling_hits_5g", "rbi": "rolling_rbi_5g", "hr": "rolling_hr_5g",
}


def screen_player_candidates(game_date: date) -> list[dict]:
    """Return [{player_id, game_id, stats_to_check, conditions}] for a date."""
    date_str = game_date.strftime("%Y-%m-%d")

    dc_rows = (supabase.table("mlb_daily_conditions").select("*")
               .eq("game_date", date_str).execute()).data or []
    if not dc_rows:
        return []

    # position lookup (batter vs pitcher)
    pids = [r["player_id"] for r in dc_rows]
    pos: dict[int, Optional[str]] = {}
    for i in range(0, len(pids), 200):
        chunk = pids[i:i + 200]
        for p in (supabase.table("players").select("id,position")
                  .eq("league_id", MLB_LEAGUE_ID).in_("id", chunk).execute()).data or []:
            pos[p["id"]] = p.get("position")

    candidates: list[dict] = []
    for dc in dc_rows:
        pid = dc["player_id"]
        position = pos.get(pid)
        stats_to_check: list[str] = []

        if position == "P":
            if (dc.get("rolling_outs_5g") or 0) >= MIN_ROLLING_OUTS:
                stats_to_check.append("ks")
        else:
            if (dc.get("rolling_pa_5g") or 0) >= MIN_ROLLING_PA:
                for stat, floor in BATTER_STAT_FLOORS.items():
                    if (dc.get(ROLLING_COL[stat]) or 0) >= floor:
                        stats_to_check.append(stat)

        if stats_to_check:
            candidates.append({
                "player_id": pid,
                "game_id": dc.get("game_id"),
                "stats_to_check": stats_to_check,
                "conditions": dc,
            })
    return candidates


def screen_game_candidates(game_date: date) -> list[dict]:
    """Return today's MLB games for game-prop evaluation (totals + run line).
    No gate — every scheduled game is a candidate."""
    date_str = game_date.strftime("%Y-%m-%d")
    games = (supabase.table("games")
             .select("id,home_team_id,away_team_id")
             .eq("game_date", date_str).eq("league_id", MLB_LEAGUE_ID).execute()).data or []
    return [{"game_id": g["id"], "home_team_id": g["home_team_id"],
             "away_team_id": g["away_team_id"], "prop_types": ["total", "spread"]}
            for g in games]


def main() -> int:
    parser = argparse.ArgumentParser(description="MLB candidate screener")
    parser.add_argument("--date", type=str, default=None)
    args = parser.parse_args()
    d = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else date.today()
    cands = screen_player_candidates(d)
    print(f"{len(cands)} player candidate(s) for {d}")
    for c in cands[:15]:
        print(f"  player={c['player_id']} game={c['game_id']} stats={c['stats_to_check']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
