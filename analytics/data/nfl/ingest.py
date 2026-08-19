"""
analytics/data/nfl/ingest.py

Parses ESPN NFL summary payloads (boxscore.players stat groups) into row dicts
for the `nfl_player_stats` table.

Parsing is defensive but LOUD:
  - Stat groups are resolved via each group's `keys` array (machine names),
    never by positional index against display labels.
  - A missing REQUIRED group logs a WARNING with the event id — absent groups
    leave columns as None (NULL), never silent zeros, so "played, 0 yards" is
    distinguishable from "group absent".
  - Combined display fields ('21/37', '4-21', '2/2') are split into components.
"""

from __future__ import annotations

from typing import Optional

# Groups every real NFL game should produce for both teams. Others (fumbles,
# kicking, interceptions, returns, punting) are legitimately absent sometimes.
REQUIRED_GROUPS = {"passing", "rushing", "receiving", "defensive"}

# group name -> [(espn_key, column, parser)] for scalar stats.
# Combined "a/b" or "a-b" fields are handled separately in _GROUP_SPLITS.
_GROUP_FIELDS: dict[str, list[tuple[str, str, str]]] = {
    "passing": [
        ("passingYards", "passing_yards", "int"),
        ("passingTouchdowns", "passing_tds", "int"),
        ("interceptions", "interceptions", "int"),
        ("adjQBR", "qbr", "float"),
        ("QBRating", "passer_rating", "float"),
    ],
    "rushing": [
        ("rushingAttempts", "carries", "int"),
        ("rushingYards", "rushing_yards", "int"),
        ("rushingTouchdowns", "rushing_tds", "int"),
        ("longRushing", "long_rush", "int"),
    ],
    "receiving": [
        ("receptions", "receptions", "int"),
        ("receivingTargets", "targets", "int"),
        ("receivingYards", "receiving_yards", "int"),
        ("receivingTouchdowns", "receiving_tds", "int"),
        ("longReception", "long_reception", "int"),
    ],
    "fumbles": [
        ("fumbles", "fumbles", "int"),
        ("fumblesLost", "fumbles_lost", "int"),
    ],
    "defensive": [
        ("totalTackles", "tackles_total", "int"),
        ("soloTackles", "tackles_solo", "int"),
        ("sacks", "sacks", "float"),
        ("tacklesForLoss", "tfl", "float"),
        ("passesDefended", "passes_defended", "int"),
        ("defensiveTouchdowns", "def_tds", "int"),
    ],
}

# group -> [(espn_key, separator, first_column, second_column)]
_GROUP_SPLITS: dict[str, list[tuple[str, str, str, Optional[str]]]] = {
    "passing": [
        ("completions/passingAttempts", "/", "completions", "attempts"),
        ("sacks-sackYardsLost", "-", "sacks_taken", None),  # yards-lost not stored
    ],
    "kicking": [
        ("fieldGoalsMade/fieldGoalAttempts", "/", "fg_made", "fg_att"),
        ("extraPointsMade/extraPointAttempts", "/", "xp_made", "xp_att"),
    ],
}

PARSED_GROUPS = set(_GROUP_FIELDS) | set(_GROUP_SPLITS)


# ── Value parsers ──────────────────────────────────────────────────────────────

def _int(raw) -> Optional[int]:
    """'21' -> 21; '--'/''/None -> None."""
    if raw in (None, "", "--"):
        return None
    try:
        return int(str(raw).replace(",", ""))
    except (ValueError, TypeError):
        return None


def _float(raw) -> Optional[float]:
    if raw in (None, "", "--"):
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


def _split_pair(raw, sep: str) -> tuple[Optional[int], Optional[int]]:
    """'21/37' -> (21, 37); '4-21' -> (4, 21); junk -> (None, None)."""
    if raw in (None, "", "--"):
        return None, None
    parts = str(raw).split(sep, 1)
    if len(parts) != 2:
        return _int(raw), None
    return _int(parts[0]), _int(parts[1])


_PARSERS = {"int": _int, "float": _float}


# ── Boxscore parsing ───────────────────────────────────────────────────────────

def parse_summary_boxscore(summary: dict, event_id: str) -> list[dict]:
    """Flatten one ESPN NFL summary into per-player stat rows.

    Returns dicts with `player_ext_id`, `player_name`, `player_position`,
    `team_ext_id`, and nfl_player_stats stat columns. A player appearing in
    several groups (QB: passing + rushing + fumbles) is merged into one row.
    DNP athletes (empty stats array) are skipped with a debug note.
    """
    box_teams = ((summary or {}).get("boxscore", {}) or {}).get("players", [])
    if not box_teams:
        print(f"  WARNING [NFL {event_id}] summary has no boxscore.players; "
              f"no stat rows parsed.")
        return []

    rows: dict[str, dict] = {}  # player ext_id -> merged row
    for team_block in box_teams:
        team_ext = str(team_block.get("team", {}).get("id", ""))
        groups = {g.get("name"): g for g in team_block.get("statistics", [])}

        missing_required = REQUIRED_GROUPS - set(groups)
        if missing_required:
            print(f"  WARNING [NFL {event_id}] team {team_ext} missing stat "
                  f"group(s) {sorted(missing_required)} — columns left NULL.")

        for name, group in groups.items():
            if name not in PARSED_GROUPS:
                continue  # returns/punting/interceptions etc. — not stored
            keys = group.get("keys") or []
            if not keys:
                print(f"  WARNING [NFL {event_id}] group '{name}' has no keys "
                      f"array; skipping group.")
                continue
            idx = {k: i for i, k in enumerate(keys)}
            for entry in group.get("athletes", []):
                athlete = entry.get("athlete", {}) or {}
                ext_id = str(athlete.get("id", ""))
                stats = entry.get("stats") or []
                if not ext_id:
                    print(f"  WARNING [NFL {event_id}] athlete without id in "
                          f"group '{name}'; skipped.")
                    continue
                if not stats:
                    # DNP/inactive — listed but produced no line.
                    print(f"  debug [NFL {event_id}] {athlete.get('displayName')} "
                          f"empty stats in '{name}' (DNP); skipped.")
                    continue

                row = rows.setdefault(ext_id, {
                    "player_ext_id": ext_id,
                    "player_name": athlete.get("displayName", f"Player {ext_id}"),
                    "player_position": (athlete.get("position") or {}).get("abbreviation"),
                    "team_ext_id": team_ext,
                })

                def val(key: str):
                    i = idx.get(key)
                    return stats[i] if i is not None and i < len(stats) else None

                for espn_key, col, kind in _GROUP_FIELDS.get(name, []):
                    if espn_key not in idx:
                        print(f"  WARNING [NFL {event_id}] key '{espn_key}' "
                              f"missing from group '{name}' keys; column "
                              f"'{col}' left NULL.")
                        continue
                    row[col] = _PARSERS[kind](val(espn_key))
                for espn_key, sep, col_a, col_b in _GROUP_SPLITS.get(name, []):
                    if espn_key not in idx:
                        print(f"  WARNING [NFL {event_id}] key '{espn_key}' "
                              f"missing from group '{name}' keys; column(s) "
                              f"left NULL.")
                        continue
                    a, b = _split_pair(val(espn_key), sep)
                    row[col_a] = a
                    if col_b:
                        row[col_b] = b

    return list(rows.values())
