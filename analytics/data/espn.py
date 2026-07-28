"""
analytics/data/espn.py

Shared ESPN hidden-API client for NBA schedule + box score data.

nba_api (stats.nba.com) is blocked from datacenter IPs (confirmed via a
GitHub Actions workflow that hung for 120 minutes on every scheduled run),
which makes it unusable from Lambda or any other cloud runner. ESPN's
undocumented site API is not blocked — analytics/batch/injury_check.py
already depends on it in production via a live GitHub Actions cron — so
nightly.py's schedule + box-score fetches are migrated onto the same host.

Team/player identity is resolved the same way injury_check.py already does
it in production: by abbreviation (teams) and exact name match (players),
not by a numeric ext_id — ESPN's team/player ids don't correspond to
nba_api's, so there is no stable ext_id to join on.
"""

from __future__ import annotations

from typing import Optional

import requests

REQUEST_TIMEOUT = 10

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"


def _espn_get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        print(f"  WARNING: ESPN request failed ({url}): {exc}")
        return None


def fetch_scoreboard(date_str: str) -> list[dict]:
    """
    Fetch ESPN's scoreboard for date_str (YYYY-MM-DD). Returns a list of
    normalized game dicts:
        {
          "ext_id": "401584669",       # ESPN event id
          "completed": bool,
          "home": {"abbr": "LAL", "score": 118},
          "away": {"abbr": "GSW", "score": 112},
        }
    Empty list on failure or no games scheduled.
    """
    espn_date = date_str.replace("-", "")
    data = _espn_get(SCOREBOARD_URL, params={"dates": espn_date})
    if not data:
        return []

    games: list[dict] = []
    for event in data.get("events") or []:
        ext_id = str(event.get("id") or "").strip()
        if not ext_id:
            continue

        competitions = event.get("competitions") or []
        if not competitions:
            continue
        competitors = competitions[0].get("competitors") or []

        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue

        home_abbr = str((home.get("team") or {}).get("abbreviation") or "").strip().upper()
        away_abbr = str((away.get("team") or {}).get("abbreviation") or "").strip().upper()
        if not home_abbr or not away_abbr:
            continue

        status = (event.get("status") or {}).get("type") or {}

        def _score(entry: dict) -> Optional[int]:
            raw = entry.get("score")
            try:
                return int(raw) if raw is not None else None
            except (TypeError, ValueError):
                return None

        games.append({
            "ext_id": ext_id,
            "completed": bool(status.get("completed")),
            "home": {"abbr": home_abbr, "score": _score(home)},
            "away": {"abbr": away_abbr, "score": _score(away)},
        })

    return games


def fetch_summary(ext_id: str) -> Optional[dict]:
    """Fetch ESPN's game summary (box score) for an event id."""
    return _espn_get(SUMMARY_URL, params={"event": ext_id})


def _made_from_split(raw: str) -> int:
    """ESPN reports makes as 'made-attempted' (e.g. '3-7'). Returns made."""
    if not raw:
        return 0
    made = str(raw).split("-")[0].strip()
    try:
        return int(made)
    except ValueError:
        return 0


def _stat_int(raw: str) -> int:
    if raw is None or raw == "":
        return 0
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return 0


def parse_boxscore(summary: dict) -> list[dict]:
    """
    Parse an ESPN summary payload's boxscore.players[] into per-player rows:
        {
          "name": "LeBron James",
          "team_abbr": "LAL",
          "pts": 27, "reb": 8, "ast": 9, "fg3m": 3, "fouls": 2, "mins": 34,
          "pos": "SF",
        }

    Resolves each stat by label name (not fixed column position) so this
    survives ESPN reordering the stat columns, which it has done before.
    """
    boxscore = summary.get("boxscore") or {}
    team_blocks = boxscore.get("players") or []

    rows: list[dict] = []
    for block in team_blocks:
        team_abbr = str((block.get("team") or {}).get("abbreviation") or "").strip().upper()
        for group in block.get("statistics") or []:
            labels = [str(lbl).strip().upper() for lbl in (group.get("labels") or group.get("names") or [])]
            label_idx = {lbl: i for i, lbl in enumerate(labels)}

            def _get(entry_stats: list, *names: str) -> str:
                for name in names:
                    i = label_idx.get(name)
                    if i is not None and i < len(entry_stats):
                        return entry_stats[i]
                return ""

            for athlete_entry in group.get("athletes") or []:
                if athlete_entry.get("didNotPlay"):
                    continue
                athlete = athlete_entry.get("athlete") or {}
                name = str(athlete.get("displayName") or "").strip()
                if not name:
                    continue
                stats = athlete_entry.get("stats") or []
                position = athlete.get("position") or {}
                pos_abbr = position.get("abbreviation") if isinstance(position, dict) else ""

                rows.append({
                    "name": name,
                    "team_abbr": team_abbr,
                    "pts": _stat_int(_get(stats, "PTS")),
                    "reb": _stat_int(_get(stats, "REB")),
                    "ast": _stat_int(_get(stats, "AST")),
                    "fg3m": _made_from_split(_get(stats, "3PT")),
                    "fouls": _stat_int(_get(stats, "PF")),
                    "mins": _stat_int(_get(stats, "MIN")),
                    "pos": str(pos_abbr or "").strip(),
                })

    return rows
