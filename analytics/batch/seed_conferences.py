"""
analytics/batch/seed_conferences.py

Seeds teams.conference / teams.division from ESPN's standings tree.

The league home pages split their standings card by conference (AFC/NFC,
EASTERN/WESTERN, AL/NL) and `teams` had no column to split on. ESPN's
standings resource nests divisions under conferences at level=3; the flat
default only returns conferences.

NFL/NHL were ingested from ESPN directly, so teams.ext_id IS the ESPN team id
and matching is exact. NBA (nba_api) and MLB (MLB Stats API) have their own id
schemes, so those two match on abbreviation instead, via a short, explicit
alias table for the handful of codes ESPN spells differently (SAS/SA,
NYK/NY, ...) — never fuzzy name-guessed.

Conference/division are stable league structure, not season state, so this is
a seed job — safe to re-run, and only needs re-running on realignment.

Usage:
    python -m analytics.batch.seed_conferences
    python -m analytics.batch.seed_conferences --league nhl --dry-run
"""
from __future__ import annotations

import argparse
import sys

from analytics.data.espn import client as espn
from analytics.db.connection import (
    MLB_LEAGUE_ID,
    NBA_LEAGUE_ID,
    NFL_LEAGUE_ID,
    NHL_LEAGUE_ID,
    supabase,
)

# league code -> (espn sport, espn league, leagues.id)
LEAGUES: dict[str, tuple[str, str, int]] = {
    "nba": ("basketball", "nba", NBA_LEAGUE_ID),
    "mlb": ("baseball", "mlb", MLB_LEAGUE_ID),
    "nfl": ("football", "nfl", NFL_LEAGUE_ID),
    "nhl": ("hockey", "nhl", NHL_LEAGUE_ID),
}

# ESPN labels its NHL conferences 'East'/'West' at the abbreviation level but
# the home page wants the full word. Conference names are normalized to the
# uppercase single word both leagues' UI expects.
CONFERENCE_ALIASES = {
    "EASTERN CONFERENCE": "EASTERN",
    "WESTERN CONFERENCE": "WESTERN",
    "AMERICAN FOOTBALL CONFERENCE": "AFC",
    "NATIONAL FOOTBALL CONFERENCE": "NFC",
}

# Leagues whose local ext_id isn't an ESPN id — match by abbreviation instead.
MATCH_BY_ABBREVIATION = {"nba", "mlb"}

# local abbreviation -> ESPN's spelling, only where they differ. Verified
# against a live ESPN pull: every local team matches with these applied.
ABBREVIATION_ALIASES: dict[str, dict[str, str]] = {
    "nba": {"SAS": "SA", "NYK": "NY", "GSW": "GS", "NOP": "NO", "UTA": "UTAH", "WAS": "WSH"},
    "mlb": {"CWS": "CHW", "AZ": "ARI"},
}


def _normalize_conference(name: str, abbr: str) -> str:
    key = (name or "").strip().upper()
    if key in CONFERENCE_ALIASES:
        return CONFERENCE_ALIASES[key]
    return (abbr or name or "").strip().upper()


def _normalize_division(name: str) -> str:
    """'Atlantic Division' -> 'Atlantic'; 'AFC East' -> 'AFC East'."""
    return (name or "").replace(" Division", "").strip()


def collect(sport: str, league: str, key_by: str) -> dict[str, tuple[str, str]]:
    """ESPN team id or abbreviation -> (conference, division), per `key_by`.
    Empty dict on fetch failure."""
    children = espn.get_standings(sport, league, level=3)
    if not children:
        print(f"  ERROR [{league}] ESPN returned no standings children; "
              f"nothing to seed.")
        return {}

    def key_for(team: dict) -> str:
        return team["abbreviation"] if key_by == "abbreviation" else str(team["id"])

    out: dict[str, tuple[str, str]] = {}
    for conf in children:
        conf_name = _normalize_conference(conf.get("name", ""),
                                          conf.get("abbreviation", ""))
        divisions = conf.get("children") or []
        if not divisions:
            print(f"  WARNING [{league}] conference {conf_name!r} has no "
                  f"division subgroups; seeding conference only.")
            entries = (conf.get("standings") or {}).get("entries") or []
            for e in entries:
                out[key_for(e["team"])] = (conf_name, "")
            continue

        for div in divisions:
            div_name = _normalize_division(div.get("name", ""))
            entries = (div.get("standings") or {}).get("entries") or []
            for e in entries:
                out[key_for(e["team"])] = (conf_name, div_name)
    return out


def seed(code: str, dry_run: bool = False) -> int:
    """Apply conference/division for one league. Returns rows updated."""
    sport, league, league_id = LEAGUES[code]
    by_abbr = code in MATCH_BY_ABBREVIATION
    key_by = "abbreviation" if by_abbr else "ext_id"
    espn_map = collect(sport, league, key_by)
    if not espn_map:
        return 0

    db = (supabase.table("teams")
          .select("id,ext_id,abbreviation,conference,division")
          .eq("league_id", league_id).execute()).data or []
    aliases = ABBREVIATION_ALIASES.get(code, {})
    local_key = (lambda r: aliases.get(r["abbreviation"], r["abbreviation"])) if by_abbr \
        else (lambda r: r["ext_id"])
    by_local_key = {local_key(r): r for r in db}

    updates: list[tuple[int, str, str, str]] = []
    for espn_key, (conf, div) in sorted(espn_map.items()):
        row = by_local_key.get(espn_key)
        if not row:
            print(f"  WARNING [{code}] ESPN team {espn_key!r} has no local "
                  f"teams row; skipped.")
            continue
        if row.get("conference") == conf and (row.get("division") or "") == div:
            continue
        updates.append((row["id"], row["abbreviation"], conf, div))

    missing = [r["abbreviation"] for r in db if local_key(r) not in espn_map]
    if missing:
        print(f"  WARNING [{code}] {len(missing)} local team(s) absent from "
              f"ESPN standings: {', '.join(sorted(missing))}")

    print(f"[{code}] {len(db)} local teams, {len(espn_map)} from ESPN, "
          f"{len(updates)} update(s)")
    if dry_run:
        for _, abbr, conf, div in updates[:40]:
            print(f"    {abbr}: {conf} / {div}")
        return 0

    for team_id, _, conf, div in updates:
        (supabase.table("teams")
         .update({"conference": conf, "division": div or None})
         .eq("id", team_id).execute())
    return len(updates)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed team conference/division from ESPN standings")
    parser.add_argument("--league", choices=sorted(LEAGUES), action="append",
                        help="Limit to one league (repeatable). Default: all.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show changes without writing")
    args = parser.parse_args()

    total = 0
    for code in (args.league or sorted(LEAGUES)):
        total += seed(code, dry_run=args.dry_run)
    print(f"\nDone — {total} team row(s) updated"
          f"{' (dry-run: none written)' if args.dry_run else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
