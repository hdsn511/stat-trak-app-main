"""
analytics/batch/refresh_positions.py

Refreshes player positions in the players table from ESPN's current team
rosters (Phase 8 hybrid — replaces nba_api's CommonTeamRoster). Iterates all
30 NBA teams and updates each mapped player's position to the current value.

Players are resolved through players.espn_id ONLY; roster athletes without a
mapping are reported loudly, never name-guessed (run
analytics/batch/map_espn_ids to extend the mapping).

Usage:
    python -m analytics.batch.refresh_positions
    python -m analytics.batch.refresh_positions --dry-run
"""
from __future__ import annotations

import argparse
import sys

from analytics.data.espn import client as espn
from analytics.data.nba_espn.ingest import (
    LEAGUE,
    SPORT,
    load_player_espn_map,
    load_team_maps,
)
from analytics.db.connection import supabase


def refresh(dry_run: bool = False) -> None:
    """Fetch every ESPN roster and queue position changes for mapped players."""
    team_espn_map, team_abbr_by_espn = load_team_maps()
    player_espn_map = load_player_espn_map()

    print(f"Refreshing positions for {len(team_espn_map)} team(s) "
          f"(ESPN current rosters)")
    if dry_run:
        print("(dry-run: no writes)")

    # Current DB state for change detection: db_id -> (name, position)
    db_players: dict[int, dict] = {}
    page = 0
    while True:
        batch = (supabase.table("players").select("id,name,position")
                 .eq("league", "nba")
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        db_players.update({r["id"]: r for r in batch})
        if len(batch) < 1000:
            break
        page += 1

    updates: list[tuple[int, str, str, str]] = []  # (db_id, name, old, new)
    unmapped_total = 0

    for espn_team_id in sorted(team_espn_map, key=lambda k: team_abbr_by_espn[k]):
        abbr = team_abbr_by_espn[espn_team_id]
        roster = espn.get_roster(SPORT, LEAGUE, espn_team_id)
        if not roster:
            print(f"  WARNING: empty ESPN roster for {abbr}. Skipping.")
            continue

        changed = 0
        unmapped = 0
        for athlete in roster:
            espn_id = str(athlete.get("id", ""))
            pos = ((athlete.get("position") or {}).get("abbreviation") or "").strip()
            if not espn_id or not pos:
                continue
            p_db_id = player_espn_map.get(espn_id)
            if not p_db_id:
                unmapped += 1
                continue
            player = db_players.get(p_db_id)
            if not player:
                continue
            old_pos = player.get("position") or ""
            if old_pos == pos:
                continue
            updates.append((p_db_id, player["name"], old_pos, pos))
            changed += 1

        unmapped_total += unmapped
        note = f", {unmapped} unmapped" if unmapped else ""
        print(f"  {abbr}: {len(roster)} players, {changed} position "
              f"change(s) queued{note}")

    if unmapped_total:
        print(f"\nWARNING: {unmapped_total} roster athlete(s) have no espn_id "
              f"mapping — run analytics/batch/map_espn_ids for the report.")

    print(f"\nTotal position updates: {len(updates)}")
    if not updates:
        print("All positions already current.")
        return

    if dry_run:
        for db_id, name, old, new in updates[:20]:
            print(f"  {name}: {old!r} -> {new!r}")
        if len(updates) > 20:
            print(f"  ... and {len(updates) - 20} more")
        return

    for db_id, name, old, new in updates:
        supabase.table("players").update({"position": new}).eq("id", db_id).execute()

    print(f"Done — updated {len(updates)} player position(s).")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Refresh NBA player positions from ESPN rosters")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing")
    args = parser.parse_args()
    refresh(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
