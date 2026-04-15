"""
analytics/batch/injury_check.py

Hourly injury validation for StatTrak.

Steps:
  1. Fetch today's game states from ESPN scoreboard.
     Skip if no pre-game games remain (all in progress or finished).
  2. Fetch injury reports from ESPN injuries endpoint.
  3. Identify Out/Doubtful players on pre-game teams.
  4. Upsert player_availability rows for affected players.
  5. Delete pick_results rows for Out players today.

NOTE: The ESPN injuries endpoint structure should be verified against a live
response before deploying. Run `python -m analytics.batch.injury_check --verify`
to print the raw ESPN response for inspection.

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
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"

# Statuses treated as "player is not playing today" — pick is invalid
OUT_STATUSES = {"Out", "Doubtful"}

REQUEST_TIMEOUT = 10  # seconds


# ── ESPN helpers ───────────────────────────────────────────────────────────────

def _espn_get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET request to ESPN API. Returns parsed JSON or None on failure."""
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        print(f"  WARNING: ESPN request failed ({url}): {exc}")
        return None


def fetch_game_states(target_date: date) -> tuple[dict[str, str], dict[str, str]]:
    """
    Fetch game states from ESPN scoreboard for target_date.

    Returns two dicts:
      - {espn_team_id_str: state}  — keyed by ESPN team ID string
      - {team_abbreviation_upper: state}  — keyed by team abbreviation (e.g. "LAL")
    where state is one of: "pre", "in", "post".
    Teams not playing today are absent from the dicts.

    NOTE: The ESPN injuries endpoint identifies teams by numeric ID (matching
    scoreboard competitor team.id), not by abbreviation. We return both mappings
    so callers can use whichever is available.
    """
    date_str = target_date.strftime("%Y%m%d")
    data = _espn_get(ESPN_SCOREBOARD_URL, params={"dates": date_str})
    if not data:
        return {}, {}

    id_states: dict[str, str] = {}
    abbr_states: dict[str, str] = {}
    for event in data.get("events", []):
        state = event.get("status", {}).get("type", {}).get("state", "pre")
        comp = (event.get("competitions") or [{}])[0]
        for competitor in comp.get("competitors", []):
            team = competitor.get("team") or {}
            team_id = str(team.get("id", ""))
            abbr = team.get("abbreviation", "").upper()
            if team_id:
                id_states[team_id] = state
            if abbr:
                abbr_states[abbr] = state
    return id_states, abbr_states


def fetch_injuries() -> list[dict]:
    """
    Fetch injury data from ESPN injuries endpoint.

    Returns list of team-level injury dicts. Actual ESPN response structure:
    [
      {
        "id": "13",               # ESPN team ID (str after parsing int)
        "displayName": "Los Angeles Lakers",
        "injuries": [
          {
            "athlete": {"displayName": "LeBron James", ...},
            "status": "Out",      # e.g. "Out", "Doubtful", "Day-To-Day", "Questionable"
            ...
          },
          ...
        ]
      },
      ...
    ]
    NOTE: There is no "team" sub-object. Team is identified by top-level "id".
    Returns empty list on failure.
    """
    data = _espn_get(ESPN_INJURIES_URL)
    if not data:
        return []
    # ESPN nests team injury entries under top-level "injuries" key
    injuries = data.get("injuries") or []
    return injuries


# ── Main logic ─────────────────────────────────────────────────────────────────

def run_injury_check(target_date: date) -> None:
    date_str = target_date.strftime("%Y-%m-%d")
    print(f"[injury_check] {date_str}")

    # Step 1: Get game states
    # Returns two maps: ESPN team_id -> state, and abbreviation -> state
    espn_id_states, abbr_states = fetch_game_states(target_date)
    pre_game_espn_ids = {tid for tid, state in espn_id_states.items() if state == "pre"}
    pre_game_abbrs = {abbr for abbr, state in abbr_states.items() if state == "pre"}

    if not pre_game_espn_ids:
        print("  All games in progress or complete — nothing to validate.")
        return

    print(f"  Pre-game teams (abbr): {sorted(pre_game_abbrs)}")

    # Step 2: Fetch injuries
    injury_entries = fetch_injuries()
    if not injury_entries:
        print("  No injury data available. Skipping.")
        return

    # Step 3: Build name_lower -> status for Out/Doubtful players on pre-game teams.
    # ESPN injuries endpoint: each team entry has top-level "id" (ESPN team ID string)
    # and "displayName". No nested "team" sub-object.
    out_players: dict[str, str] = {}
    for team_entry in injury_entries:
        espn_team_id = str(team_entry.get("id", ""))
        if espn_team_id not in pre_game_espn_ids:
            continue
        for inj in team_entry.get("injuries") or []:
            status = inj.get("status", "")
            if status in OUT_STATUSES:
                name = (inj.get("athlete") or {}).get("displayName", "")
                if name:
                    out_players[name.lower()] = status
                    print(f"    {name} — {status}")

    if not out_players:
        print("  No Out/Doubtful players on pre-game teams.")
        return

    # Step 4: Resolve player IDs from DB
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
    for name_lower in out_players:
        player = name_to_player.get(name_lower)
        if player:
            affected.append(player)
        else:
            print(f"  WARNING: '{name_lower}' not found in DB — skipping")

    if not affected:
        print("  No matching DB records for affected players.")
        return

    affected_ids = [p["id"] for p in affected]

    # Step 5: Resolve game IDs for today
    game_rows = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id")
        .eq("game_date", date_str)
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    team_to_game: dict[int, int] = {}
    for g in (game_rows.data or []):
        team_to_game[g["home_team_id"]] = g["id"]
        team_to_game[g["away_team_id"]] = g["id"]

    # Build team abbreviation -> team DB id map
    team_abbr_rows = (
        supabase.table("teams")
        .select("id,abbreviation")
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    abbr_to_team_id: dict[str, int] = {
        r["abbreviation"].upper(): r["id"] for r in (team_abbr_rows.data or [])
    }

    # Step 6: Upsert player_availability
    avail_rows: list[dict] = []
    for player in affected:
        team_abbr = (player.get("team") or "").upper()
        team_id = abbr_to_team_id.get(team_abbr)
        if not team_id:
            continue
        game_id = team_to_game.get(team_id)
        if not game_id:
            continue
        avail_rows.append({
            "player_id": player["id"],
            "game_id": game_id,
            "status": "out",
        })

    if avail_rows:
        supabase.table("player_availability").upsert(
            avail_rows, on_conflict="player_id,game_id"
        ).execute()
        print(f"  Updated player_availability: {len(avail_rows)} row(s).")

    # Step 7: Remove pick_results for Out players today
    picks_res = (
        supabase.table("pick_results")
        .select("id,entity_id,stat")
        .eq("game_date", date_str)
        .in_("entity_id", affected_ids)
        .execute()
    )
    picks_to_remove = picks_res.data or []

    removed = 0
    for pick in picks_to_remove:
        supabase.table("pick_results").delete().eq("id", pick["id"]).execute()
        print(f"  Removed pick id={pick['id']} player={pick['entity_id']} stat={pick['stat']}")
        removed += 1

    print(f"  Done. {removed} pick(s) removed.")


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="StatTrak injury validation")
    parser.add_argument("--date", type=str, default=None, help="YYYY-MM-DD (default: today)")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Print raw ESPN responses and exit (for debugging response structure)",
    )
    args = parser.parse_args()

    if args.verify:
        import json
        print("=== ESPN Injuries ===")
        data = _espn_get(ESPN_INJURIES_URL)
        print(json.dumps(data, indent=2)[:3000])
        print("\n=== ESPN Scoreboard (today) ===")
        today_str = date.today().strftime("%Y%m%d")
        data2 = _espn_get(ESPN_SCOREBOARD_URL, params={"dates": today_str})
        print(json.dumps(data2, indent=2)[:3000])
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
