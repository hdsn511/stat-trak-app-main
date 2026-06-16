"""
analytics/batch/prune_picks.py

One-time cleanup: bring historical MLB pick_results into line with the current
pick-generation rules, so the tracker / Track page never shows picks the model
would no longer make.

Re-applies the new admission logic to every pick generated BEFORE the new rules
went live (game_date < NEW_RULES_DATE):
  - totals: disabled  -> delete
  - implied_prob < 0.47 (market-price floor) -> delete
  - player props: re-score with the empirical calibration; delete if it fails
    score()'s gates / MIN_CONFIDENCE / MIN_EDGE on the CALIBRATED edge
  - spreads: market-shrink edge < 0.07 -> delete
  - survivors are UPDATED so their stored hit_rate/edge are the calibrated values
    (so old + new picks are measured on the same footing)

Picks from NEW_RULES_DATE onward were already generated under the new rules and
are left untouched.

Dry-run by default. Pass --apply to mutate.

CLI:
    python -m analytics.batch.prune_picks            # dry-run summary
    python -m analytics.batch.prune_picks --apply
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict

from analytics.db.connection import supabase, MLB_LEAGUE_ID
from analytics.engine.scorer import score, MIN_EDGE
from analytics.engine.calibration import apply_calibration

NEW_RULES_DATE = "2026-06-15"
MIN_IMPLIED_PROB = 0.47   # market-price floor (matches generate_mlb)
MIN_CONFIDENCE = 55       # matches generate_mlb
GAME_MIN_EDGE = 0.07      # matches generate_mlb game-prop gate
GAME_MAX_IMPLIED = 0.92


def evaluate(p: dict) -> tuple[bool, float | None, float | None]:
    """Return (keep, calibrated_prob, calibrated_edge) under the new rules."""
    pt = p.get("prop_type")
    implied = p.get("implied_prob")
    raw = p.get("hit_rate")
    stat = (p.get("stat") or "").lower()
    if pt == "total":
        return False, None, None
    if implied is None or raw is None or implied < MIN_IMPLIED_PROB:
        return False, None, None
    if pt == "player":
        cal = apply_calibration(stat, raw)
        sc = score(
            hit_rate=raw, sample_size=p.get("sample_size") or 0,
            conditions_matched=p.get("conditions_matched") or 0,
            total_conditions=p.get("total_conditions") or 5,
            implied_prob=implied, days_rest=3, stat=stat, calibrated_prob=cal,
        )
        if "reason" in sc or sc["confidence"] < MIN_CONFIDENCE or sc["edge"] < MIN_EDGE:
            return False, None, None
        return True, round(cal, 4), sc["edge"]
    if pt == "spread":
        if implied > GAME_MAX_IMPLIED:
            return False, None, None
        cal = 0.5 * raw + 0.5 * implied
        edge = cal - implied
        if edge < GAME_MIN_EDGE:
            return False, None, None
        return True, round(cal, 4), round(edge, 4)
    return False, None, None


def run(apply: bool) -> None:
    picks = (supabase.table("pick_results")
             .select("id,game_date,prop_type,stat,hit_rate,implied_prob,edge,"
                     "sample_size,conditions_matched,total_conditions")
             .eq("league_id", MLB_LEAGUE_ID)
             .lt("game_date", NEW_RULES_DATE)
             .execute()).data or []
    print(f"Evaluating {len(picks)} pre-{NEW_RULES_DATE} MLB picks against new rules "
          f"({'APPLY' if apply else 'DRY-RUN'})\n")

    del_by: dict[str, int] = defaultdict(int)
    upd = 0
    to_delete: list[int] = []
    to_update: list[tuple[int, float, float]] = []
    for p in picks:
        keep, cal, edge = evaluate(p)
        if not keep:
            reason = "total" if p["prop_type"] == "total" else (
                "implied<0.47" if (p.get("implied_prob") or 0) < MIN_IMPLIED_PROB else "edge/gate")
            del_by[f"{p['prop_type']}:{reason}"] += 1
            to_delete.append(p["id"])
        else:
            to_update.append((p["id"], cal, edge))
            upd += 1

    print(f"  DELETE {len(to_delete)} picks:")
    for k in sorted(del_by):
        print(f"    {k:24} {del_by[k]}")
    print(f"  KEEP + recalibrate {upd} picks\n")

    if not apply:
        print("  dry-run — nothing changed. Re-run with --apply to commit.")
        return

    for pid in to_delete:
        supabase.table("pick_results").delete().eq("id", pid).execute()
    for pid, cal, edge in to_update:
        supabase.table("pick_results").update({"hit_rate": cal, "edge": edge}).eq("id", pid).execute()
    print(f"  Applied: deleted {len(to_delete)}, recalibrated {upd}.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Prune historical MLB picks to current rules")
    ap.add_argument("--apply", action="store_true", help="commit changes (default: dry-run)")
    args = ap.parse_args()
    run(args.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
