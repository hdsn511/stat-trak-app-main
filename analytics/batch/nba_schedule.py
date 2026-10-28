"""
analytics/batch/nba_schedule.py

One-time, whole-season NBA schedule load.

The schedule is published up front and does not change game by game, so it is
loaded once per season (32 requests: one full-season schedule per team) instead
of a rolling nightly 7-day window. Only not-yet-final games are written; the
nightly box-score ingest upserts over them by the same ESPN-derived ext_id when
they finish, which is how a scheduled game becomes final.

Usage:
    python -m analytics.batch.nba_schedule              # current season
    python -m analytics.batch.nba_schedule --season 2026
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from analytics.db.connection import BATCH_SIZE, supabase
from analytics.data.espn import client as espn
from analytics.data.nba_espn.ingest import build_game_rows_from_events, load_team_maps

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")


def main() -> int:
    parser = argparse.ArgumentParser(description="Load the full NBA season schedule once")
    parser.add_argument("--season", type=int, default=None,
                        help="season start year (default: current)")
    args = parser.parse_args()

    now = datetime.now(ET)
    season = args.season if args.season is not None else (now.year if now.month >= 8 else now.year - 1)
    espn_year = season + 1  # ESPN labels an NBA season by its end year

    team_espn_map, _ = load_team_maps()
    events_by_date: dict[str, dict[str, dict]] = {}
    for team_ext in team_espn_map:
        for ev in espn.get_team_schedule("basketball", "nba", team_ext, espn_year):
            comp = (ev.get("competitions") or [{}])[0]
            if comp.get("status", {}).get("type", {}).get("name") == "STATUS_FINAL":
                continue
            if (ev.get("seasonType") or {}).get("type") not in (2, 3):  # no preseason
                continue
            utc = datetime.strptime(ev["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
            day = utc.astimezone(ET).date().isoformat()
            events_by_date.setdefault(day, {})[str(ev["id"])] = ev

    # Games already stored (possibly under an older, non-ESPN ext_id) are left
    # alone: insert only events whose ESPN id is not in the DB yet.
    known: set[str] = set()
    page = 0
    while True:
        batch = (supabase.table("games").select("espn_id").eq("league_id", 1)
                 .not_.is_("espn_id", "null").order("id")
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        known.update(str(r["espn_id"]) for r in batch)
        if len(batch) < 1000:
            break
        page += 1

    total = 0
    for day, evs in sorted(events_by_date.items()):
        fresh = [e for eid, e in evs.items() if eid not in known]
        rows = build_game_rows_from_events(day, fresh, team_espn_map)
        if not rows:
            continue
        for i in range(0, len(rows), BATCH_SIZE):
            supabase.table("games").upsert(rows[i:i + BATCH_SIZE],
                                           on_conflict="league_id,ext_id").execute()
        total += len(rows)
    print(f"Scheduled {total} upcoming NBA game(s) across {len(events_by_date)} day(s), "
          f"season {season}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
