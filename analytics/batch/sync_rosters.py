"""
analytics/batch/sync_rosters.py

Keeps players.team (and is_active) in step with each league's current rosters,
so trades, signings and waiver moves show up without a manual re-seed.

Source of truth per league:
  nba / nfl / nhl : ESPN team rosters
  mlb             : MLB Stats API active rosters

Matching: NBA joins on players.espn_id (ext_id there is the legacy nba.com id);
the other leagues join on players.ext_id. Athletes with no DB row are reported,
never created here (seed_nba_players / *_init --rosters own inserts).

An athlete who appears on two rosters (mid-sync trade) takes the last roster
seen. Players missing from every roster are marked is_active=False for the ESPN
leagues (their rosters include injured players, so absence means released or
retired). MLB is left untouched: its active roster excludes the IL / minors, so
absence is not proof of a release.

Exit code 1 only when a league's roster fetch looks broken (too few athletes),
so a flaky API can never mass-corrupt `team`.

CLI:
    python -m analytics.batch.sync_rosters --dry-run
    python -m analytics.batch.sync_rosters --league nba
"""

from __future__ import annotations

import argparse
import sys

from analytics.data.espn import client as espn
from analytics.data.mlb import client as mlb
from analytics.db.connection import BATCH_SIZE, MLB_LEAGUE_ID, NBA_LEAGUE_ID, supabase

# slug -> (league_id, ESPN sport, ESPN league, min roster athletes to trust a fetch)
ESPN_LEAGUES = {
    "nba": (NBA_LEAGUE_ID, "basketball", "nba", 300),
    "nfl": (3, "football", "nfl", 1000),
    "nhl": (4, "hockey", "nhl", 500),
}
MLB_MIN_ATHLETES = 600
PAGE = 1000


def _db_players(league: str, key: str) -> dict[str, dict]:
    """{key value -> player row} for a league, paginated past PostgREST's 1000 cap."""
    out: dict[str, dict] = {}
    page = 0
    while True:
        batch = (supabase.table("players").select("id,name,team,is_active,ext_id,espn_id")
                 .eq("league", league).order("id")
                 .range(page * PAGE, page * PAGE + PAGE - 1).execute()).data or []
        for r in batch:
            if r.get(key):
                out[str(r[key])] = r
        if len(batch) < PAGE:
            break
        page += 1
    return out


def _espn_rosters(league: str) -> dict[str, str]:
    """{espn athlete id -> team abbreviation} across every team."""
    league_id, sport, espn_league, _ = ESPN_LEAGUES[league]
    teams = (supabase.table("teams").select("ext_id,espn_id,abbreviation")
             .eq("league_id", league_id).execute()).data or []
    out: dict[str, str] = {}
    for t in teams:
        # NBA teams keep the ESPN id in espn_id; NFL/NHL use ext_id directly.
        team_espn_id = t.get("espn_id") if league == "nba" else t.get("ext_id")
        if not team_espn_id:
            print(f"  WARNING [{league}] team {t['abbreviation']} has no ESPN id; skipped.")
            continue
        roster = espn.get_roster(sport, espn_league, str(team_espn_id))
        if not roster:
            print(f"  WARNING [{league}] empty roster for {t['abbreviation']}; skipped.")
            continue
        for a in roster:
            if a.get("id"):
                out[str(a["id"])] = t["abbreviation"]
    return out


def _mlb_rosters() -> dict[str, str]:
    """{mlb person id -> team abbreviation} from active rosters."""
    teams = (supabase.table("teams").select("ext_id,abbreviation")
             .eq("league_id", MLB_LEAGUE_ID).execute()).data or []
    out: dict[str, str] = {}
    for t in teams:
        for r in mlb.get_roster(int(t["ext_id"]), roster_type="active"):
            pid = (r.get("person") or {}).get("id")
            if pid:
                out[str(pid)] = t["abbreviation"]
    return out


def sync(league: str, dry_run: bool) -> bool:
    """Returns False when the roster fetch looks broken (nothing is written)."""
    if league == "mlb":
        current, floor, key = _mlb_rosters(), MLB_MIN_ATHLETES, "ext_id"
    else:
        current, floor = _espn_rosters(league), ESPN_LEAGUES[league][3]
        key = "espn_id" if league == "nba" else "ext_id"

    if len(current) < floor:
        print(f"[{league}] ERROR only {len(current)} roster athletes fetched "
              f"(expected >= {floor}); not writing.")
        return False

    db = _db_players(league, key)
    moves: list[tuple[dict, str]] = []
    reactivate: list[dict] = []
    unknown = 0
    for athlete_id, abbr in current.items():
        row = db.get(athlete_id)
        if not row:
            unknown += 1
            continue
        if row.get("team") != abbr:
            moves.append((row, abbr))
        elif not row.get("is_active"):
            reactivate.append(row)
    off_roster_rows = [r for k, r in db.items() if r.get("is_active") and k not in current]
    off_roster = len(off_roster_rows)
    deactivate = off_roster_rows if league != "mlb" else []

    print(f"[{league}] {len(current)} roster athletes | {len(moves)} team change(s) | "
          f"{len(reactivate)} reactivation(s) | {unknown} not in DB | "
          f"{off_roster} active in DB but on no roster "
          f"({len(deactivate)} to deactivate){' (dry run)' if dry_run else ''}")
    for row, abbr in moves:
        print(f"    {row['name']}: {row.get('team') or '-'} -> {abbr}")

    if dry_run:
        return True
    for row, abbr in moves:
        (supabase.table("players").update({"team": abbr, "is_active": True})
         .eq("id", row["id"]).execute())
    ids = [r["id"] for r in reactivate]
    for i in range(0, len(ids), BATCH_SIZE):
        (supabase.table("players").update({"is_active": True})
         .in_("id", ids[i:i + BATCH_SIZE]).execute())
    off_ids = [r["id"] for r in deactivate]
    for i in range(0, len(off_ids), BATCH_SIZE):
        (supabase.table("players").update({"is_active": False})
         .in_("id", off_ids[i:i + BATCH_SIZE]).execute())
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync players.team from current rosters")
    parser.add_argument("--league", choices=["nba", "mlb", "nfl", "nhl", "all"], default="all")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()
    leagues = ["nba", "mlb", "nfl", "nhl"] if args.league == "all" else [args.league]
    ok = True
    for lg in leagues:
        try:
            ok = sync(lg, args.dry_run) and ok
        except Exception as e:  # one league's outage must not skip the others
            print(f"[{lg}] ERROR {type(e).__name__}: {e}")
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
