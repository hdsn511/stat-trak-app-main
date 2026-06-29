"""
analytics/batch/mlb_init.py

One-time (and re-runnable) seeding of MLB teams + players into the shared
`teams` / `players` tables with league_id = MLB_LEAGUE_ID.

Mirrors the NBA init pattern: external ids come from the MLB Stats API
(team id, person id), stored as `ext_id`. Handedness (batSide / pitchHand)
is captured for the matchup conditions used by the MLB engine.

CLI:
    python -m analytics.batch.mlb_init
    python -m analytics.batch.mlb_init --season 2026
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from analytics.db.connection import BATCH_SIZE, MLB_LEAGUE_ID, supabase
from analytics.data.mlb import client as mlb


def _chunked(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def seed_teams(season: int) -> dict[str, int]:
    """Upsert all 30 MLB teams. Returns ext_id -> db_id map."""
    teams = mlb.get_teams(season=season)
    print(f"[teams] fetched {len(teams)} MLB teams")
    rows = [{
        "league_id": MLB_LEAGUE_ID,
        "ext_id": str(t["id"]),
        "name": t["name"],
        "abbreviation": t.get("abbreviation") or t.get("teamCode", "").upper(),
        "city": t.get("locationName"),
    } for t in teams]

    for chunk in _chunked(rows, BATCH_SIZE):
        supabase.table("teams").upsert(chunk, on_conflict="league_id,ext_id").execute()
    print(f"[teams] upserted {len(rows)} rows")

    db = (supabase.table("teams")
          .select("id,ext_id,abbreviation")
          .eq("league_id", MLB_LEAGUE_ID).execute())
    return {r["ext_id"]: r["id"] for r in (db.data or [])}, {r["ext_id"]: r["abbreviation"] for r in (db.data or [])}


def seed_players(season: int, team_ext_to_abbr: dict[str, str]) -> int:
    """Upsert active-roster players for every MLB team, with handedness."""
    # 1) Gather roster entries across all teams
    roster_entries: list[dict] = []  # {person_id, name, position, team_abbr}
    for ext_id, abbr in team_ext_to_abbr.items():
        roster = mlb.get_roster(int(ext_id), roster_type="active", season=season)
        for r in roster:
            person = r.get("person", {})
            pid = person.get("id")
            if not pid:
                continue
            roster_entries.append({
                "person_id": pid,
                "name": person.get("fullName", ""),
                "position": (r.get("position", {}) or {}).get("abbreviation"),
                "team_abbr": abbr,
            })
    print(f"[players] collected {len(roster_entries)} roster entries")

    # 2) Batch-fetch handedness (batSide / pitchHand)
    hand: dict[int, dict] = {}
    all_ids = list({e["person_id"] for e in roster_entries})
    for chunk in _chunked(all_ids, 100):
        for p in mlb.get_people(chunk):
            hand[p["id"]] = {
                "bat": (p.get("batSide", {}) or {}).get("code"),
                "throw": (p.get("pitchHand", {}) or {}).get("code"),
            }

    # 3) Upsert players
    rows = [{
        "league_id": MLB_LEAGUE_ID,
        "league": "mlb",
        "ext_id": str(e["person_id"]),
        "name": e["name"],
        "team": e["team_abbr"],
        "position": e["position"],
        "is_active": True,
        "bat_hand": hand.get(e["person_id"], {}).get("bat"),
        "throw_hand": hand.get(e["person_id"], {}).get("throw"),
    } for e in roster_entries]

    for chunk in _chunked(rows, BATCH_SIZE):
        supabase.table("players").upsert(chunk, on_conflict="league_id,ext_id").execute()
    print(f"[players] upserted {len(rows)} rows")
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed MLB teams + players")
    parser.add_argument("--season", type=int, default=date.today().year)
    args = parser.parse_args()

    print("=" * 60)
    print(f"MLB Init  |  season {args.season}")
    print("=" * 60)

    team_ext_to_id, team_ext_to_abbr = seed_teams(args.season)
    n_players = seed_players(args.season, team_ext_to_abbr)

    print("=" * 60)
    print(f"Done. {len(team_ext_to_id)} teams, {n_players} players.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
