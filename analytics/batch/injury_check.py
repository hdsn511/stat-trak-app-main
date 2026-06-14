"""
analytics/batch/injury_check.py

Injury validation for StatTrak. League-agnostic: pass --league nba|mlb.

Steps:
  1. Load today's games from local DB — this is the source of truth for which
     teams are playing.
  2. Fetch injury reports from the league's ESPN injuries endpoint.
  3. Identify "out" players (league-specific rule) whose team plays today.
  4. Upsert player_availability rows for affected players.
  5. Delete pick_results rows for those players today.

CLI:
    python -m analytics.batch.injury_check                      # NBA (default)
    python -m analytics.batch.injury_check --league mlb --date 2026-06-14
    python -m analytics.batch.injury_check --league mlb --verify
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from typing import Callable, Optional

import requests

from analytics.db.connection import MLB_LEAGUE_ID, NBA_LEAGUE_ID, supabase

REQUEST_TIMEOUT = 10


# ── Per-league config ────────────────────────────────────────────────────────────
# ESPN normalises injury status differently per sport:
#   NBA → "Out" / "Doubtful" / "Day-To-Day" / "Questionable"
#   MLB → "10-Day-IL" / "15-Day-IL" / "60-Day-IL" / "Day-To-Day"
# We only remove players who are definitively not playing. For NBA that's
# Out/Doubtful; for MLB that's any IL designation ("Day-To-Day" players usually
# still play, mirroring how we keep NBA "Questionable").

def _nba_is_out(status: str) -> bool:
    return status in {"Out", "Doubtful"}


def _mlb_is_out(status: str) -> bool:
    return "IL" in status


class LeagueConfig:
    def __init__(self, slug: str, league_id: int, league_tag: str,
                 espn_url: str, is_out: Callable[[str], bool]):
        self.slug = slug
        self.league_id = league_id
        self.league_tag = league_tag
        self.espn_url = espn_url
        self.is_out = is_out


LEAGUES: dict[str, LeagueConfig] = {
    "nba": LeagueConfig(
        "nba", NBA_LEAGUE_ID, "nba",
        "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
        _nba_is_out,
    ),
    "mlb": LeagueConfig(
        "mlb", MLB_LEAGUE_ID, "mlb",
        "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries",
        _mlb_is_out,
    ),
}


def _espn_get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        print(f"  WARNING: ESPN request failed ({url}): {exc}")
        return None


def fetch_injuries(espn_url: str) -> list[dict]:
    """
    Fetch injury data from an ESPN injuries endpoint.

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
    data = _espn_get(espn_url)
    if not data:
        return []
    return data.get("injuries") or []


def run_injury_check(target_date: date, league: str = "nba") -> None:
    cfg = LEAGUES[league]
    date_str = target_date.strftime("%Y-%m-%d")
    print(f"[injury_check] {cfg.slug.upper()} {date_str}")

    # Step 1: Load today's games — source of truth for which teams are playing
    game_rows = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id")
        .eq("game_date", date_str)
        .eq("league_id", cfg.league_id)
        .execute()
    )
    today_games = game_rows.data or []
    if not today_games:
        print("  No games scheduled today. Skipping.")
        return

    team_rows = (
        supabase.table("teams")
        .select("id,abbreviation")
        .eq("league_id", cfg.league_id)
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
    injury_entries = fetch_injuries(cfg.espn_url)
    if not injury_entries:
        print("  No injury data available. Skipping.")
        return

    # Step 3: Collect "out" player names from all teams in today's games
    player_rows = (
        supabase.table("players")
        .select("id,name,team")
        .eq("league", cfg.league_tag)
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
            if not cfg.is_out(status):
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
        print("  No out players on today's teams.")
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

    # Step 5: Remove pick_results for out players today
    picks_res = (
        supabase.table("pick_results")
        .select("id,entity_id,stat")
        .eq("game_date", date_str)
        .eq("league_id", cfg.league_id)
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
    parser.add_argument("--league", type=str, default="nba", choices=sorted(LEAGUES),
                        help="League to check (default: nba)")
    parser.add_argument("--date", type=str, default=None, help="YYYY-MM-DD (default: today)")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Print raw ESPN injury response and exit",
    )
    args = parser.parse_args()

    cfg = LEAGUES[args.league]

    if args.verify:
        import json
        data = _espn_get(cfg.espn_url)
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

    run_injury_check(target_date, league=args.league)
    return 0


if __name__ == "__main__":
    sys.exit(main())
