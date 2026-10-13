"""
analytics/batch/seed_nba_players.py

Create `players` rows for NBA athletes that are on a current ESPN roster but not
in our DB — rookies, signings and two-way players. NBA box-score ingest resolves
athletes through players.espn_id only and never fabricates a player, so a new
player's games are skipped until a row exists. Run once at the start of a
season and whenever a team adds someone (the daily sync runs it too; with no
new athletes it is a no-op after 30 roster calls).

New rows get ext_id = 'espn-<espn_id>'. Legacy NBA ext_ids are bare numeric
nba.com ids, so the prefix cannot collide with them (and ESPN's numeric ids
could). players.espn_id carries the real ESPN id that ingest joins on.

Duplicate safety: run map_espn_ids first (the daily sync and --map flag do),
which links existing DB players to ESPN ids by normalized name. An ESPN athlete
whose normalized name still matches a DB player with no espn_id is NOT inserted
(reported instead) so a spelling variant never becomes a second player.

CLI:
    python -m analytics.batch.seed_nba_players --dry-run
    python -m analytics.batch.seed_nba_players
"""

from __future__ import annotations

import argparse
import sys

from analytics.data.espn import client as espn
from analytics.data.nba_espn.ingest import (
    LEAGUE, SPORT, _load_all_nba_players, load_player_espn_map, load_team_maps,
    normalize_name,
)
from analytics.db.connection import BATCH_SIZE, NBA_LEAGUE_ID, supabase


def seed(dry_run: bool = False) -> int:
    team_espn_map, team_abbr_by_espn = load_team_maps()
    mapped_espn_ids = set(load_player_espn_map())
    db_players = _load_all_nba_players()

    # Normalized names of DB players that still have no ESPN link: an athlete
    # matching one of these is a mapping miss, not a new player.
    unlinked_names = {normalize_name(p["name"]) for p in db_players if not p.get("espn_id")}

    new_rows: dict[str, dict] = {}
    skipped_name_match: list[str] = []
    for espn_team_id in sorted(team_espn_map, key=lambda k: team_abbr_by_espn[k]):
        abbr = team_abbr_by_espn[espn_team_id]
        roster = espn.get_roster(SPORT, LEAGUE, espn_team_id)
        if not roster:
            print(f"  WARNING: empty ESPN roster for {abbr}; skipped.")
            continue
        for athlete in roster:
            espn_id = str(athlete.get("id") or "")
            name = athlete.get("fullName") or athlete.get("displayName")
            if not espn_id or not name or espn_id in mapped_espn_ids or espn_id in new_rows:
                continue
            if normalize_name(name) in unlinked_names:
                skipped_name_match.append(f"{name} ({abbr})")
                continue
            new_rows[espn_id] = {
                "league_id": NBA_LEAGUE_ID,
                "league": "nba",
                "ext_id": f"espn-{espn_id}",
                "espn_id": espn_id,
                "name": name,
                "team": abbr,
                "position": (athlete.get("position") or {}).get("abbreviation"),
                "is_active": True,
            }

    print(f"[seed_nba_players] {len(new_rows)} new athlete(s) to insert"
          f"{' (dry run)' if dry_run else ''}.")
    for r in new_rows.values():
        print(f"    + {r['name']} ({r['team']}, {r['position'] or '?'}) espn={r['espn_id']}")
    if skipped_name_match:
        print(f"[seed_nba_players] {len(skipped_name_match)} athlete(s) skipped: name "
              "matches an unlinked DB player — run map_espn_ids --players:")
        for s in skipped_name_match:
            print(f"    ~ {s}")

    if dry_run or not new_rows:
        return len(new_rows)

    rows = list(new_rows.values())
    for i in range(0, len(rows), BATCH_SIZE):
        supabase.table("players").upsert(
            rows[i:i + BATCH_SIZE], on_conflict="league_id,ext_id").execute()
    print(f"[seed_nba_players] inserted {len(rows)} player(s).")
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed NBA players from ESPN rosters")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()
    seed(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
