"""
analytics/engine/prop_context.py

Context model for player props: how often does a priced side hit, given the price and
what the player's recent games say about it? The book is treated as accurate, so the
price is the anchor; context decides which priced sides we believe in.

Features are side-aligned, so a positive value always argues for the side being priced:
    z20_s   (last-20 average - line) / spread, signed toward the side
    z5_s    same over the last 5 games
    zlast_s same for the most recent game
    hit10_s share of the last 10 games that cleared the line on this side
    opp_s   opponent allowed vs league (season to date), signed toward the side
    b2b     player's previous game was the day before
    is_over, stat one-hot, and lp = logit(price)
spread = max(20-game sd, sqrt(20-game mean)), so low-count stats don't produce huge z.

The same context() runs in the fit and live, so the backtest measures what ships.

Backtest evidence (2026-11-02, ESPN main lines with a known price): form supporting the
side is the strongest context signal; NBA z20_s >= 0.8 hit 63% at a 57% average price,
form against the side hit 49%. Decision trees mined from these features overfit, so the
model is a ridge logistic on a handful of features.

CLI:
    python -m analytics.engine.prop_context --fit --league nba
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from analytics.engine.prop_model import SPEC, History, _paged, expit, logit

MODEL_PATH = Path(__file__).with_name("prop_context.json")
BAND = (0.50, 0.70)     # priced sides we consider: straights between even and -233
BELIEF_Z = 0.5          # z20_s at or above this = recent form supports the side
HOLD = 0.045            # book margin, to price the under from the over in history
MIN_GAMES = 5
BASE_FEATURES = ["lp", "z20_s", "z5_s", "zlast_s", "hit10_s", "opp_s", "b2b", "is_over"]


def features(league: str) -> list[str]:
    return BASE_FEATURES + [f"is_{s}" for s in sorted(SPEC[league]["stats"])]


def context(hist: History, player_id: int, stat: str, line: float, as_of: str,
            opp_id: Optional[int], season: int) -> Optional[dict]:
    """Unsided, point-in-time context for one player-stat-line. None = too little history."""
    p = hist.by_player.get(player_id)
    if p is None:
        return None
    col = hist.s["stats"][stat]
    h = p[p.game_date < as_of].dropna(subset=[col]).tail(20)
    if len(h) < MIN_GAMES:
        return None
    vals = h[col].to_numpy(dtype=float)
    m20, m5, last = float(vals.mean()), float(vals[-5:].mean()), float(vals[-1])
    spread = max(float(vals.std(ddof=1)) if len(vals) > 1 else 0.0, math.sqrt(max(m20, 0.25)))
    days = (pd.Timestamp(as_of) - pd.Timestamp(h.game_date.iloc[-1])).days
    return {
        "z20": (m20 - line) / spread, "z5": (m5 - line) / spread, "zlast": (last - line) / spread,
        "hit10": float((vals[-10:] > line).mean()),
        "opp": hist.opp_factor(stat, opp_id, as_of, season) - 1.0 if opp_id else 0.0,
        "b2b": float(days <= 1),
        "avg20": round(m20, 2), "avg5": round(m5, 2), "last": last, "n": len(vals),
    }


def sided(league: str, ctx: dict, stat: str, side: str, price: float) -> dict:
    sg = 1.0 if side == "over" else -1.0
    f = {"lp": logit(price), "z20_s": sg * ctx["z20"], "z5_s": sg * ctx["z5"], "zlast_s": sg * ctx["zlast"],
         "hit10_s": ctx["hit10"] if sg > 0 else 1.0 - ctx["hit10"], "opp_s": sg * ctx["opp"],
         "b2b": ctx["b2b"], "is_over": float(sg > 0)}
    for s in SPEC[league]["stats"]:
        f[f"is_{s}"] = float(s == stat)
    return f


def _fit_ridge(X: np.ndarray, y: np.ndarray, l2: float = 2.0) -> np.ndarray:
    """Ridge logistic regression by Newton's method; X already standardised, no penalty on the intercept."""
    X = np.column_stack([np.ones(len(X)), X])
    w = np.zeros(X.shape[1])
    pen = np.full(X.shape[1], l2)
    pen[0] = 0.0
    for _ in range(50):
        p = 1 / (1 + np.exp(-X @ w))
        g = X.T @ (y - p) - pen * w
        H = (X * (p * (1 - p))[:, None]).T @ X + np.diag(pen)
        step = np.linalg.solve(H, g)
        w += step
        if np.abs(step).sum() < 1e-8:
            break
    return w


class HitModel:
    def __init__(self, league: str, params: Optional[dict] = None):
        self.league = league
        self.p = params or json.loads(MODEL_PATH.read_text())[league]

    def prob(self, f: dict) -> float:
        x = np.array([(f[k] - self.p["mean"][k]) / self.p["std"][k] for k in self.p["features"]])
        return float(expit(self.p["w"][0] + float(np.dot(self.p["w"][1:], x))))


def _train(league: str, rows: pd.DataFrame) -> dict:
    feats = features(league)
    mean = rows[feats].mean()
    std = rows[feats].std().replace(0, 1.0)
    w = _fit_ridge(((rows[feats] - mean) / std).to_numpy(), rows.hit.to_numpy(dtype=float))
    return {"features": feats, "mean": mean.to_dict(), "std": std.to_dict(), "w": w.tolist(), "n": len(rows)}


def build_rows(league: str, hist: Optional[History] = None) -> pd.DataFrame:
    """Side-level history: every main line with a known price, both sides, priced in BAND."""
    s = SPEC[league]
    hist = hist or History(league)
    lines = pd.DataFrame(_paged("espn_prop_lines", "game_id,player_id,stat,line,over_odds", "game_id",
                                league_id=s["league_id"], is_main=True))
    lines = lines.dropna(subset=["over_odds"])
    lines = lines[lines.stat.isin(s["stats"])].drop_duplicates(["game_id", "player_id", "stat"])
    lines["line"] = lines.line.astype(float)
    a = hist.df[["game_id", "player_id", "game_date", "season", "opp_id"] + list(set(s["stats"].values()))]
    m = lines.merge(a, on=["game_id", "player_id"])
    out = []
    for r in m.to_dict("records"):
        actual = r[s["stats"][r["stat"]]]
        if actual is None or pd.isna(actual) or float(actual) == r["line"]:
            continue
        ctx = context(hist, r["player_id"], r["stat"], r["line"], r["game_date"], r["opp_id"], r["season"])
        if not ctx:
            continue
        o = float(r["over_odds"])
        over_p = 100 / (o + 100) if o > 0 else -o / (-o + 100)
        for side, price in (("over", over_p), ("under", min(max(1 + HOLD - over_p, 0.05), 0.95))):
            if not BAND[0] <= price <= BAND[1]:
                continue
            f = sided(league, ctx, r["stat"], side, price)
            hit = float(actual) > r["line"] if side == "over" else float(actual) < r["line"]
            out.append({**f, "hit": int(hit), "price": price, "date": r["game_date"], "game_id": r["game_id"],
                        "player_id": r["player_id"], "stat": r["stat"], "side": side})
    return pd.DataFrame(out)


def _best3(d: pd.DataFrame, key: str) -> pd.DataFrame:
    d = d.sort_values(key, ascending=False).drop_duplicates(["game_id", "player_id", "stat"])
    return d.drop_duplicates(["date", "game_id"]).groupby("date").head(3)


def fit(league: str) -> dict:
    rows = build_rows(league)
    dates = sorted(rows.date.unique())
    cut = dates[int(len(dates) * 0.6)]
    tr, te = rows[rows.date < cut], rows[rows.date >= cut].copy()
    hm = HitModel(league, _train(league, tr))
    te["p"] = [hm.prob(f) for f in te[features(league)].to_dict("records")]
    believed = te[te.z20_s >= BELIEF_Z]
    report = {"split": cut, "n_train": len(tr), "n_test": len(te),
              "test_hit": float(te.hit.mean()), "test_price": float(te.price.mean())}
    for name, d in (("best3_book_only", _best3(te, "price")), ("best3_model", _best3(te, "p")),
                    ("best3_model_belief", _best3(believed, "p"))):
        report[name] = {"n": len(d), "hit": round(float(d.hit.mean()), 3), "price": round(float(d.price.mean()), 3)}
    for lo, hi in ((0.5, 0.55), (0.55, 0.6), (0.6, 0.65), (0.65, 1.0)):
        d = te[(te.p >= lo) & (te.p < hi)]
        if len(d):
            report[f"calib_{lo:.2f}"] = {"n": len(d), "pred": round(float(d.p.mean()), 3), "hit": round(float(d.hit.mean()), 3)}
    print(f"[{league}] {len(rows)} priced sides; walk-forward split {cut}")
    print(json.dumps(report, indent=2))
    final = _train(league, rows)       # ship the model fit on everything
    final["report"] = report
    wts = dict(zip(final["features"], final["w"][1:]))
    print("  weights (per sd): " + ", ".join(f"{k} {v:+.2f}" for k, v in sorted(wts.items(), key=lambda kv: -abs(kv[1]))))
    allp = json.loads(MODEL_PATH.read_text()) if MODEL_PATH.exists() else {}
    allp[league] = final
    MODEL_PATH.write_text(json.dumps(allp, indent=2))
    return final


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fit", action="store_true")
    ap.add_argument("--league", choices=sorted(SPEC), required=True)
    args = ap.parse_args()
    if args.fit:
        fit(args.league)
    sys.exit(0)
