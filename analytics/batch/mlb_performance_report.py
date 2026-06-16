"""
analytics/batch/mlb_performance_report.py

Automated forward performance + calibration tracker for the MLB pick model.

Runs daily (after reconcile) and reports, over trailing windows:
  MODEL   — settled record, hit rate vs the market-implied break-even (are we
            +EV?), and calibration gap (stored model prob vs realised hit rate).
  HEALTH  — box-score completeness (stat rows per final game; ~26-30 = healthy)
            and pick volume/settlement, so data-pipeline problems (e.g. the
            box-score ingestion gap that voids player picks) surface immediately.

This is intentionally read-only and dependency-light: it prints a report to
stdout (captured in CI logs). No schema changes.

CLI:
    python -m analytics.batch.mlb_performance_report
    python -m analytics.batch.mlb_performance_report --windows 7 30
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import date, timedelta

from analytics.db.connection import supabase, MLB_LEAGUE_ID

# Healthy MLB box score: ~9-13 batters + 4-5 pitchers per team -> ~26-32 rows/game.
HEALTHY_ROWS_PER_GAME = 24.0


def _fetch_settled(cutoff: str) -> list[dict]:
    return (supabase.table("pick_results")
            .select("game_date,prop_type,stat,pick_type,hit_rate,implied_prob,edge,did_hit")
            .eq("league_id", MLB_LEAGUE_ID)
            .gte("game_date", cutoff)
            .execute()).data or []


def _agg(rows: list[dict]) -> dict:
    settled = [r for r in rows if r.get("did_hit") is not None]
    n = len(settled)
    wins = sum(1 for r in settled if r["did_hit"])
    hit = wins / n if n else None
    # break-even = average price paid (market implied prob); +EV if hit > break-even
    mkt = sum((r.get("implied_prob") or 0) for r in settled) / n if n else None
    model = sum((r.get("hit_rate") or 0) for r in settled) / n if n else None
    return {
        "n": n, "wins": wins, "losses": n - wins,
        "hit_rate": hit, "break_even": mkt, "model_prob": model,
        "ev_gap": (hit - mkt) if (hit is not None and mkt is not None) else None,
        "calib_gap": (model - hit) if (model is not None and hit is not None) else None,
    }


def _fmt_pct(v) -> str:
    return f"{v*100:5.1f}%" if v is not None else "   — "


def _fmt_signed(v) -> str:
    return f"{v*100:+5.1f}" if v is not None else "  — "


def _report_model(rows: list[dict], window: int) -> None:
    print(f"\n── MODEL · last {window}d " + "─" * 40)
    overall = _agg(rows)
    if overall["n"] == 0:
        print("  no settled picks in window")
        return
    print(f"  {'segment':16} {'n':>3} {'W-L':>7} {'hit':>6} {'breakeven':>9} {'EV gap':>7} {'calib gap':>9}")

    def line(label: str, a: dict) -> None:
        wl = f"{a['wins']}-{a['losses']}"
        print(f"  {label:16} {a['n']:>3} {wl:>7} {_fmt_pct(a['hit_rate'])} "
              f"{_fmt_pct(a['break_even'])} {_fmt_signed(a['ev_gap']):>7} {_fmt_signed(a['calib_gap']):>9}")

    line("OVERALL", overall)
    by_type: dict[str, list] = defaultdict(list)
    for r in rows:
        by_type[r.get("prop_type") or "?"].append(r)
    for pt in sorted(by_type):
        line(pt, _agg(by_type[pt]))
    # player props by stat
    by_stat: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.get("prop_type") == "player":
            by_stat[r.get("stat") or "?"].append(r)
    for s in sorted(by_stat):
        a = _agg(by_stat[s])
        if a["n"]:
            line(f"  player:{s}", a)
    print("  (EV gap = hit − break-even; >0 is profitable. calib gap = model − actual; ~0 is calibrated.)")


def _report_health(days: int = 7) -> None:
    print(f"\n── PIPELINE HEALTH · last {days}d " + "─" * 32)
    today = date.today()
    cutoff = (today - timedelta(days=days)).isoformat()
    games = (supabase.table("games").select("id,game_date,status")
             .eq("league_id", MLB_LEAGUE_ID).gte("game_date", cutoff)
             .lt("game_date", today.isoformat()).execute()).data or []
    final_by_date: dict[str, list[int]] = defaultdict(list)
    for g in games:
        if g.get("status") == 2:
            final_by_date[g["game_date"]].append(g["id"])

    rows_by_date: dict[str, int] = defaultdict(int)
    page = 0
    while True:  # paginate — a week of box scores exceeds the 1000-row default
        batch = (supabase.table("mlb_player_stats").select("game_date")
                 .gte("game_date", cutoff).lt("game_date", today.isoformat())
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        for s in batch:
            rows_by_date[s["game_date"]] += 1
        if len(batch) < 1000:
            break
        page += 1

    print(f"  {'date':12} {'final_games':>11} {'stat_rows':>9} {'rows/game':>9}  health")
    for d in sorted(final_by_date):
        ng = len(final_by_date[d])
        nr = rows_by_date.get(d, 0)
        rpg = nr / ng if ng else 0
        flag = "OK" if rpg >= HEALTHY_ROWS_PER_GAME else "LOW — box scores under-ingested (voids player picks)"
        print(f"  {d:12} {ng:>11} {nr:>9} {rpg:>9.1f}  {flag}")


def _report_volume(rows: list[dict], days: int = 7) -> None:
    print(f"\n── PICK VOLUME · last {days}d " + "─" * 36)
    today = date.today()
    by_date_type: dict[tuple[str, str], int] = defaultdict(int)
    for r in rows:
        by_date_type[(r["game_date"], r.get("prop_type") or "?")] += 1
    dates = sorted({d for (d, _) in by_date_type})[-days:]
    types = ["player", "spread", "total"]
    print(f"  {'date':12} " + " ".join(f"{t:>7}" for t in types) + f"{'all':>7}")
    for d in dates:
        counts = [by_date_type.get((d, t), 0) for t in types]
        print(f"  {d:12} " + " ".join(f"{c:>7}" for c in counts) + f"{sum(counts):>7}")
    print("  (player volume collapsing to ~0 = over-filtering OR void-from-ingestion; cross-check HEALTH.)")


def run(windows: list[int]) -> None:
    print("=" * 72)
    print(f"MLB Performance + Calibration Report  |  {date.today().isoformat()}")
    print("=" * 72)
    longest = max(windows)
    cutoff = (date.today() - timedelta(days=longest)).isoformat()
    rows = _fetch_settled(cutoff)
    for w in sorted(windows):
        wcut = (date.today() - timedelta(days=w)).isoformat()
        _report_model([r for r in rows if r["game_date"] >= wcut], w)
    _report_volume(rows, days=min(10, longest))
    _report_health(days=7)
    print("\n" + "=" * 72)


def main() -> int:
    ap = argparse.ArgumentParser(description="MLB performance + calibration tracker")
    ap.add_argument("--windows", type=int, nargs="+", default=[7, 30])
    args = ap.parse_args()
    run(args.windows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
