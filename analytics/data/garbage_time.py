"""
analytics/data/garbage_time.py

Garbage-time detection from ESPN play-by-play (NFL drives, NBA plays).

A play is garbage time when, in the 4th quarter (OT excluded), the team that
ultimately WINS the game leads by >= `lead` points going into the play. Keying
on the eventual winner means a blown lead is never garbage time, and a trailing
team that makes a late run is still playing meaningful football/basketball.
NBA additionally requires a final margin >= 15 so a 20-point lead that shrank
to a one-possession game isn't flagged.

Pure functions only — no DB access. analytics/batch/garbage_time.py persists.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Optional

RULES = {
    "nfl": {"lead": 17, "min_final_margin": 0},
    "nba": {"lead": 20, "min_final_margin": 15},
}

_YARDS_RE = re.compile(r"\bfor (no gain|-?\d+ yards?)", re.I)
_PASS_RE = re.compile(r"\bpass\b", re.I)
_PLAY_TYPES = {"Rush", "Rushing Touchdown", "Pass Reception", "Passing Touchdown",
               "Pass Incompletion", "Fumble Recovery (Own)", "Fumble Recovery (Opponent)",
               "Pass Interception Return", "Interception"}
_SUFFIXES = {"jr.", "sr.", "ii", "iii", "iv", "v"}


def _clock_seconds(display: str) -> int:
    try:
        m, s = display.split(":")
        return int(m) * 60 + int(float(s))
    except (ValueError, AttributeError):
        return 0


def find_window(plays: list[dict], final_home: int, final_away: int,
                league: str) -> Optional[dict]:
    """Return {'leader': 'home'|'away', 'plays': [...], 'start': play, 'lead': n}
    for the plays in the garbage window, or None. `plays` must be in game order;
    each needs period.number, homeScore, awayScore (score AFTER the play, so the
    lead going INTO a play is the previous play's score)."""
    rule = RULES[league]
    margin = abs(final_home - final_away)
    if final_home == final_away or margin < rule["min_final_margin"]:
        return None
    winner = "home" if final_home > final_away else "away"
    ph = pa = 0
    window = []
    first_lead = None
    for p in plays:
        period = (p.get("period") or {}).get("number")
        lead = (ph - pa) if winner == "home" else (pa - ph)
        if period == 4 and lead >= rule["lead"]:
            window.append(p)
            if first_lead is None:
                first_lead = lead
        if p.get("homeScore") is not None:
            ph, pa = int(p["homeScore"]), int(p["awayScore"])
    if not window:
        return None
    return {"leader": winner, "plays": window, "start": window[0], "lead": first_lead}


# ── NBA attribution ────────────────────────────────────────────────────────────

def nba_player_stats(plays: list[dict]) -> dict[str, dict]:
    """{espn athlete id -> {pts, fg3m, reb, ast}} over the given plays."""
    out: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    for p in plays:
        parts = [str(x.get("athlete", {}).get("id")) for x in p.get("participants", [])
                 if x.get("athlete")]
        if not parts:
            continue
        if p.get("scoringPlay"):
            pts = int(p.get("scoreValue") or 0)
            out[parts[0]]["pts"] += pts
            if pts == 3:
                out[parts[0]]["fg3m"] += 1
            if len(parts) > 1 and "assists" in (p.get("text") or ""):
                out[parts[1]]["ast"] += 1
        elif "Rebound" in ((p.get("type") or {}).get("text") or ""):
            out[parts[0]]["reb"] += 1
    return {k: dict(v) for k, v in out.items()}


# ── NFL attribution (play text; ESPN gives no participants for football) ───────

def abbr_name(display_name: str) -> str:
    """'Amon-Ra St. Brown' -> 'A.St. Brown'; 'Marvin Harrison Jr.' -> 'M.Harrison'."""
    toks = display_name.split()
    if len(toks) < 2:
        return display_name
    rest = toks[1:]
    if rest and rest[-1].lower() in _SUFFIXES and len(rest) > 1:
        rest = rest[:-1]
    return f"{toks[0][0]}.{' '.join(rest)}"


def _first_hit(text: str, names: dict[str, str], after: int = 0) -> Optional[tuple[str, int]]:
    best = None
    for abbr, ext in names.items():
        i = text.find(abbr, after)
        if i != -1 and (best is None or i < best[1]):
            best = (ext, i)
    return best


def nfl_player_stats(plays: list[dict], offense_names: dict[str, dict[str, str]]
                     ) -> dict[str, dict]:
    """{espn athlete id -> stat dict} from play text. `plays` items need
    `_off_team` (offense team espn id); offense_names maps team id -> {abbr: id}."""
    out: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    for p in plays:
        names = offense_names.get(p.get("_off_team"), {})
        text = p.get("text") or ""
        ptype = (p.get("type") or {}).get("text") or ""
        up = text.upper()
        if "TWO-POINT" in up or "NO PLAY" in up or "NULLIFIED" in up or not names:
            continue
        m = _YARDS_RE.search(text)
        yds = (0 if m and m.group(1).lower() == "no gain"
               else int(m.group(1).split()[0])) if m else int(p.get("statYardage") or 0)
        td = "TOUCHDOWN" in up and "REVERSED" not in up
        if ptype not in _PLAY_TYPES or "SACKED" in up or "ABORTED" in up:
            continue
        hit = _first_hit(text, names)
        if not hit:
            continue
        if _PASS_RE.search(text):
            incomplete = "INCOMPLETE" in up
            caught = not incomplete and "INTERCEPTED" not in up
            q = out[hit[0]]
            q["attempts"] += 1
            tgt = _first_hit(text, names, hit[1] + 1)
            if caught:
                q["completions"] += 1
                q["passing_yards"] += yds
                q["passing_tds"] += int(td)
            if tgt:
                t = out[tgt[0]]
                t["targets"] += 1
                if caught:
                    t["receptions"] += 1
                    t["receiving_yards"] += yds
                    t["receiving_tds"] += int(td)
        else:
            r = out[hit[0]]
            r["carries"] += 1
            r["rushing_yards"] += yds
            r["rushing_tds"] += int(td)
    return {k: dict(v) for k, v in out.items()}


def nfl_plays_with_offense(summary: dict) -> list[dict]:
    """Flatten drives -> plays in order, tagging each with the offense team id."""
    plays = []
    drives = (summary.get("drives") or {})
    for d in (drives.get("previous") or []) + ([drives["current"]] if drives.get("current") else []):
        team = str((d.get("team") or {}).get("id", ""))
        for p in d.get("plays", []):
            p = dict(p)
            p["_off_team"] = team
            plays.append(p)
    return plays


def nfl_offense_names(summary: dict) -> dict[str, dict[str, str]]:
    """{team espn id -> {abbreviated name -> athlete espn id}} from the box score."""
    out: dict[str, dict[str, str]] = {}
    for tb in (summary.get("boxscore") or {}).get("players", []):
        tid = str(tb.get("team", {}).get("id", ""))
        names = out.setdefault(tid, {})
        for g in tb.get("statistics", []):
            for e in g.get("athletes", []):
                a = e.get("athlete") or {}
                if a.get("id") and a.get("displayName"):
                    names[abbr_name(a["displayName"])] = str(a["id"])
    return out
