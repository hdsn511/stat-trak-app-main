"""
analytics/batch/garbage_time.py

Flags garbage time (NFL, NBA) from ESPN play-by-play and stores it sparsely:
  game_garbage_time    one row per scanned game (is_garbage true/false), so
                       reruns skip games already evaluated
  player_garbage_stats one row per player with a non-zero stat inside a flagged
                       window (jsonb), nothing for unflagged games

Rule lives in analytics/data/garbage_time.py. NFL player splits are parsed from
play text and agree with box scores on ~93% of stat cells (rest are off by a
play or a yard) — treat them as approximate. NBA splits use play participants.

CLI:
    python -m analytics.batch.garbage_time --league nfl --season 2025
    python -m analytics.batch.garbage_time --league nba --start 2025-10-01 --end 2026-06-30
    python -m analytics.batch.garbage_time --league nfl --season 2025 --rescan
"""

from __future__ import annotations

import argparse
import sys

from analytics.data import garbage_time as gt
from analytics.data.espn import client as espn
from analytics.db.connection import BATCH_SIZE, supabase

# league code -> (leagues.id lookup name, game id column, team/player id column)
CFG = {
    "nfl": {"sport": "football", "id_col": "ext_id", "entity_col": "ext_id"},
    "nba": {"sport": "basketball", "id_col": "espn_id", "entity_col": "espn_id"},
}


def _paged(query_fn) -> list[dict]:
    out, page = [], 0
    while True:
        batch = query_fn().range(page * 1000, page * 1000 + 999).execute().data or []
        out += batch
        if len(batch) < 1000:
            return out
        page += 1


def _league_id(code: str) -> int:
    rows = supabase.table("leagues").select("id,name").execute().data or []
    for r in rows:
        if str(r["name"]).lower() == code:
            return r["id"]
    raise SystemExit(f"league {code} not found in leagues table")


def _chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def scan_game(code: str, game: dict, summary: dict, player_map: dict[str, int]):
    """Return (game_row, [player_rows]) for one game, or (None, []) if no plays."""
    if code == "nfl":
        plays = gt.nfl_plays_with_offense(summary)
    else:
        plays = summary.get("plays") or []
    if not plays:
        return None, []
    win = gt.find_window(plays, game["home_score"], game["away_score"], code)
    base = {"game_id": game["id"], "league_id": game["league_id"]}
    if not win:
        return {**base, "is_garbage": False}, []
    leader = game["home_team_id"] if win["leader"] == "home" else game["away_team_id"]
    start = win["start"]
    row = {**base, "is_garbage": True, "leader_team_id": leader,
           "threshold": gt.RULES[code]["lead"],
           "start_period": 4, "start_clock": (start.get("clock") or {}).get("displayValue"),
           "lead_at_start": win["lead"],
           "final_margin": abs(game["home_score"] - game["away_score"]),
           "n_plays": len(win["plays"])}
    if code == "nfl":
        per = gt.nfl_player_stats(win["plays"], gt.nfl_offense_names(summary))
    else:
        per = gt.nba_player_stats(win["plays"])
    prows = [{"game_id": game["id"], "league_id": game["league_id"],
              "player_id": player_map[ext], "stats": st}
             for ext, st in per.items() if ext in player_map and st]
    return row, prows


def main() -> int:
    ap = argparse.ArgumentParser(description="Detect + store garbage time")
    ap.add_argument("--league", choices=sorted(CFG), required=True)
    ap.add_argument("--season", type=int)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--rescan", action="store_true",
                    help="re-evaluate games that already have a game_garbage_time row")
    args = ap.parse_args()
    code, cfg = args.league, CFG[args.league]
    lid = _league_id(code)

    def games_q():
        q = (supabase.table("games")
             .select(f"id,league_id,game_date,home_team_id,away_team_id,home_score,away_score,{cfg['id_col']}")
             .eq("league_id", lid).eq("status", 2).order("id"))
        if args.season:
            q = q.eq("season", args.season)
        if args.start:
            q = q.gte("game_date", args.start)
        if args.end:
            q = q.lte("game_date", args.end)
        return q
    games = _paged(games_q)
    if not args.rescan:
        done = {r["game_id"] for r in _paged(
            lambda: supabase.table("game_garbage_time").select("game_id").eq("league_id", lid).order("game_id"))}
        games = [g for g in games if g["id"] not in done]
    games = [g for g in games if g.get("home_score") is not None]
    print(f"[garbage:{code}] {len(games)} game(s) to scan")

    pcol = cfg["entity_col"]
    player_map = {str(r[pcol]): r["id"] for r in _paged(
        lambda: supabase.table("players").select(f"id,{pcol}").eq("league_id", lid)
        .not_.is_(pcol, "null").order("id"))}

    # NBA games ingested before the ESPN migration have no espn_id: match them
    # to ESPN events by (date, home, away) and stamp games.espn_id.
    team_by_espn: dict[str, int] = {}
    scoreboards: dict[str, dict] = {}
    if code == "nba":
        team_by_espn = {str(r["espn_id"]): r["id"] for r in _paged(
            lambda: supabase.table("teams").select("id,espn_id").eq("league_id", lid)
            .not_.is_("espn_id", "null").order("id"))}

    def resolve_espn_id(g: dict):
        day = g["game_date"]
        if day not in scoreboards:
            evs = espn.get_scoreboard("basketball", "nba", day.replace("-", ""))
            m = {}
            for ev in evs:
                sides = {c["homeAway"]: team_by_espn.get(str(c["team"]["id"]))
                         for c in (ev.get("competitions") or [{}])[0].get("competitors", [])}
                m[(sides.get("home"), sides.get("away"))] = str(ev["id"])
            scoreboards[day] = m
        ext = scoreboards[day].get((g["home_team_id"], g["away_team_id"]))
        if ext:
            supabase.table("games").update({"espn_id": ext}).eq("id", g["id"]).execute()
        return ext

    flagged = skipped = 0
    for n, g in enumerate(games, 1):
        ext = g.get(cfg["id_col"])
        if not ext and code == "nba":
            ext = resolve_espn_id(g)
        if not ext:
            skipped += 1
            continue
        try:
            summary = espn.get_summary(cfg["sport"], code, str(ext))
            if not summary:
                skipped += 1
                continue
            grow, prows = scan_game(code, g, summary, player_map)
            if not grow:
                skipped += 1
                continue
            supabase.table("game_garbage_time").upsert(grow, on_conflict="game_id").execute()
            supabase.table("player_garbage_stats").delete().eq("game_id", g["id"]).execute()
            for chunk in _chunked(prows, BATCH_SIZE):
                supabase.table("player_garbage_stats").upsert(
                    chunk, on_conflict="game_id,player_id").execute()
            flagged += int(grow["is_garbage"])
        except Exception as exc:  # one bad game must not abort a season run
            print(f"  WARN game {g['id']}: {exc}")
            skipped += 1
        if n % 50 == 0:
            print(f"  {n}/{len(games)} scanned, {flagged} flagged, {skipped} skipped")
    print(f"[garbage:{code}] done: {len(games)-skipped} scanned, {flagged} flagged, {skipped} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
