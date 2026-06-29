"""
analytics/data/mlb/client.py

Thin client for the official MLB Stats API (https://statsapi.mlb.com).

Free, keyless, and — unlike stats.nba.com — NOT IP-blocked, so this works from
GitHub-hosted runners with no proxy. We therefore skip the heavy adaptive-cooldown
retry ladder the NBA path needs (see analytics/data/enrich_games.py) and use a
simple bounded retry.

Endpoints wrapped:
  - schedule(date)            -> games for a date (+ probable pitchers, venue)
  - boxscore(game_pk)         -> per-player batting + pitching lines, batting order
  - teams()                   -> 30 MLB teams
  - roster(team_id)           -> active roster person ids + positions
  - people(person_ids)        -> bio incl. batSide / pitchHand handedness
"""

from __future__ import annotations

import time
from typing import Any, Optional

import requests

BASE_URL = "https://statsapi.mlb.com/api/v1"
SPORT_ID = 1  # MLB

# Bounded retry — no cooldown ladder needed (API is not IP-blocked).
MAX_RETRIES = 4
BACKOFF_BASE_SECONDS = 1.5
REQUEST_TIMEOUT = 20

# gameType code -> our games.game_type text
GAME_TYPE_MAP = {
    "R": "regular",
    "F": "postseason",  # wild card
    "D": "postseason",  # division series
    "L": "postseason",  # league championship series
    "W": "postseason",  # world series
    "P": "postseason",  # playoff (generic)
    "S": "spring",
    "A": "allstar",
    "E": "exhibition",
}


def _get(path: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET {BASE_URL}{path} with bounded exponential backoff. Returns parsed
    JSON dict, or None after MAX_RETRIES failures."""
    url = f"{BASE_URL}{path}"
    last_exc: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(url, params=params or {}, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:  # network or JSON
            last_exc = exc
            wait = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            print(f"  WARNING [MLB GET {path}] attempt {attempt}/{MAX_RETRIES} "
                  f"failed ({type(exc).__name__}). Waiting {wait:.1f}s ...")
            time.sleep(wait)
    print(f"  ERROR [MLB GET {path}] exhausted retries: {last_exc}")
    return None


# ── Public wrappers ────────────────────────────────────────────────────────────

def get_teams(season: Optional[int] = None) -> list[dict]:
    """All 30 MLB teams (id, name, abbreviation, locationName, venue)."""
    params = {"sportId": SPORT_ID}
    if season:
        params["season"] = season
    data = _get("/teams", params) or {}
    return [t for t in data.get("teams", []) if t.get("sport", {}).get("id") == SPORT_ID]


def get_roster(team_id: int, roster_type: str = "active",
               season: Optional[int] = None) -> list[dict]:
    """Roster entries for a team: each has person{id,fullName}, position, status."""
    params = {"rosterType": roster_type}
    if season:
        params["season"] = season
    data = _get(f"/teams/{team_id}/roster", params) or {}
    return data.get("roster", [])


def get_people(person_ids: list[int]) -> list[dict]:
    """Bio for a batch of person ids — includes batSide.code / pitchHand.code."""
    if not person_ids:
        return []
    ids = ",".join(str(p) for p in person_ids)
    data = _get("/people", {"personIds": ids}) or {}
    return data.get("people", [])


def get_schedule(date_str: str, hydrate: str = "probablePitcher") -> list[dict]:
    """Games on a date (YYYY-MM-DD). Each game dict carries gamePk, gameType,
    season, status, teams.{away,home}.{team,score,probablePitcher}, venue.
    The official game_date is the enclosing dates[].date (ET-based)."""
    params = {"sportId": SPORT_ID, "date": date_str}
    if hydrate:
        params["hydrate"] = hydrate
    data = _get("/schedule", params) or {}
    dates = data.get("dates", [])
    out: list[dict] = []
    for d in dates:
        for g in d.get("games", []):
            g["_official_date"] = d.get("date", date_str)
            out.append(g)
    return out


def get_boxscore(game_pk: int) -> Optional[dict]:
    """Full boxscore. Returns the `teams` dict with away/home, each carrying
    `players` (per-player stats) and `battingOrder` (ordered person ids)."""
    data = _get(f"/game/{game_pk}/boxscore")
    if not data:
        return None
    return data.get("teams")


def batting_order_slot(raw: Optional[str]) -> Optional[int]:
    """MLB boxscore batting order is a 3-digit string ('100'=lead-off, '700'=7th,
    '701'=a sub for the 7 slot). The hundreds digit is the lineup slot 1-9."""
    if not raw:
        return None
    try:
        return int(raw) // 100
    except (ValueError, TypeError):
        return None
