"""
analytics/batch/mlb_enrich.py

Computes the two opponent-matchup signals the MLB engine uses, both derived
empirically from already-ingested season data (no fabricated constants):

  - mlb_park_factors    : runs/HR environment per home park vs league average.
  - mlb_pitcher_quality : per-pitcher season ERA / K-per-9 / WHIP + starter rank.

Run after a season of box scores has been seeded (mlb_nightly --backfill-from),
and nightly thereafter.

CLI:
    python -m analytics.batch.mlb_enrich --season 2026
    python -m analytics.batch.mlb_enrich --season 2026 --snapshot-date 2026-06-11
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import date

from analytics.db.connection import BATCH_SIZE, MLB_LEAGUE_ID, supabase

OUTS_PER_GAME = 27.0


def _fetch_all(table: str, select: str, filters: list) -> list[dict]:
    rows, page, size = [], 0, 1000
    while True:
        q = supabase.table(table).select(select).range(page * size, page * size + size - 1)
        for method, *args in filters:
            if method == "not_is":          # q.not_.is_(col, val)
                q = q.not_.is_(*args)
            else:
                q = getattr(q, method)(*args)
        batch = (q.execute()).data or []
        rows.extend(batch)
        if len(batch) < size:
            break
        page += 1
    return rows


# ── Park factors ────────────────────────────────────────────────────────────────

def compute_park_factors(season: int) -> int:
    """factor_runs = (avg total runs per game at this park) / (league avg).
    factor_hr likewise for home runs. ~1.0 = neutral, >1 = hitter-friendly."""
    season_start, season_end = f"{season}-01-01", f"{season}-12-31"
    games = _fetch_all("games", "id,home_team_id,home_score,away_score",
                       [("eq", "league_id", MLB_LEAGUE_ID),
                        ("gte", "game_date", season_start), ("lte", "game_date", season_end),
                        ("not_is", "home_score", "null")])
    if not games:
        print("[park] no completed games; skipping.")
        return 0

    # HR per game needs box-score totals per game
    game_ids = [g["id"] for g in games]
    hr_by_game: dict[int, int] = defaultdict(int)
    for i in range(0, len(game_ids), 200):
        chunk = game_ids[i:i + 200]
        for r in _fetch_all("mlb_player_stats", "game_id,home_runs",
                            [("in_", "game_id", chunk), ("not_is", "home_runs", "null")]):
            hr_by_game[r["game_id"]] += r["home_runs"] or 0

    runs_by_park: dict[int, list[float]] = defaultdict(list)
    hr_by_park: dict[int, list[float]] = defaultdict(list)
    for g in games:
        total_runs = (g["home_score"] or 0) + (g["away_score"] or 0)
        runs_by_park[g["home_team_id"]].append(total_runs)
        hr_by_park[g["home_team_id"]].append(hr_by_game.get(g["id"], 0))

    league_runs = sum(sum(v) for v in runs_by_park.values()) / sum(len(v) for v in runs_by_park.values())
    league_hr = sum(sum(v) for v in hr_by_park.values()) / sum(len(v) for v in hr_by_park.values())
    league_runs = league_runs or 1.0
    league_hr = league_hr or 1.0

    rows = []
    for team_id, runs in runs_by_park.items():
        rows.append({
            "team_id": team_id, "season": season,
            "factor_runs": round((sum(runs) / len(runs)) / league_runs, 3),
            "factor_hr": round((sum(hr_by_park[team_id]) / len(hr_by_park[team_id])) / league_hr, 3),
        })
    for i in range(0, len(rows), BATCH_SIZE):
        supabase.table("mlb_park_factors").upsert(rows[i:i + BATCH_SIZE], on_conflict="team_id,season").execute()
    print(f"[park] upserted {len(rows)} park factors (league avg {league_runs:.2f} R, {league_hr:.2f} HR/g)")
    return len(rows)


# ── Pitcher quality ─────────────────────────────────────────────────────────────

def compute_pitcher_quality(season: int, snapshot_date: str) -> int:
    """Season ERA / K-per-9 / WHIP per pitcher, ranked among starters by ERA
    (lower = better, rank 1 = best). A starter is anyone with >= 3 appearances
    averaging >= 12 outs (4 IP)."""
    season_start = f"{season}-01-01"
    stats = _fetch_all(
        "mlb_player_stats",
        "player_id,team_id,outs_pitched,earned_runs,strikeouts_pitched,walks_allowed,hits_allowed,batters_faced",
        [("gte", "game_date", season_start),
         ("lte", "game_date", snapshot_date), ("not_is", "outs_pitched", "null")])

    agg: dict[int, dict] = defaultdict(lambda: {"outs": 0, "er": 0, "k": 0, "bb": 0, "h": 0,
                                                "team": None, "apps": 0})
    for r in stats:
        if not r.get("outs_pitched"):
            continue
        a = agg[r["player_id"]]
        a["outs"] += r["outs_pitched"] or 0
        a["er"] += r["earned_runs"] or 0
        a["k"] += r["strikeouts_pitched"] or 0
        a["bb"] += r["walks_allowed"] or 0
        a["h"] += r["hits_allowed"] or 0
        a["team"] = r["team_id"]
        a["apps"] += 1

    rows = []
    for pid, a in agg.items():
        if a["outs"] <= 0:
            continue
        era = a["er"] * OUTS_PER_GAME / a["outs"]
        k9 = a["k"] * OUTS_PER_GAME / a["outs"]
        whip = (a["bb"] + a["h"]) * 3.0 / a["outs"]
        is_starter = a["apps"] >= 3 and (a["outs"] / a["apps"]) >= 12
        rows.append({
            "player_id": pid, "team_id": a["team"], "snapshot_date": snapshot_date,
            "role": "starter" if is_starter else "reliever",
            "era": round(era, 3), "fip": None, "k_per9": round(k9, 3), "whip": round(whip, 3),
            "_is_starter": is_starter,
        })

    # rank starters by ERA ascending
    starters = sorted([r for r in rows if r["_is_starter"]], key=lambda r: r["era"])
    for rank, r in enumerate(starters, start=1):
        r["quality_rank"] = rank
    for r in rows:
        r.setdefault("quality_rank", None)
        r.pop("_is_starter", None)

    for i in range(0, len(rows), BATCH_SIZE):
        supabase.table("mlb_pitcher_quality").upsert(rows[i:i + BATCH_SIZE], on_conflict="player_id,snapshot_date").execute()
    print(f"[pitcher] upserted {len(rows)} pitcher snapshots ({len(starters)} starters ranked)")
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="MLB enrich: park factors + pitcher quality")
    parser.add_argument("--season", type=int, default=date.today().year)
    parser.add_argument("--snapshot-date", type=str, default=date.today().strftime("%Y-%m-%d"),
                        dest="snapshot_date")
    args = parser.parse_args()
    print("=" * 60)
    print(f"MLB Enrich  |  season {args.season}  snapshot {args.snapshot_date}")
    print("=" * 60)
    compute_park_factors(args.season)
    compute_pitcher_quality(args.season, args.snapshot_date)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
