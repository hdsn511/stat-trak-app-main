"""
analytics/batch/backfill_positions.py

Fills players.position for ESPN-backed players who have box-score rows but no
position.

refresh_positions.py reads current team rosters, which by construction cannot
see a player who has since retired, been released, or gone unsigned. Those
players still appeared in games all season and still carry stat rows, so they
surface on trending and streak modules with a blank position chip. After the
2025 NFL season that was 235 players — including Stefon Diggs (1,123 yds),
Keenan Allen, Nick Chubb and Kareem Hunt.

Two passes, most authoritative first:
  1. ESPN's per-athlete endpoint, which resolves unrostered players.
  2. A stat-profile inference for anyone ESPN cannot resolve, derived from what
     the player actually did on the field. Inferred values are marked in the
     log so they are never mistaken for source data.

Only players with at least one stat row are touched — an unplayed roster entry
with no position is not a data gap worth an API call.

Usage:
    python -m analytics.batch.backfill_positions
    python -m analytics.batch.backfill_positions --league nfl --dry-run
    python -m analytics.batch.backfill_positions --no-infer
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from typing import Callable, Optional

from analytics.data.espn import client as espn
from analytics.db.connection import NFL_LEAGUE_ID, NHL_LEAGUE_ID, supabase

PAGE = 1000


def _nfl_infer(totals: dict[str, float]) -> Optional[str]:
    """Coarse position from a season stat profile. Deliberately conservative:
    it returns a unit, not a depth-chart slot, and None when nothing dominates."""
    if totals.get("attempts", 0) >= 10:
        return "QB"
    if totals.get("fg_att", 0) > 0 or totals.get("xp_att", 0) > 0:
        return "K"
    carries = totals.get("carries", 0)
    targets = totals.get("targets", 0)
    tackles = totals.get("tackles_total", 0)
    if max(carries, targets, tackles) == 0:
        return None
    if tackles >= carries and tackles >= targets:
        return "DEF"
    if carries > targets:
        return "RB"
    return "WR"


@dataclass(frozen=True)
class PositionSpec:
    code: str
    league_id: int
    sport: str
    league: str
    stats_table: str
    # Columns the inference reads, summed across the player's rows.
    infer_columns: tuple[str, ...]
    infer: Callable[[dict[str, float]], Optional[str]]


SPECS: dict[str, PositionSpec] = {
    "nfl": PositionSpec(
        code="nfl",
        league_id=NFL_LEAGUE_ID,
        sport="football",
        league="nfl",
        stats_table="nfl_player_stats",
        infer_columns=("attempts", "carries", "targets", "tackles_total",
                       "fg_att", "xp_att"),
        infer=_nfl_infer,
    ),
    # NHL positions are currently complete; the spec is here so the job covers
    # the league the moment a gap appears.
    "nhl": PositionSpec(
        code="nhl",
        league_id=NHL_LEAGUE_ID,
        sport="hockey",
        league="nhl",
        stats_table="nhl_player_stats",
        infer_columns=(),
        infer=lambda _: None,
    ),
}


def _players_missing_position(spec: PositionSpec) -> list[dict]:
    rows: list[dict] = []
    page = 0
    while True:
        batch = (supabase.table("players").select("id,name,ext_id")
                 .eq("league_id", spec.league_id).is_("position", "null")
                 .range(page * PAGE, page * PAGE + PAGE - 1).execute()).data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        page += 1


def _stat_totals(spec: PositionSpec,
                 player_ids: list[int]) -> dict[int, dict[str, float]]:
    """Season totals per player for the inference columns."""
    if not spec.infer_columns or not player_ids:
        return {}
    cols = ",".join(("player_id",) + spec.infer_columns)
    totals: dict[int, dict[str, float]] = {}
    for i in range(0, len(player_ids), 200):
        chunk = player_ids[i:i + 200]
        page = 0
        while True:
            # Ordering must be total, not just non-empty: range() paging over a
            # result set with ties silently drops and repeats rows across pages.
            batch = (supabase.table(spec.stats_table).select(cols)
                     .in_("player_id", chunk)
                     .order("player_id").order("game_id")
                     .range(page * PAGE, page * PAGE + PAGE - 1).execute()).data or []
            for r in batch:
                acc = totals.setdefault(r["player_id"],
                                        {c: 0.0 for c in spec.infer_columns})
                for c in spec.infer_columns:
                    acc[c] += r.get(c) or 0
            if len(batch) < PAGE:
                break
            page += 1
    return totals


def backfill(code: str, dry_run: bool = False, allow_infer: bool = True) -> int:
    spec = SPECS[code]
    missing = _players_missing_position(spec)
    if not missing:
        print(f"[{code}] no players missing a position.")
        return 0

    totals = _stat_totals(spec, [p["id"] for p in missing])
    # A player with no stat rows never appeared; leave them alone.
    played = [p for p in missing if p["id"] in totals]
    print(f"[{code}] {len(missing)} player(s) without a position, "
          f"{len(played)} with stat rows")

    resolved: list[tuple[int, str, str, str]] = []  # (id, name, pos, source)
    unresolved: list[dict] = []
    for i, p in enumerate(played, 1):
        athlete = espn.get_athlete(spec.sport, spec.league, p["ext_id"]) \
            if p.get("ext_id") else None
        pos = ((athlete or {}).get("position") or {}).get("abbreviation")
        if pos:
            resolved.append((p["id"], p["name"], pos.strip(), "espn"))
        else:
            unresolved.append(p)
        if i % 50 == 0 or i == len(played):
            print(f"  {i}/{len(played)} looked up, {len(resolved)} resolved")

    if unresolved and allow_infer:
        for p in unresolved:
            pos = spec.infer(totals.get(p["id"], {}))
            if pos:
                resolved.append((p["id"], p["name"], pos, "inferred"))

    still_missing = len(played) - len(resolved)
    if still_missing:
        print(f"  WARNING [{code}] {still_missing} player(s) still have no "
              f"position after both passes.")

    by_source: dict[str, int] = {}
    for _, _, _, src in resolved:
        by_source[src] = by_source.get(src, 0) + 1
    print(f"[{code}] {len(resolved)} resolved {by_source}")

    if dry_run:
        for _, name, pos, src in resolved[:20]:
            print(f"    {name}: {pos} ({src})")
        if len(resolved) > 20:
            print(f"    ... and {len(resolved) - 20} more")
        return 0

    for player_id, _, pos, _ in resolved:
        (supabase.table("players").update({"position": pos})
         .eq("id", player_id).execute())
    return len(resolved)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill missing player positions from ESPN")
    parser.add_argument("--league", choices=sorted(SPECS), action="append",
                        help="Limit to one league (repeatable). Default: all.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Resolve and report without writing")
    parser.add_argument("--no-infer", action="store_true",
                        help="ESPN lookups only; skip stat-profile inference")
    args = parser.parse_args()

    total = 0
    for code in (args.league or sorted(SPECS)):
        total += backfill(code, dry_run=args.dry_run,
                          allow_infer=not args.no_infer)
    print(f"\nDone — {total} player position(s) updated"
          f"{' (dry-run: none written)' if args.dry_run else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
