"""
analytics/data/espn/client.py

Thin multi-sport client for ESPN's hidden site API
(https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/...).

Free, keyless, and — like statsapi.mlb.com — NOT IP-blocked (validated live
2026-07-28, see docs/superpowers/specs/2026-07-28-espn-api-research-findings.md),
so this mirrors the MLB client's simple bounded retry — no adaptive-cooldown
ladder needed.

One client serves every ESPN-backed league, parameterized by (sport, league):
    ('football',   'nfl')
    ('hockey',     'nhl')
    ('basketball', 'nba')   # consumed by the Phase 8 NBA migration

Endpoints wrapped:
  - get_scoreboard(sport, league, yyyymmdd) -> events for a date (teams, scores, status)
  - get_summary(sport, league, event_id)    -> boxscore + injuries + odds + leaders
  - get_teams(sport, league)                -> all league teams
  - get_roster(sport, league, team_id)      -> roster grouped by position group
  - get_standings(sport, league)            -> conference standings (apis/v2 variant)
  - get_injuries(sport, league)             -> league-wide current injury report

NOTE: standings does NOT live under apis/site/v2 (that path only returns a
`fullViewLink` stub) — the working resource is apis/v2/sports/{sport}/{league}/standings.
"""

from __future__ import annotations

import time
from typing import Any, Optional

import requests

SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports"
V2_BASE = "https://site.api.espn.com/apis/v2/sports"
# Per-athlete lookups live on a different host and API version entirely.
COMMON_BASE = "https://site.web.api.espn.com/apis/common/v3/sports"

# league code -> (sport, league) path segments for this API.
SPORTS: dict[str, tuple[str, str]] = {
    "nfl": ("football", "nfl"),
    "nhl": ("hockey", "nhl"),
    "nba": ("basketball", "nba"),
}

# Bounded retry — no cooldown ladder needed (API is not IP-blocked).
MAX_RETRIES = 4
BACKOFF_BASE_SECONDS = 1.5
REQUEST_TIMEOUT = 20


def _get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET url with bounded exponential backoff. Returns parsed JSON dict,
    or None after MAX_RETRIES failures."""
    last_exc: Optional[Exception] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(url, params=params or {}, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:  # network or JSON
            last_exc = exc
            wait = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            print(f"  WARNING [ESPN GET {url}] attempt {attempt}/{MAX_RETRIES} "
                  f"failed ({type(exc).__name__}). Waiting {wait:.1f}s ...")
            time.sleep(wait)
    print(f"  ERROR [ESPN GET {url}] exhausted retries: {last_exc}")
    return None


# ── Public wrappers ────────────────────────────────────────────────────────────

def get_scoreboard(sport: str, league: str, date_yyyymmdd: str) -> list[dict]:
    """Events for a date (YYYYMMDD, ET-based). Each event carries id, date
    (UTC ISO), season{year,type}, competitions[0].competitors (team, homeAway,
    score) and competitions[0].status.type (name, completed)."""
    data = _get(f"{SITE_BASE}/{sport}/{league}/scoreboard",
                {"dates": date_yyyymmdd}) or {}
    return data.get("events", [])


def get_summary(sport: str, league: str, event_id: str) -> Optional[dict]:
    """Full game summary: boxscore (per-player stat groups), header, injuries,
    leaders, odds, standings. Returns None if the fetch exhausted retries."""
    return _get(f"{SITE_BASE}/{sport}/{league}/summary", {"event": str(event_id)})


def get_teams(sport: str, league: str) -> list[dict]:
    """All league teams. Each has id, abbreviation, displayName, name, location."""
    data = _get(f"{SITE_BASE}/{sport}/{league}/teams") or {}
    try:
        entries = data["sports"][0]["leagues"][0]["teams"]
    except (KeyError, IndexError):
        print(f"  ERROR [ESPN teams {league}] unexpected payload shape; no teams parsed.")
        return []
    return [e.get("team", {}) for e in entries if e.get("team")]


def get_roster(sport: str, league: str, team_id: str) -> list[dict]:
    """Flat roster for a team. ESPN groups athletes by position group
    ('offense'/'defense'/... for NFL, 'Centers'/'Goalies'/... for NHL);
    this flattens the groups. Each athlete has id, fullName, jersey, position."""
    data = _get(f"{SITE_BASE}/{sport}/{league}/teams/{team_id}/roster") or {}
    out: list[dict] = []
    for group in data.get("athletes", []):
        if isinstance(group, dict) and "items" in group:
            out.extend(group.get("items", []))
        elif isinstance(group, dict):  # already-flat athlete entry
            out.append(group)
    return out


def get_standings(sport: str, league: str, level: Optional[int] = None) -> list[dict]:
    """Conference standings: children[] (one per conference), each with
    standings.entries[] of {team, stats[]}. Uses the apis/v2 base — the
    site/v2 path only returns a fullViewLink stub.

    level=3 nests a second children[] layer of divisions under each
    conference (AFC East / Atlantic Division / ...). Without it the
    conference entries are flat and divisions are unavailable.
    """
    params = {"level": level} if level is not None else None
    data = _get(f"{V2_BASE}/{sport}/{league}/standings", params) or {}
    return data.get("children", [])


def get_athlete(sport: str, league: str, athlete_id: str) -> Optional[dict]:
    """One athlete's profile: displayName, position, team, jersey. Resolves
    players who are no longer on any roster (retired, released, free agent),
    which the team-roster endpoints cannot. Returns None on failure."""
    data = _get(f"{COMMON_BASE}/{sport}/{league}/athletes/{athlete_id}") or {}
    return data.get("athlete") or None


def get_injuries(sport: str, league: str) -> list[dict]:
    """League-wide current injury report, one entry per team, each with
    injuries[] of {athlete, status, date, details}."""
    data = _get(f"{SITE_BASE}/{sport}/{league}/injuries") or {}
    return data.get("injuries", [])


# ── Smoke test ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # One scoreboard + one summary per league, printing boxscore field coverage.
    SMOKE_DATES = {"nfl": "20251228", "nhl": "20260115", "nba": "20260115"}
    for code, (sport, league) in SPORTS.items():
        date = SMOKE_DATES[code]
        events = get_scoreboard(sport, league, date)
        finals = [e for e in events
                  if e.get("competitions", [{}])[0].get("status", {})
                      .get("type", {}).get("completed")]
        print(f"[{code}] scoreboard {date}: {len(events)} events "
              f"({len(finals)} final)")
        if not finals:
            print(f"  WARNING [{code}] no final events on {date}; skipping summary.")
            continue
        ev = finals[0]
        summary = get_summary(sport, league, ev["id"]) or {}
        box_teams = (summary.get("boxscore", {}) or {}).get("players", [])
        print(f"  summary {ev['id']}: top-level keys = {sorted(summary.keys())[:8]} ...")
        for tp in box_teams:
            abbr = tp.get("team", {}).get("abbreviation")
            groups = {g.get("name"): len(g.get("athletes", []))
                      for g in tp.get("statistics", [])}
            print(f"    {abbr}: stat groups = {groups}")
        n_teams = len(get_teams(sport, league))
        n_standings = len(get_standings(sport, league))
        n_injury_teams = len(get_injuries(sport, league))
        print(f"  teams={n_teams}  standings children={n_standings}  "
              f"injury teams={n_injury_teams}")
