"""
analytics/batch/map_espn_ids.py

One-shot (re-runnable) mapper that populates the espn_id columns on the NBA
rows of `teams` and `players` (Phase 8 ESPN hybrid). Existing ext_id values
stay nba_api-native; espn_id is the parallel ESPN identity used by
analytics/data/nba_espn/ingest.py.

Rules — deterministic, never guessed:
  Teams   : ESPN abbreviation (via a fixed ESPN->NBA alias table) must resolve
            to exactly one DB team; anything other than 30/30 hard-fails.
  Players : pass 1 matches ESPN roster athletes to DB players by normalized
            name (diacritics/suffix/punctuation-insensitive) scoped to the
            same team; pass 2 retries the leftovers league-wide but only when
            the name is unique on BOTH sides. Ambiguous names are reported
            and skipped. Every unmatched player is listed by name.

CLI:
    python -m analytics.batch.map_espn_ids              # teams + players
    python -m analytics.batch.map_espn_ids --teams
    python -m analytics.batch.map_espn_ids --players
    python -m analytics.batch.map_espn_ids --dry-run    # report only, no writes
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict

from analytics.data.espn import client as espn
from analytics.data.nba_espn.ingest import (
    SPORT, LEAGUE, _load_all_nba_players, normalize_name,
)
from analytics.db.connection import NBA_LEAGUE_ID, supabase

# ESPN NBA abbreviation -> nba_api-native abbreviation (identity when absent).
ESPN_ABBR_TO_NBA = {
    "GS": "GSW",
    "NO": "NOP",
    "NY": "NYK",
    "SA": "SAS",
    "UTAH": "UTA",
    "WSH": "WAS",
}


# ── Teams ──────────────────────────────────────────────────────────────────────

def map_teams(dry_run: bool = False) -> dict[str, str]:
    """Map all 30 ESPN NBA teams onto DB team rows and persist teams.espn_id.
    Returns {espn_team_id: nba_abbreviation}. Hard-fails unless 30/30 match."""
    espn_teams = espn.get_teams(SPORT, LEAGUE)
    db_teams = (supabase.table("teams").select("id,ext_id,name,abbreviation,espn_id")
                .eq("league_id", NBA_LEAGUE_ID).execute()).data or []
    db_by_abbr = {t["abbreviation"]: t for t in db_teams}
    print(f"[teams] ESPN teams: {len(espn_teams)}  DB NBA teams: {len(db_teams)}")

    matched: dict[str, str] = {}
    failures: list[str] = []
    for et in espn_teams:
        espn_id = str(et.get("id", ""))
        espn_abbr = (et.get("abbreviation") or "").upper()
        nba_abbr = ESPN_ABBR_TO_NBA.get(espn_abbr, espn_abbr)
        db = db_by_abbr.get(nba_abbr)
        if not db:
            failures.append(f"{espn_abbr} ({et.get('displayName')}) -> "
                            f"no DB team with abbreviation {nba_abbr}")
            continue
        # Name sanity check — abbreviation matched, but warn if names disagree
        # beyond the known 'LA Clippers' vs 'Los Angeles Clippers' rewording.
        if normalize_name(et.get("displayName", "")) != normalize_name(db["name"]):
            print(f"  note [teams] {nba_abbr}: name variant "
                  f"ESPN='{et.get('displayName')}' DB='{db['name']}' "
                  f"(abbreviation match is authoritative).")
        matched[espn_id] = nba_abbr
        if not dry_run and db.get("espn_id") != espn_id:
            supabase.table("teams").update({"espn_id": espn_id}) \
                .eq("id", db["id"]).execute()

    print(f"[teams] matched {len(matched)}/{len(espn_teams)}"
          + (" (dry-run, not persisted)" if dry_run else ""))
    if failures or len(matched) != 30 or len(db_teams) != 30:
        for f in failures:
            print(f"  UNMATCHED: {f}")
        raise RuntimeError(
            f"Team mapping must be exactly 30/30 (got {len(matched)}/"
            f"{len(espn_teams)}, DB has {len(db_teams)}). Aborting.")
    return matched


# ── Players ────────────────────────────────────────────────────────────────────

def map_players(team_map: dict[str, str], dry_run: bool = False) -> None:
    """Populate players.espn_id from current ESPN rosters.

    ESPN rosters are current-state (offseason moves included) while DB
    players.team reflects the last synced season — so pass 1 (same-team) is
    supplemented by a league-wide unique-name pass 2 for moved players.
    """
    db_players = _load_all_nba_players()
    already = sum(1 for p in db_players if p.get("espn_id"))
    print(f"[players] DB NBA players: {len(db_players)} "
          f"({already} already mapped)")

    by_name: dict[str, list[dict]] = defaultdict(list)
    by_team_name: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for p in db_players:
        key = normalize_name(p["name"])
        by_name[key].append(p)
        by_team_name[(p.get("team") or "", key)].append(p)

    espn_athletes: list[dict] = []   # {espn_id, name, team_abbr}
    seen_espn: set[str] = set()
    for espn_team_id, nba_abbr in sorted(team_map.items(), key=lambda kv: kv[1]):
        roster = espn.get_roster(SPORT, LEAGUE, espn_team_id)
        if not roster:
            print(f"  WARNING [players] empty ESPN roster for {nba_abbr}.")
            continue
        for a in roster:
            aid = str(a.get("id", ""))
            name = a.get("fullName") or a.get("displayName") or ""
            if not aid or not name:
                print(f"  WARNING [players] roster entry missing id/name on "
                      f"{nba_abbr}; skipped.")
                continue
            if aid in seen_espn:  # trade artifacts: athlete on two rosters
                continue
            seen_espn.add(aid)
            espn_athletes.append({"espn_id": aid, "name": name,
                                  "team": nba_abbr})
    print(f"[players] ESPN roster athletes (deduped): {len(espn_athletes)}")

    espn_name_counts: dict[str, int] = defaultdict(int)
    for a in espn_athletes:
        espn_name_counts[normalize_name(a["name"])] += 1

    stats = {"already": 0, "team": 0, "league": 0}
    ambiguous: list[str] = []
    unmatched: list[str] = []
    pending: list[tuple[int, str]] = []  # (player_db_id, espn_id)
    claimed_db_ids: set[int] = {p["id"] for p in db_players if p.get("espn_id")}

    def _claim(candidates: list[dict]) -> list[dict]:
        return [c for c in candidates
                if not c.get("espn_id") and c["id"] not in claimed_db_ids]

    leftovers: list[dict] = []
    for a in espn_athletes:
        key = normalize_name(a["name"])
        existing = [p for p in by_name.get(key, [])
                    if p.get("espn_id") == a["espn_id"]]
        if existing:
            stats["already"] += 1
            continue
        cands = _claim(by_team_name.get((a["team"], key), []))
        if len(cands) == 1:
            pending.append((cands[0]["id"], a["espn_id"]))
            claimed_db_ids.add(cands[0]["id"])
            stats["team"] += 1
        elif len(cands) > 1:
            ambiguous.append(f"{a['name']} ({a['team']}): "
                             f"{len(cands)} same-team DB candidates")
        else:
            leftovers.append(a)

    for a in leftovers:
        key = normalize_name(a["name"])
        if espn_name_counts[key] > 1:
            ambiguous.append(f"{a['name']} ({a['team']}): name not unique "
                             f"among ESPN athletes")
            continue
        cands = _claim(by_name.get(key, []))
        if len(cands) == 1:
            pending.append((cands[0]["id"], a["espn_id"]))
            claimed_db_ids.add(cands[0]["id"])
            stats["league"] += 1
        elif len(cands) > 1:
            ambiguous.append(f"{a['name']} ({a['team']}): "
                             f"{len(cands)} league-wide DB candidates")
        else:
            unmatched.append(f"{a['name']} ({a['team']})")

    if not dry_run:
        for db_id, espn_id in pending:
            supabase.table("players").update({"espn_id": espn_id}) \
                .eq("id", db_id).execute()

    total_mapped = stats["already"] + len(pending)
    print(f"\n[players] result{' (dry-run, not persisted)' if dry_run else ''}:")
    print(f"  ESPN athletes mapped:     {total_mapped}/{len(espn_athletes)} "
          f"({total_mapped / len(espn_athletes) * 100:.1f}%)")
    print(f"    already mapped:         {stats['already']}")
    print(f"    matched same-team:      {stats['team']}")
    print(f"    matched league-wide:    {stats['league']}")
    print(f"  ambiguous (skipped):      {len(ambiguous)}")
    for line in ambiguous:
        print(f"    AMBIGUOUS: {line}")
    print(f"  unmatched ESPN athletes:  {len(unmatched)}")
    for line in unmatched:
        print(f"    UNMATCHED: {line}")

    db_unmapped = [p for p in db_players
                   if not p.get("espn_id") and p["id"] not in claimed_db_ids]
    print(f"  DB players without espn_id: {len(db_unmapped)}/{len(db_players)}")
    for p in sorted(db_unmapped, key=lambda x: x["name"]):
        print(f"    DB-UNMAPPED: {p['name']} ({p.get('team')})")


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Map ESPN ids onto NBA teams/players (espn_id columns)")
    parser.add_argument("--teams", action="store_true", help="map teams only")
    parser.add_argument("--players", action="store_true", help="map players only")
    parser.add_argument("--dry-run", action="store_true", dest="dry_run",
                        help="report matches without writing")
    args = parser.parse_args()

    do_teams = args.teams or not args.players
    do_players = args.players or not args.teams

    team_map: dict[str, str] = {}
    if do_teams:
        team_map = map_teams(dry_run=args.dry_run)
    if do_players:
        if not team_map:
            # players-only run: teams must already be mapped in the DB
            rows = (supabase.table("teams").select("espn_id,abbreviation")
                    .eq("league_id", NBA_LEAGUE_ID)
                    .not_.is_("espn_id", "null").execute()).data or []
            team_map = {r["espn_id"]: r["abbreviation"] for r in rows}
            if len(team_map) != 30:
                print(f"ERROR: only {len(team_map)}/30 teams have espn_id; "
                      f"run --teams first.")
                return 1
        map_players(team_map, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
