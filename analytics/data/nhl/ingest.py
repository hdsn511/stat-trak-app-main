"""
analytics/data/nhl/ingest.py

Parses ESPN NHL summary payloads (boxscore.players stat groups) into row dicts
for the `nhl_player_stats` table.

Skaters come from the 'forwards' and 'defenses' groups; goalies from 'goalies'.
(ESPN also emits an aggregate 'skaters' group, usually empty — parsed only as a
fallback if forwards/defenses are absent.) All groups are resolved via their
`keys` array (machine names), never positional display labels — importantly,
the label 'SOG' maps to key `shootoutGoals`, while shots-on-goal is the
`shotsTotal` key.

Parsing is defensive but LOUD: missing groups/keys log a WARNING with the
event id and leave columns None (NULL) — never silent zeros. TOI strings
(MM:SS) are converted to integer seconds. Scratches / unused backups (no TOI,
no stats) are skipped with a debug note.
"""

from __future__ import annotations

from typing import Optional

SKATER_GROUPS = ("forwards", "defenses")
SKATER_FALLBACK_GROUP = "skaters"
GOALIE_GROUP = "goalies"

# espn key -> (column, parser) for skater groups.
_SKATER_FIELDS: dict[str, tuple[str, str]] = {
    "goals": ("goals", "int"),
    "assists": ("assists", "int"),
    "shotsTotal": ("shots_on_goal", "int"),
    "shotsMissed": ("shots_missed", "int"),
    "blockedShots": ("blocks", "int"),
    "hits": ("hits", "int"),
    "takeaways": ("takeaways", "int"),
    "giveaways": ("giveaways", "int"),
    "plusMinus": ("plus_minus", "int"),
    "penaltyMinutes": ("pim", "int"),
    "faceoffsWon": ("faceoff_wins", "int"),
    "faceoffsLost": ("faceoff_losses", "int"),
    "timeOnIce": ("toi_seconds", "toi"),
    "powerPlayTimeOnIce": ("pp_toi_seconds", "toi"),
    "shortHandedTimeOnIce": ("sh_toi_seconds", "toi"),
    "evenStrengthTimeOnIce": ("es_toi_seconds", "toi"),
    "shifts": ("shifts", "int"),
}

# espn key -> (column, parser) for the goalie group.
_GOALIE_FIELDS: dict[str, tuple[str, str]] = {
    "goalsAgainst": ("goals_against", "int"),
    "shotsAgainst": ("shots_against", "int"),
    "saves": ("saves", "int"),
    "savePct": ("save_pct", "float"),
    "evenStrengthSaves": ("es_saves", "int"),
    "powerPlaySaves": ("pp_saves", "int"),
    "shortHandedSaves": ("sh_saves", "int"),
    "timeOnIce": ("goalie_toi_seconds", "toi"),
}


# ── Value parsers ──────────────────────────────────────────────────────────────

def _int(raw) -> Optional[int]:
    """'3' / '+2' / '-1' -> int; '--'/''/None -> None."""
    if raw in (None, "", "--"):
        return None
    try:
        return int(str(raw))
    except (ValueError, TypeError):
        return None


def _float(raw) -> Optional[float]:
    """'.846' -> 0.846; '--'/''/None -> None."""
    if raw in (None, "", "--"):
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


def toi_to_seconds(raw) -> Optional[int]:
    """'13:27' -> 807 seconds; '--'/''/None/malformed -> None."""
    if raw in (None, "", "--"):
        return None
    parts = str(raw).split(":")
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, TypeError):
        return None


_PARSERS = {"int": _int, "float": _float, "toi": toi_to_seconds}


# ── Boxscore parsing ───────────────────────────────────────────────────────────

def _parse_group(group: dict, fields: dict[str, tuple[str, str]],
                 position_type: str, team_ext: str, event_id: str) -> list[dict]:
    """Parse one stat group's athletes into partial rows."""
    keys = group.get("keys") or []
    if not keys:
        print(f"  WARNING [NHL {event_id}] group '{group.get('name')}' has no "
              f"keys array; skipping group.")
        return []
    idx = {k: i for i, k in enumerate(keys)}
    missing = [k for k in fields if k not in idx]
    if missing:
        print(f"  WARNING [NHL {event_id}] group '{group.get('name')}' missing "
              f"key(s) {missing}; those columns left NULL.")

    out: list[dict] = []
    for entry in group.get("athletes", []):
        athlete = entry.get("athlete", {}) or {}
        ext_id = str(athlete.get("id", ""))
        stats = entry.get("stats") or []
        if not ext_id:
            print(f"  WARNING [NHL {event_id}] athlete without id in group "
                  f"'{group.get('name')}'; skipped.")
            continue
        if not stats:
            print(f"  debug [NHL {event_id}] {athlete.get('displayName')} empty "
                  f"stats (scratch/DNP); skipped.")
            continue

        row: dict = {
            "player_ext_id": ext_id,
            "player_name": athlete.get("displayName", f"Player {ext_id}"),
            "player_position": (athlete.get("position") or {}).get("abbreviation"),
            "team_ext_id": team_ext,
            "position_type": position_type,
        }
        for espn_key, (col, kind) in fields.items():
            i = idx.get(espn_key)
            raw = stats[i] if i is not None and i < len(stats) else None
            row[col] = _PARSERS[kind](raw)

        if position_type == "skater":
            if not (row.get("toi_seconds") or row.get("shifts")):
                print(f"  debug [NHL {event_id}] {row['player_name']} 0 TOI / "
                      f"0 shifts (did not play); skipped.")
                continue
            g, a = row.get("goals"), row.get("assists")
            row["points"] = (g + a) if g is not None and a is not None else None
        else:  # goalie
            if not row.get("goalie_toi_seconds") and not row.get("shots_against"):
                print(f"  debug [NHL {event_id}] goalie {row['player_name']} "
                      f"no TOI / shots against (unused backup); skipped.")
                continue
        out.append(row)
    return out


def parse_summary_boxscore(summary: dict, event_id: str) -> list[dict]:
    """Flatten one ESPN NHL summary into per-player stat rows (skaters +
    goalies), with `player_ext_id`, `player_name`, `player_position`,
    `team_ext_id`, `position_type`, and nhl_player_stats stat columns."""
    box_teams = ((summary or {}).get("boxscore", {}) or {}).get("players", [])
    if not box_teams:
        print(f"  WARNING [NHL {event_id}] summary has no boxscore.players; "
              f"no stat rows parsed.")
        return []

    rows: dict[str, dict] = {}  # player ext_id -> row (dedupes across groups)
    for team_block in box_teams:
        team_ext = str(team_block.get("team", {}).get("id", ""))
        groups = {g.get("name"): g for g in team_block.get("statistics", [])}

        skater_groups = [groups[n] for n in SKATER_GROUPS if n in groups]
        if not skater_groups:
            fallback = groups.get(SKATER_FALLBACK_GROUP)
            if fallback and fallback.get("athletes"):
                print(f"  WARNING [NHL {event_id}] team {team_ext} has no "
                      f"forwards/defenses groups; using aggregate 'skaters'.")
                skater_groups = [fallback]
            else:
                print(f"  WARNING [NHL {event_id}] team {team_ext} has no "
                      f"skater stat groups at all — no skater rows.")
        for group in skater_groups:
            for row in _parse_group(group, _SKATER_FIELDS, "skater",
                                    team_ext, event_id):
                rows.setdefault(row["player_ext_id"], row)

        if GOALIE_GROUP in groups:
            for row in _parse_group(groups[GOALIE_GROUP], _GOALIE_FIELDS,
                                    "goalie", team_ext, event_id):
                rows.setdefault(row["player_ext_id"], row)
        else:
            print(f"  WARNING [NHL {event_id}] team {team_ext} missing "
                  f"'goalies' group — no goalie rows.")

    return list(rows.values())
