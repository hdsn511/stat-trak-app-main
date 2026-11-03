"""
analytics/batch/reconcile_projects.py

Grades pick_type='project' rows and the sugg_trending / sugg_streak card snapshots
(batch/snapshot_suggestions.py). nightly.py's reconcile assumes every prop is an
over and has no winner branch, so these are excluded there and settled here.
Sweeps all past ungraded rows and only grades a truly final game (status 2 with
points on the board; a 0-0 row is a pre-game snapshot). Nothing is deleted: a
player with no stat line on a final game gets modifiers.void='dnp'.

Tracking starts at TRACK_START: earlier rows (the 2026-11-02 launch-night slate,
tagged modifiers.untracked='pre-launch') were shown but are never graded. Any
public track record should read graded rows only, so it starts there too.

CLI: python -m analytics.batch.reconcile_projects
"""
from __future__ import annotations

import sys

from analytics.db.connection import supabase
from analytics.engine.prop_model import SPEC

TRACK_START = "2026-11-03"
SUGGESTION_TYPES = ["sugg_trending", "sugg_streak"]


def grade(side: str, actual: float, line: float) -> bool:
    return actual > line if side == "over" else actual < line


def run() -> None:
    for league, s in SPEC.items():
        rows = (supabase.table("pick_results").select("*").eq("league_id", s["league_id"])
                .eq("pick_type", "project").is_("actual_result", "null")
                .gte("game_date", TRACK_START).execute().data or [])
        # Trending / Streak Watch suggestions (batch/snapshot_suggestions.py): overs at a rung.
        rows += (supabase.table("pick_results").select("*").eq("league_id", s["league_id"])
                 .in_("pick_type", SUGGESTION_TYPES).is_("actual_result", "null").execute().data or [])
        rows = [r for r in rows if not (r.get("modifiers") or {}).get("void")
                and not (r.get("modifiers") or {}).get("untracked")]
        done = 0
        for r in rows:
            g = (supabase.table("games").select("status,home_score,away_score,home_team_id,away_team_id")
                 .eq("id", r["game_id"]).limit(1).execute().data or [None])[0]
            if not g or g["status"] != 2 or g["home_score"] is None or (g["home_score"] + g["away_score"]) == 0:
                continue
            mods = r.get("modifiers") or {}
            if r["prop_type"] == "winner":
                margin = g["home_score"] - g["away_score"]
                margin = margin if mods.get("team_id") == g["home_team_id"] else -margin
                if margin == 0:
                    supabase.table("pick_results").update({"modifiers": {**mods, "void": "tie"}}).eq("id", r["id"]).execute()
                    continue
                upd = {"actual_result": margin, "did_hit": margin > 0}
            else:
                col = s["stats"][r["stat"]]
                sel = col + (f",{s['played']}" if s["played"] else "")
                st = (supabase.table(s["table"]).select(sel).eq("game_id", r["game_id"])
                      .eq("player_id", r["entity_id"]).limit(1).execute().data or [])
                if st and s["played"] and not (st[0].get(s["played"]) or 0) > 0:
                    st = []     # a 0-minute row is a did-not-play, not a 0-stat game
                if not st:
                    box = (supabase.table(s["table"]).select("player_id").eq("game_id", r["game_id"]).limit(1).execute().data)
                    if box:     # box score landed without him: did not play
                        supabase.table("pick_results").update({"modifiers": {**mods, "void": "dnp"}}).eq("id", r["id"]).execute()
                    continue
                actual = float(st[0][col] or 0)
                line = float(r["recommended_line"])
                if actual == line:
                    supabase.table("pick_results").update({"modifiers": {**mods, "void": "push"}}).eq("id", r["id"]).execute()
                    continue
                upd = {"actual_result": actual, "did_hit": grade(mods.get("side", "over"), actual, line)}
            supabase.table("pick_results").update(upd).eq("id", r["id"]).execute()
            done += 1
        print(f"[reconcile_projects:{league}] {done}/{len(rows)} graded")


if __name__ == "__main__":
    run()
    sys.exit(0)
