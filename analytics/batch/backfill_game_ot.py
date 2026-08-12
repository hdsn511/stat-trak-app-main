"""
analytics/batch/backfill_game_ot.py

Backfills games.ot ('OT' | 'SO' | NULL) from ESPN's scoreboard.

NHL standings are points-based: a loss in overtime or a shootout is still
worth a point, and that fact is not derivable from the final score. NFL needs
it too, for the far rarer overtime tie. The box-score ingest never captured it,
so this walks the scoreboard once per game date and records how each game
ended.

Detection reads status.type.detail ('Final/OT', 'Final/SO'), which ESPN labels
per sport, rather than inferring from status.period — period numbering differs
between football and hockey and would need a per-sport constant.

Games are matched on games.ext_id, which for the ESPN-native leagues IS the
ESPN event id. A game whose event never appears on its own scoreboard date is
reported, not silently skipped: ESPN's `dates` param is ET-based and a late
start can land on the neighbouring date.

Usage:
    python -m analytics.batch.backfill_game_ot
    python -m analytics.batch.backfill_game_ot --league nhl --season 2025
    python -m analytics.batch.backfill_game_ot --dry-run
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict

from analytics.data.espn import client as espn
from analytics.db.connection import NFL_LEAGUE_ID, NHL_LEAGUE_ID, supabase

# league code -> (espn sport, espn league, leagues.id)
LEAGUES: dict[str, tuple[str, str, int]] = {
    "nfl": ("football", "nfl", NFL_LEAGUE_ID),
    "nhl": ("hockey", "nhl", NHL_LEAGUE_ID),
}

PAGE = 1000


def _ending(event: dict) -> str | None:
    """'OT' / 'SO' / None from an ESPN scoreboard event."""
    comps = event.get("competitions") or []
    if not comps:
        return None
    detail = (((comps[0].get("status") or {}).get("type") or {})
              .get("detail") or "").upper()
    if detail.endswith("/SO") or "SHOOTOUT" in detail:
        return "SO"
    if detail.endswith("/OT") or "OVERTIME" in detail:
        return "OT"
    return None


def _load_games(league_id: int, season: int | None) -> list[dict]:
    rows: list[dict] = []
    page = 0
    while True:
        q = (supabase.table("games").select("id,ext_id,game_date,ot")
             .eq("league_id", league_id))
        if season is not None:
            q = q.eq("season", season)
        # id breaks game_date ties: range() paging over a partial order
        # silently drops and repeats rows across pages.
        batch = (q.order("game_date").order("id")
                 .range(page * PAGE, page * PAGE + PAGE - 1).execute()).data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        page += 1


def backfill(code: str, season: int | None, dry_run: bool = False) -> int:
    sport, league, league_id = LEAGUES[code]
    games = _load_games(league_id, season)
    if not games:
        print(f"[{code}] no games found; nothing to backfill.")
        return 0

    by_ext = {g["ext_id"]: g for g in games}
    dates = sorted({g["game_date"] for g in games})
    print(f"[{code}] {len(games)} game(s) across {len(dates)} date(s)")

    # ext_id -> 'OT'/'SO', only for games that ended past regulation.
    endings: dict[str, str] = {}
    seen: set[str] = set()
    for i, day in enumerate(dates, 1):
        events = espn.get_scoreboard(sport, league, day.replace("-", ""))
        if not events:
            print(f"  WARNING [{code}] empty scoreboard for {day}")
            continue
        for ev in events:
            ext = str(ev.get("id", ""))
            if ext not in by_ext:
                continue
            seen.add(ext)
            end = _ending(ev)
            if end:
                endings[ext] = end
        if i % 25 == 0 or i == len(dates):
            print(f"  {i}/{len(dates)} dates scanned, "
                  f"{len(seen)} matched, {len(endings)} past regulation")

    unmatched = [e for e in by_ext if e not in seen]
    if unmatched:
        print(f"  WARNING [{code}] {len(unmatched)} game(s) never appeared on "
              f"their own scoreboard date; ot left unchanged. "
              f"First few: {unmatched[:5]}")

    # Only write real changes so a re-run is a no-op.
    updates = [(by_ext[ext]["id"], end) for ext, end in endings.items()
               if by_ext[ext].get("ot") != end]
    tally = defaultdict(int)
    for _, end in updates:
        tally[end] += 1
    print(f"[{code}] {len(endings)} past-regulation game(s) "
          f"({dict(tally)} changed, {len(updates)} write(s))")

    if dry_run or not updates:
        return 0
    for game_id, end in updates:
        supabase.table("games").update({"ot": end}).eq("id", game_id).execute()
    return len(updates)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill games.ot from ESPN scoreboards")
    parser.add_argument("--league", choices=sorted(LEAGUES), action="append",
                        help="Limit to one league (repeatable). Default: all.")
    parser.add_argument("--season", type=int, help="Limit to one season")
    parser.add_argument("--dry-run", action="store_true",
                        help="Scan and report without writing")
    args = parser.parse_args()

    total = 0
    for code in (args.league or sorted(LEAGUES)):
        total += backfill(code, args.season, dry_run=args.dry_run)
    print(f"\nDone — {total} game row(s) updated"
          f"{' (dry-run: none written)' if args.dry_run else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
