"""
analytics/batch/refresh_positions.py

Refreshes player positions in the players table using CommonTeamRoster
from nba_api. Iterates all 30 NBA teams and updates each player's
position to the official current value.

Usage:
    python -m analytics.batch.refresh_positions
    python -m analytics.batch.refresh_positions --dry-run
"""
from __future__ import annotations

import argparse
import sys
import time

from analytics.db.connection import NBA_LEAGUE_ID, supabase
from analytics.data.enrich_games import api_call_with_retry

CURRENT_SEASON = "2025-26"


def _get_all_teams() -> list[dict]:
    rows = (
        supabase.table("teams")
        .select("id, ext_id, abbreviation")
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    return rows.data or []


def refresh(dry_run: bool = False) -> None:
    try:
        from nba_api.stats.endpoints import CommonTeamRoster
    except ImportError as exc:
        print(f"ERROR: nba_api not installed: {exc}")
        sys.exit(1)

    teams = _get_all_teams()
    print(f"Refreshing positions for {len(teams)} team(s) — season {CURRENT_SEASON}")
    if dry_run:
        print("(dry-run: no writes)")

    # Load all active NBA players: ext_id -> db_id
    player_rows = (
        supabase.table("players")
        .select("id, ext_id, name, position")
        .eq("league", "nba")
        .eq("is_active", True)
        .execute()
    )
    player_by_ext: dict[str, dict] = {
        r["ext_id"]: r for r in (player_rows.data or []) if r.get("ext_id")
    }

    updates: list[tuple[int, str, str, str]] = []  # (db_id, name, old_pos, new_pos)

    for team in teams:
        team_ext_id = team["ext_id"]
        team_abbr = team["abbreviation"]

        def _roster(tid=team_ext_id):
            return CommonTeamRoster(team_id=tid, season=CURRENT_SEASON)

        result = api_call_with_retry(_roster, f"CommonTeamRoster {team_abbr}")
        if result is None:
            print(f"  WARNING: no roster data for {team_abbr}. Skipping.")
            continue

        try:
            df = result.get_data_frames()[0]
        except Exception as exc:
            print(f"  WARNING: parse error for {team_abbr}: {exc}")
            continue

        changed = 0
        for _, row in df.iterrows():
            raw_id = row.get("PLAYER_ID")
            pos = str(row.get("POSITION") or "").strip()
            if not raw_id or not pos:
                continue
            p_ext_id = str(int(float(raw_id)))
            player = player_by_ext.get(p_ext_id)
            if not player:
                continue
            old_pos = player.get("position") or ""
            if old_pos == pos:
                continue
            updates.append((player["id"], player["name"], old_pos, pos))
            changed += 1

        print(f"  {team_abbr}: {len(df)} players, {changed} position change(s) queued")
        time.sleep(1.0)

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
    parser = argparse.ArgumentParser(description="Refresh NBA player positions from CommonTeamRoster")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing")
    args = parser.parse_args()
    refresh(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
