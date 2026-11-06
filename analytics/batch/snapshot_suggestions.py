"""
analytics/batch/snapshot_suggestions.py

Freezes the morning's Trending Players and Streak Watch suggestions (the Kalshi rung
each card shows) into pick_results, so "yesterday's W-L" on those cards is graded on
what was actually shown. Today's lists can't be graded after the fact: nba_trends is
overwritten nightly, and a player whose streak broke yesterday drops off today's list.

It reads the live API, so a snapshot is the cards' own output rather than a second
implementation of them: both endpoints serve their rows ranked and sized as shown
(server/src/services/nbaWatch.ts), and the first SHOWN of each are stored.

Rows: pick_type sugg_trending | sugg_streak, prop_type 'player', side over at the
suggested rung (recommended_line = rung - 0.5). Graded by batch/reconcile_projects.py.
Idempotent: the (game_date, entity_id, stat, pick_type) key ignores repeats.

CLI:
    python -m analytics.batch.snapshot_suggestions --league nba|nfl
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from analytics.db.connection import supabase

API_BASE = os.getenv("STATTRAK_API_BASE", "https://stattraksports.pages.dev/api")
LEAGUE_ID = {"nba": 1, "nfl": 3}
SHOWN = 10
TREND_KEY = {"points": "pts", "rebounds": "reb", "assists": "ast", "threes": "fg3m",
             "passing_yards": "payds", "passing_tds": "patd", "rushing_yards": "ruyds",
             "receiving_yards": "recyds", "receptions": "rec"}


def _get(path: str, **params):
    params["_"] = int(time.time())   # step past the edge cache: snapshot the current card
    for attempt in range(4):
        try:
            r = requests.get(f"{API_BASE}{path}", params=params, timeout=60)
            if r.ok:
                return r.json()["data"]
            print(f"  GET {path} -> {r.status_code}")
        except requests.RequestException as e:
            print(f"  GET {path} failed: {e}")
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"API unavailable: {path}")


def snapshot(league: str) -> int:
    lid = LEAGUE_ID[league]
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    teams = supabase.table("teams").select("id,abbreviation").eq("league_id", lid).execute().data or []
    abbr_id = {t["abbreviation"].upper(): t["id"] for t in teams}
    games = (supabase.table("games").select("id,home_team_id,away_team_id").eq("league_id", lid)
             .eq("game_date", today).execute().data or [])
    game_of = {tid: g["id"] for g in games for tid in (g["home_team_id"], g["away_team_id"])}

    picked = []
    for r in _get(f"/{league}/trends/top")[:SHOWN]:
        picked.append(("sugg_trending", r["playerId"], r["team"], TREND_KEY.get(r["stat"]), r.get("suggested")))
    for r in _get(f"/{league}/streaks/watch")["rows"][:SHOWN]:
        picked.append(("sugg_streak", r["player_id"], r["team"], r["stat"],
                       {"rung": r["rung"], "line": r["rung"] - 0.5}))

    rows = []
    for ptype, pid, team, stat, sug in picked:
        gid = game_of.get(abbr_id.get((team or "").upper()))
        if not sug or not stat or gid is None:
            continue    # no Kalshi rung covers it, or the team isn't on today's slate
        rows.append({"league_id": lid, "game_date": today, "game_id": gid, "prop_type": "player",
                     "entity_id": pid, "stat": stat, "pick_type": ptype,
                     "recommended_line": sug["line"], "price_source": "kalshi-ladder",
                     "modifiers": {"side": "over", "rung": sug["rung"], "team_abbr": team}})
    if rows:
        supabase.table("pick_results").upsert(
            rows, on_conflict="game_date,entity_id,stat,pick_type", ignore_duplicates=True).execute()
    print(f"[snapshot_suggestions:{league}] {today}: {len(rows)} of {len(picked)} shown suggestions stored "
          f"({sum(r['pick_type'] == 'sugg_trending' for r in rows)} trending, "
          f"{sum(r['pick_type'] == 'sugg_streak' for r in rows)} streak)")
    return len(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", choices=sorted(LEAGUE_ID), required=True)
    snapshot(ap.parse_args().league)
    sys.exit(0)
