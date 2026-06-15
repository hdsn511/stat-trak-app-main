"""
analytics/engine/calibration.py

Empirical probability calibration for the MLB pick model.

The backtest hit rate over-extrapolates recent form: across ~86k batter-games a
0.82 prediction realises only ~0.66, and a 0.22 prediction realises ~0.43 — the
model is too extreme at both ends and bets hardest on its most-extrapolated
predictions, manufacturing false edge. This module fits a monotonic
predicted->actual calibration curve PER STAT from point-in-time historical
predictions, so the model's probabilities (and the edge it computes vs the
market) are unbiased.

Method
------
For each stat + a set of lines, reconstruct the model's point-in-time prediction
(trailing recency hit rate over the prior WINDOW games, computed from PRIOR games
only — a faithful proxy for backtest_player's recency-weighted hit rate) and the
actual outcome. Fit isotonic (PAV) predicted->actual on a TRAIN split, evaluate
out-of-sample Brier on a TEST split, and persist the curves.

NOTE: v1 fits on the recency-rate proxy, not backtest_player's exact (condition-
matched) output. The map transfers because both measure the same recency signal;
re-fit on accumulated live pick_results once enough have settled.

CLI
---
    python -m analytics.engine.calibration --fit       # fit + write curves + report
    python -m analytics.engine.calibration --show      # print stored curves

Runtime
-------
    from analytics.engine.calibration import apply_calibration
    apply_calibration("hits", 0.82)  -> ~0.66
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from analytics.db.connection import supabase

CURVES_PATH = Path(__file__).with_name("calibration_curves.json")

WINDOW = 20          # trailing games for the recency prediction
MIN_PRIOR = 10       # need at least this many prior games to predict
TRAIN_END = "2026-01-01"   # train < this, test >= this (out-of-sample)
N_BINS = 15
HIST_START = "2024-01-01"

# stat key (as used by generate_mlb / MLB_STAT_COLUMN_MAP) ->
#   (stats column, opportunity column, candidate lines spanning the prob range)
STAT_SPEC: dict[str, tuple[str, str, list[float]]] = {
    "hits": ("hits", "plate_appearances", [0.5, 1.5, 2.5]),
    "tb":   ("total_bases", "plate_appearances", [0.5, 1.5, 2.5, 3.5]),
    "rbi":  ("rbi", "plate_appearances", [0.5, 1.5, 2.5]),
    "runs": ("runs", "plate_appearances", [0.5, 1.5]),
    "hr":   ("home_runs", "plate_appearances", [0.5, 1.5]),
    "ks":   ("strikeouts_pitched", "batters_faced", [3.5, 4.5, 5.5, 6.5, 7.5]),
}

_CURVES_CACHE: Optional[dict] = None


# ── PAV isotonic ─────────────────────────────────────────────────────────────────

def _pav_expand(y: np.ndarray, w: np.ndarray) -> np.ndarray:
    """PAV returning a value per input point (monotonic non-decreasing)."""
    n = len(y)
    # each block: (weighted_sum, weight, start, end)
    blocks = [[y[i] * w[i], w[i], i, i] for i in range(n)]
    i = 0
    while i < len(blocks) - 1:
        a, b = blocks[i], blocks[i + 1]
        if a[0] / a[1] > b[0] / b[1] + 1e-12:
            blocks[i] = [a[0] + b[0], a[1] + b[1], a[2], b[3]]
            del blocks[i + 1]
            if i > 0:
                i -= 1
        else:
            i += 1
    out = np.empty(n)
    for ws, wt, s, e in blocks:
        out[s:e + 1] = ws / wt
    return out


# ── Data ─────────────────────────────────────────────────────────────────────────

def _load_stats() -> pd.DataFrame:
    cols = ("player_id,game_date,plate_appearances,batters_faced,"
            "hits,total_bases,rbi,runs,home_runs,strikeouts_pitched")
    rows: list[dict] = []
    page = 0
    while True:
        batch = (supabase.table("mlb_player_stats").select(cols)
                 .gte("game_date", HIST_START)
                 .order("game_date", desc=False)
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        page += 1
    df = pd.DataFrame(rows)
    print(f"  Loaded {len(df)} mlb_player_stats rows (>= {HIST_START}).")
    return df


def _pairs_for_stat(df: pd.DataFrame, stat: str) -> pd.DataFrame:
    """Point-in-time (predicted, actual, split) pairs for one stat across lines."""
    col, opp, lines = STAT_SPEC[stat]
    d = df[df[opp].fillna(0) > 0][["player_id", "game_date", col]].copy()
    d = d.sort_values(["player_id", "game_date"]).reset_index(drop=True)
    out = []
    for line in lines:
        hit = (d[col] > line).astype(float)
        g = hit.groupby(d["player_id"])
        pred = g.transform(lambda s: s.shift(1).rolling(WINDOW, min_periods=MIN_PRIOR).mean())
        sub = pd.DataFrame({"game_date": d["game_date"], "pred": pred, "actual": hit})
        sub = sub.dropna(subset=["pred"])
        out.append(sub)
    res = pd.concat(out, ignore_index=True)
    res["split"] = np.where(res["game_date"] < TRAIN_END, "train", "test")
    return res


def _fit_curve(pred: np.ndarray, actual: np.ndarray) -> tuple[list[float], list[float]]:
    """Quantile-bin then PAV → (x bin-centers, y calibrated rates), monotonic."""
    qs = np.unique(np.quantile(pred, np.linspace(0, 1, N_BINS + 1)))
    if len(qs) < 3:
        return [float(pred.mean())], [float(actual.mean())]
    idx = np.clip(np.digitize(pred, qs[1:-1]), 0, len(qs) - 2)
    centers, rates, ns = [], [], []
    for b in range(len(qs) - 1):
        m = idx == b
        if m.sum() == 0:
            continue
        centers.append(pred[m].mean()); rates.append(actual[m].mean()); ns.append(m.sum())
    centers = np.array(centers); rates = np.array(rates); ns = np.array(ns, float)
    cal = _pav_expand(rates, ns)
    return [round(float(x), 4) for x in centers], [round(float(y), 4) for y in cal]


def _brier(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


# ── Fit driver ─────────────────────────────────────────────────────────────────

def fit() -> None:
    df = _load_stats()
    curves: dict[str, dict] = {}
    print(f"\n{'stat':6} {'n_train':>8} {'n_test':>7} {'brier_before':>13} {'brier_after':>12} {'improve':>8}")
    for stat in STAT_SPEC:
        pairs = _pairs_for_stat(df, stat)
        tr = pairs[pairs["split"] == "train"]
        te = pairs[pairs["split"] == "test"]
        if len(tr) < 500:
            print(f"{stat:6} insufficient train ({len(tr)}) — skipped")
            continue
        x, y = _fit_curve(tr["pred"].to_numpy(), tr["actual"].to_numpy())
        curves[stat] = {"x": x, "y": y, "n_train": int(len(tr))}
        # out-of-sample Brier on test
        if len(te) > 200:
            p_raw = te["pred"].to_numpy()
            p_cal = np.interp(p_raw, x, y)
            b0, b1 = _brier(p_raw, te["actual"].to_numpy()), _brier(p_cal, te["actual"].to_numpy())
            imp = (b0 - b1) / b0 * 100 if b0 > 0 else 0.0
            print(f"{stat:6} {len(tr):>8} {len(te):>7} {b0:>13.4f} {b1:>12.4f} {imp:>7.1f}%")
        else:
            print(f"{stat:6} {len(tr):>8} {len(te):>7}   (test too small for OOS Brier)")
    CURVES_PATH.write_text(json.dumps(curves, indent=2))
    print(f"\n  Wrote {len(curves)} calibration curves -> {CURVES_PATH.name}")


# ── Runtime ──────────────────────────────────────────────────────────────────────

def _load_curves() -> dict:
    global _CURVES_CACHE
    if _CURVES_CACHE is None:
        try:
            _CURVES_CACHE = json.loads(CURVES_PATH.read_text())
        except FileNotFoundError:
            _CURVES_CACHE = {}
    return _CURVES_CACHE


def apply_calibration(stat: str, p: float) -> float:
    """Map a raw model probability to its calibrated value for `stat`.
    Falls back to the identity when no curve exists (e.g. NBA / unfit stat)."""
    c = _load_curves().get(stat)
    if not c or p is None:
        return p
    val = float(np.interp(p, c["x"], c["y"]))
    return max(0.0, min(1.0, val))


def main() -> int:
    ap = argparse.ArgumentParser(description="MLB probability calibration")
    ap.add_argument("--fit", action="store_true", help="fit curves from history + report OOS Brier")
    ap.add_argument("--show", action="store_true", help="print stored curves")
    args = ap.parse_args()
    if args.fit:
        fit()
    elif args.show:
        print(json.dumps(_load_curves(), indent=2))
    else:
        ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
