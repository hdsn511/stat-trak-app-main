"""
analytics/batch/injury_check.py

Injury validation for StatTrak.

Steps:
  1. Load today's games from local DB — this is the source of truth for which
     teams are playing.
  2. Fetch injury reports from ESPN injuries endpoint.
  3. Identify Out/Doubtful players whose team is in today's games.
  4. Upsert player_availability rows for affected players.
  5. Delete pick_results rows for Out/Doubtful players today.

CLI:
    python -m analytics.batch.injury_check
    python -m analytics.batch.injury_check --date 2026-04-14
    python -m analytics.batch.injury_check --verify
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from typing import Optional

import requests

from analytics.db.connection import NBA_LEAGUE_ID, supabase

ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"

OUT_STATUSES = {"Out", "Doubtful"}

REQUEST_TIMEOUT = 10


def _espn_get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        print(f"  WARNING: ESPN request failed ({url}): {exc}")
        return None


def fetch_injuries() -> list[dict]:
    """
    Fetch injury data from ESPN injuries endpoint.

    Returns list of team-level dicts:
    [
      {
        "id": "13",
        "displayName": "Los Angeles Lakers",
        "injuries": [
          {"athlete": {"displayName": "LeBron James"}, "status": "Out"},
          ...
        ]
      },
      ...
    ]
    """
    data = _espn_get(ESPN_INJURIES_URL)
    if not data:
        return []
    return data.get("injuries") or []


def run_injury_check(target_date: date) -> None:
    date_str = target_date.strftime("%Y-%m-%d")
    print(f"[injury_check] {date_str}")

    # Step 1: Load today's games — source of truth for which teams are playing
    game_rows = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id")
        .eq("game_date", date_str)
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    today_games = game_rows.data or []
    if not today_games:
        print("  No games scheduled today. Skipping.")
        return

    team_rows = (
        supabase.table("teams")
        .select("id,abbreviation")
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    db_id_to_abbr: dict[int, str] = {r["id"]: r["abbreviation"] for r in (team_rows.data or [])}
    abbr_to_team_id: dict[str, int] = {v: k for k, v in db_id_to_abbr.items()}

    playing_team_ids: set[int] = set()
    team_to_game: dict[int, int] = {}
    for g in today_games:
        playing_team_ids.add(g["home_team_id"])
        playing_team_ids.add(g["away_team_id"])
        team_to_game[g["home_team_id"]] = g["id"]
        team_to_game[g["away_team_id"]] = g["id"]

    playing_abbrs = {db_id_to_abbr[tid] for tid in playing_team_ids if tid in db_id_to_abbr}
    print(f"  Teams playing today: {sorted(playing_abbrs)}")

    # Step 2: Fetch ESPN injuries
    injury_entries = fetch_injuries()
    if not injury_entries:
        print("  No injury data available. Skipping.")
        return

    # Step 3: Collect Out/Doubtful player names from all teams in today's games
    player_rows = (
        supabase.table("players")
        .select("id,name,team")
        .eq("league", "nba")
        .eq("is_active", True)
        .execute()
    )
    name_to_player: dict[str, dict] = {
        r["name"].lower(): r for r in (player_rows.data or [])
    }

    affected: list[dict] = []
    for team_entry in injury_entries:
        for inj in team_entry.get("injuries") or []:
            status = inj.get("status", "")
            if status not in OUT_STATUSES:
                continue
            name = (inj.get("athlete") or {}).get("displayName", "")
            if not name:
                continue
            player = name_to_player.get(name.lower())
            if not player:
                continue
            team_abbr = (player.get("team") or "").upper()
            if team_abbr not in playing_abbrs:
                continue
            print(f"    {player['name']} ({team_abbr}) — {status}")
            affected.append(player)

    if not affected:
        print("  No Out/Doubtful players on today's teams.")
        return

    affected_ids = [p["id"] for p in affected]

    # Step 4: Upsert player_availability
    avail_rows: list[dict] = []
    for player in affected:
        team_id = abbr_to_team_id.get((player.get("team") or "").upper())
        if not team_id:
            continue
        game_id = team_to_game.get(team_id)
        if not game_id:
            continue
        avail_rows.append({"player_id": player["id"], "game_id": game_id, "status": "out"})

    if avail_rows:
        supabase.table("player_availability").upsert(
            avail_rows, on_conflict="player_id,game_id"
        ).execute()
        print(f"  Updated player_availability: {len(avail_rows)} row(s).")

    # Step 5: Remove pick_results for Out/Doubtful players today
    picks_res = (
        supabase.table("pick_results")
        .select("id,entity_id,stat")
        .eq("game_date", date_str)
        .in_("entity_id", affected_ids)
        .execute()
    )
    removed = 0
    for pick in (picks_res.data or []):
        supabase.table("pick_results").delete().eq("id", pick["id"]).execute()
        print(f"  Removed pick id={pick['id']} player={pick['entity_id']} stat={pick['stat']}")
        removed += 1

    print(f"  Done. {removed} pick(s) removed.")


def main() -> int:
    parser = argparse.ArgumentParser(description="StatTrak injury validation")
    parser.add_argument("--date", type=str, default=None, help="YYYY-MM-DD (default: today)")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Print raw ESPN injury response and exit",
    )
    args = parser.parse_args()

    if args.verify:
        import json
        data = _espn_get(ESPN_INJURIES_URL)
        print(json.dumps(data, indent=2)[:5000])
        return 0

    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(f"ERROR: invalid date '{args.date}'. Use YYYY-MM-DD.")
            return 1
    else:
        target_date = date.today()

    run_injury_check(target_date)
    return 0


if __name__ == "__main__":
    sys.exit(main())
