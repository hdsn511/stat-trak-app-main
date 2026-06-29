"""
analytics/engine/validate_game_lines.py

Validation-only diagnostic — does NOT change pick generation.

Measures how well the MLB game model's probabilities match reality, out-of-sample
(test split = games on/after TRAIN_END, which the frozen margin model never saw):

  • WINNER  — Φ(mu/σ) vs actual home win (sanity check the model still works).
  • SPREAD  — for each run line L in -3.5..+3.5, cover_prob(mu,σ,L) vs P(margin > L).
              Negative L = the underdog +line the user asked about (e.g. home +2.5).
  • TOTAL   — fits a transparent pitcher-aware run projection on the train split
              (total ~ recent team offense + opposing-starter RA9), then checks
              its calibration + correlation OOS, to re-test the "no edge" finding
              before anyone re-enables totals.

Calibration alone is not edge — a model that perfectly matches the market makes no
money. This tells us whether the probabilities are TRUSTWORTHY (esp. at the tails);
the next step, if a line bucket calibrates, is to compare against stored Kalshi
implied probs going forward.

Usage:
    python -m analytics.engine.validate_game_lines [--start 2024-01-01]
"""
from __future__ import annotations

import argparse
import sys
from typing import Optional

import numpy as np

from analytics.db.connection import supabase, MLB_LEAGUE_ID
from analytics.engine.mlb_game_model import (
    _coef, _norm_cdf, RDIFF_WINDOW, STARTER_STARTS, MIN_STARTER_STARTS, TRAIN_END,
)

SPREAD_LINES = [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5]
TOTAL_LINES = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5]


def _page(table: str, cols: str, start: str, extra=None):
    import pandas as pd
    rows, p = [], 0
    while True:
        q = supabase.table(table).select(cols).gte("game_date", start)
        if extra:
            q = extra(q)
        batch = q.range(p * 1000, p * 1000 + 999).execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        p += 1
    return pd.DataFrame(rows)


def _build(start: str):
    """Per-game point-in-time features + actual margin/total. Mirrors the model's
    own feature build (shift(1) rolling = strictly prior games, no leakage)."""
    import pandas as pd

    games = _page("games", "id,game_date,home_team_id,away_team_id,home_score,away_score",
                  start, lambda q: q.eq("league_id", MLB_LEAGUE_ID).not_.is_("home_score", "null"))
    stats = _page("mlb_player_stats",
                  "game_id,team_id,player_id,game_date,batters_faced,earned_runs,outs_pitched", start)
    if games.empty or stats.empty:
        return pd.DataFrame()

    # Team-game runs scored/allowed, then prior-window rolling means.
    home = games.rename(columns={"home_team_id": "team_id", "home_score": "rs", "away_score": "ra"})[
        ["id", "game_date", "team_id", "rs", "ra"]]
    away = games.rename(columns={"away_team_id": "team_id", "away_score": "rs", "home_score": "ra"})[
        ["id", "game_date", "team_id", "rs", "ra"]]
    tg = pd.concat([home, away], ignore_index=True)
    tg["rd"] = tg["rs"] - tg["ra"]
    tg = tg.sort_values(["team_id", "game_date"])
    grp = tg.groupby("team_id")
    tg["rdiff"] = grp["rd"].transform(lambda s: s.shift(1).rolling(RDIFF_WINDOW, min_periods=5).mean())
    tg["rs_recent"] = grp["rs"].transform(lambda s: s.shift(1).rolling(RDIFF_WINDOW, min_periods=5).mean())
    rdiff = tg.set_index(["id", "team_id"])["rdiff"]
    rs_recent = tg.set_index(["id", "team_id"])["rs_recent"]

    # Starter recent RA9 (prior STARTER_STARTS starts; starter = max batters_faced).
    stats = stats[stats["batters_faced"] > 0].copy()
    stats["rk"] = stats.groupby(["game_id", "team_id"])["batters_faced"].rank(method="first", ascending=False)
    st = stats[stats["rk"] == 1].sort_values(["player_id", "game_date"]).copy()
    er = st.groupby("player_id")["earned_runs"].transform(
        lambda s: s.shift(1).rolling(STARTER_STARTS, min_periods=MIN_STARTER_STARTS).sum())
    outs = st.groupby("player_id")["outs_pitched"].transform(
        lambda s: s.shift(1).rolling(STARTER_STARTS, min_periods=MIN_STARTER_STARTS).sum())
    st["ra9"] = np.where(outs > 0, er / outs * 27.0, np.nan)
    sra9 = st.set_index(["game_id", "team_id"])["ra9"]

    rows = []
    for _, g in games.iterrows():
        gid, h, a = g["id"], g["home_team_id"], g["away_team_id"]
        try:
            hr, ar = rdiff.loc[(gid, h)], rdiff.loc[(gid, a)]
            hra9, ara9 = sra9.loc[(gid, h)], sra9.loc[(gid, a)]
            hrs, ars = rs_recent.loc[(gid, h)], rs_recent.loc[(gid, a)]
        except KeyError:
            continue
        if any(pd.isna(v) for v in (hr, ar, hra9, ara9, hrs, ars)):
            continue
        rows.append({
            "margin": g["home_score"] - g["away_score"],
            "total": g["home_score"] + g["away_score"],
            "x1": hr - ar,
            "x2": ara9 - hra9,
            "off": hrs + ars,            # combined recent offense
            "pit": hra9 + ara9,          # combined starter run-allowance
            "train": g["game_date"] < TRAIN_END,
        })
    return pd.DataFrame(rows)


def _calib(pred: np.ndarray, actual: np.ndarray, nbuckets: int = 10) -> None:
    """Print a calibration table (predicted prob vs realized rate) + Brier skill."""
    pred, actual = np.asarray(pred, float), np.asarray(actual, float)
    brier = float(np.mean((pred - actual) ** 2))
    base = float(np.mean((actual.mean() - actual) ** 2)) or 1e-9
    print(f"    Brier {brier:.4f} vs base-rate {base:.4f}  ({(base - brier) / base * 100:+.1f}% skill)")
    order = np.argsort(pred)
    print(f"    {'bucket':<7}{'n':>6}{'pred':>8}{'actual':>8}{'gap':>8}")
    for b in range(nbuckets):
        idx = order[b * len(order) // nbuckets:(b + 1) * len(order) // nbuckets]
        if len(idx) == 0:
            continue
        p, a = pred[idx].mean(), actual[idx].mean()
        print(f"    {b:<7}{len(idx):>6}{p:>8.3f}{a:>8.3f}{a - p:>+8.3f}")


def _per_line(mu: np.ndarray, outcomes: np.ndarray, sigma: float, lines, kind: str) -> None:
    """For each line: model mean prob, realized rate, and gap. `kind` is just the
    label; outcomes is the actual continuous quantity (margin or total)."""
    print(f"    {'line':>6}{'n':>7}{'pred':>8}{'actual':>8}{'gap':>8}")
    for L in lines:
        pred = np.array([_norm_cdf((m - L) / sigma) for m in mu])
        act = (outcomes > L).astype(float)
        print(f"    {L:>6.1f}{len(act):>7}{pred.mean():>8.3f}{act.mean():>8.3f}{act.mean() - pred.mean():>+8.3f}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate MLB game-line calibration (read-only)")
    ap.add_argument("--start", default="2024-01-01", help="earliest game_date to load")
    args = ap.parse_args()

    coef = _coef()
    if not coef:
        print("ERROR: no frozen mlb_game_model.json — run `python -m analytics.engine.mlb_game_model --fit` first.")
        return 1

    print("=" * 70)
    print(f"MLB game-line calibration  |  loaded from {args.start}  |  OOS = on/after {TRAIN_END}")
    print("=" * 70)
    df = _build(args.start)
    if df.empty:
        print("No games with complete features.")
        return 1
    te = df[~df["train"]].reset_index(drop=True)
    print(f"  {len(df)} games with features  ·  {len(te)} out-of-sample (test)")
    if len(te) < 50:
        print("  WARNING: small OOS sample — calibration estimates are noisy.")

    b0, b1, b2, sigma = coef["b0"], coef["b1"], coef["b2"], coef["sigma"]
    mu = (b0 + b1 * te["x1"] + b2 * te["x2"]).to_numpy()
    margin = te["margin"].to_numpy()
    total = te["total"].to_numpy()

    # ── WINNER ───────────────────────────────────────────────────────────────
    print("\n[WINNER] model win-prob vs actual")
    wp = np.array([_norm_cdf(m / sigma) for m in mu])
    _calib(wp, (margin > 0).astype(float))

    # ── SPREAD (incl. underdog + lines) ────────────────────────────────────────
    print("\n[SPREAD] cover_prob(home, L) vs P(margin > L)   — negative L = home +line (underdog)")
    _per_line(mu, margin, sigma, SPREAD_LINES, "spread")
    # Pooled calibration across all spread lines (does the model's prob mean what
    # it says, regardless of line?).
    all_pred, all_act = [], []
    for L in SPREAD_LINES:
        all_pred.extend(_norm_cdf((m - L) / sigma) for m in mu)
        all_act.extend((margin > L).astype(float))
    print("  pooled spread calibration:")
    _calib(np.array(all_pred), np.array(all_act))

    # ── TOTAL (re-test) ────────────────────────────────────────────────────────
    print("\n[TOTAL] pitcher-aware run projection (fit on train, validated OOS)")
    tr = df[df["train"]]
    Xtr = np.column_stack([np.ones(len(tr)), tr["off"], tr["pit"]])
    bt, *_ = np.linalg.lstsq(Xtr, tr["total"].to_numpy(float), rcond=None)
    sig_t = float((tr["total"].to_numpy(float) - Xtr @ bt).std())
    mu_t = (bt[0] + bt[1] * te["off"] + bt[2] * te["pit"]).to_numpy()
    corr = float(np.corrcoef(mu_t, total)[0, 1]) if len(te) > 2 else float("nan")
    print(f"    total = {bt[0]:.2f} + {bt[1]:.3f}*offense + {bt[2]:.3f}*starters   sigma={sig_t:.2f}")
    print(f"    OOS corr(predicted_total, actual_total) = {corr:.3f}   "
          f"(prior finding ~0.08-0.10 = effectively no signal)")
    _per_line(mu_t, total, sig_t, TOTAL_LINES, "total")
    all_pred, all_act = [], []
    for L in TOTAL_LINES:
        all_pred.extend(_norm_cdf((m - L) / sig_t) for m in mu_t)
        all_act.extend((total > L).astype(float))
    print("  pooled total calibration:")
    _calib(np.array(all_pred), np.array(all_act))

    print("\n" + "=" * 70)
    print("Read the per-line gap column: |gap| small across ALL lines (incl. ±2.5/±3.5)")
    print("=> probabilities trustworthy at the tails. Large/structured gap => don't trust.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
