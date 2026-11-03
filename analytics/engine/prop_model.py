"""
analytics/engine/prop_model.py

Player prop probability model shared by NBA and NFL. The same estimator runs in
the backtest and live, so the calibration measures what actually ships (unlike a
proxy fit).

raw_over_prob: recency-weighted blend of the player's empirical over rate and a
Normal estimate from his weighted mean/sd, both adjusted by what the opponent has
allowed season-to-date (point in time).

Calibration is fit at sportsbook main lines from espn_prop_lines, where the market
is close to a coin flip, so the slope b measures how much the model adds beyond
the market:
    logit P(over) = a + b * logit(raw)                  (at a line priced ~50%)
Live, on a price m:
    logit P(over) = logit(m) + a + b * (logit(raw) - logit(m))
b near 0 means "trust the market", and edges vanish by construction.

CLI:
    python -m analytics.engine.prop_model --fit --league nfl
    python -m analytics.engine.prop_model --fit --league nba
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from analytics.db.connection import supabase

CURVES_PATH = Path(__file__).with_name("prop_calibration.json")
HIST_START = "2023-07-01"
MIN_STAT_FIT = 400      # below this a stat uses the pooled fit

SPEC = {
    "nba": {"league_id": 1, "table": "nba_player_stats", "decay": 0.97, "window": 40, "min_games": 10,
            "played": "minutes_played", "split": "2026-10-27",
            "stats": {"pts": "points", "reb": "rebounds", "ast": "assists", "fg3m": "three_points_made"}},
    "nfl": {"league_id": 3, "table": "nfl_player_stats", "decay": 0.92, "window": 24, "min_games": 6,
            "played": None, "split": "2025-07-01",
            "stats": {"payds": "passing_yards", "patd": "passing_tds", "ruyds": "rushing_yards",
                      "recyds": "receiving_yards", "rec": "receptions"}},
}


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def expit(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _exec(query):
    """Execute a read with retries: long pulls hit transient Supabase resets."""
    for attempt in range(5):
        try:
            return query.execute()
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def _paged(table: str, cols: str, order: str, gte: Optional[tuple] = None, **eq) -> list[dict]:
    out, page = [], 0
    while True:
        q = supabase.table(table).select(cols).order(order)
        for k, v in eq.items():
            q = q.eq(k, v)
        if gte:
            q = q.gte(*gte)
        b = _exec(q.range(page * 1000, page * 1000 + 999)).data or []
        out += b
        if len(b) < 1000:
            return out
        page += 1


def load_history(league: str) -> pd.DataFrame:
    """Final, non-preseason player rows joined to their game and opponent."""
    s = SPEC[league]
    cols = sorted(set(s["stats"].values()) | ({s["played"]} if s["played"] else set()))
    games = pd.DataFrame(_paged("games", "id,season,game_type,home_team_id,away_team_id,status",
                                "id", gte=("game_date", HIST_START), league_id=s["league_id"]))
    games = games[(games.status == 2) & (games.game_type != "preseason")]
    rows: list[dict] = []
    sel = "game_id,player_id,team_id,game_date," + ",".join(cols)
    # Page by game_id chunks: offset paging over a large stats table times out.
    ids = games.id.tolist()
    for i in range(0, len(ids), 40):
        chunk, page = ids[i:i + 40], 0
        while True:
            b = _exec(supabase.table(s["table"]).select(sel).in_("game_id", chunk)
                      .order("game_id").order("player_id").range(page, page + 999)).data or []
            rows += b
            if len(b) < 1000:
                break
            page += 1000
    df = pd.DataFrame(rows).drop_duplicates(["game_id", "player_id"])
    df = df.merge(games.rename(columns={"id": "game_id"}), on="game_id")
    df["opp_id"] = np.where(df.team_id == df.home_team_id, df.away_team_id, df.home_team_id)
    if s["played"]:
        df = df[df[s["played"]].fillna(0) > 0]
    return df.sort_values("game_date").reset_index(drop=True)


class History:
    """Point-in-time lookups over one league's stat history."""

    def __init__(self, league: str, df: Optional[pd.DataFrame] = None):
        self.league, self.s = league, SPEC[league]
        self.df = load_history(league) if df is None else df
        self.by_player = {k: v for k, v in self.df.groupby("player_id")}
        self.defense: dict[str, pd.DataFrame] = {}
        for stat, col in self.s["stats"].items():
            d = self.df.dropna(subset=[col]).groupby(["game_id", "opp_id", "game_date", "season"])[col].sum().reset_index()
            self.defense[stat] = d.rename(columns={col: "v"}).sort_values("game_date")

    def opp_factor(self, stat: str, opp_id: int, as_of: str, season: int) -> float:
        """Allowed by this opponent vs league, season to date, before as_of. Shrunk
        toward 1.0 because early-season samples are thin."""
        d = self.defense[stat]
        d = d[(d.season == season) & (d.game_date < as_of)]
        o = d[d.opp_id == opp_id]
        if o.empty or d.v.mean() <= 0:
            return 1.0
        n = len(o)
        return 1.0 + (o.v.mean() / d.v.mean() - 1.0) * (n / (n + 8.0))

    def raw_over_prob(self, player_id: int, stat: str, line: float, as_of: str,
                      opp_id: Optional[int], season: int) -> Optional[dict]:
        p = self.by_player.get(player_id)
        if p is None:
            return None
        col = self.s["stats"][stat]
        h = p[p.game_date < as_of].dropna(subset=[col]).tail(self.s["window"])
        if len(h) < self.s["min_games"]:
            return None
        # A player with no game in the current season has no current role evidence.
        if not (h.season == season).any() and self.league == "nba" and as_of[5:7] not in ("10", "11"):
            return None
        vals = h[col].to_numpy(dtype=float)
        wts = self.s["decay"] ** np.arange(len(vals) - 1, -1, -1)
        factor = self.opp_factor(stat, opp_id, as_of, season) if opp_id else 1.0
        vals = vals * factor
        emp = float(np.sum(wts * (vals > line)) / wts.sum())
        mean = float(np.sum(wts * vals) / wts.sum())
        var = float(np.sum(wts * (vals - mean) ** 2) / wts.sum())
        sd = max(math.sqrt(var), math.sqrt(max(mean, 0.25)))     # at least Poisson spread
        norm = 0.5 * (1 + math.erf((mean - line) / (sd * math.sqrt(2))))
        raw = min(max(0.5 * emp + 0.5 * norm, 0.02), 0.98)
        return {"raw": raw, "n": len(vals), "mean": round(mean, 2), "opp_factor": round(factor, 3)}


def _fit_logit(x: np.ndarray, y: np.ndarray, l2: float = 1.0) -> tuple[float, float]:
    """Ridge-penalised logistic regression (slope only) by Newton's method."""
    a, b = 0.0, 0.0
    for _ in range(30):
        p = 1 / (1 + np.exp(-(a + b * x)))
        w = np.clip(p * (1 - p), 1e-6, None)
        g = np.array([np.sum(y - p), np.sum((y - p) * x) - l2 * b])
        H = np.array([[w.sum(), (w * x).sum()], [(w * x).sum(), (w * x * x).sum() + l2]])
        da, db = np.linalg.solve(H, g)
        a, b = a + da, b + db
        if abs(da) + abs(db) < 1e-7:
            break
    return float(a), float(b)


def build_backtest(league: str) -> pd.DataFrame:
    s = SPEC[league]
    hist = History(league)
    lines = pd.DataFrame(_paged("espn_prop_lines", "game_id,player_id,stat,line", "game_id", league_id=s["league_id"], is_main=True))
    lines["line"] = lines.line.astype(float)
    a = hist.df[["game_id", "player_id", "game_date", "season", "opp_id"] + list(set(s["stats"].values()))]
    m = lines.merge(a, on=["game_id", "player_id"])
    out = []
    for r in m.to_dict("records"):
        actual = r[s["stats"][r["stat"]]]
        if actual is None or pd.isna(actual) or float(actual) == r["line"]:
            continue    # no stat row, or a push
        e = hist.raw_over_prob(r["player_id"], r["stat"], r["line"], r["game_date"], r["opp_id"], r["season"])
        if e:
            out.append({"stat": r["stat"], "date": r["game_date"], "raw": e["raw"], "y": int(float(actual) > r["line"])})
    return pd.DataFrame(out)


def fit(league: str) -> dict:
    s = SPEC[league]
    bt = build_backtest(league)
    bt["x"] = bt.raw.map(logit)
    tr, te = bt[bt.date < s["split"]], bt[bt.date >= s["split"]]
    print(f"[{league}] {len(bt)} prop-games at book lines: train {len(tr)} (<{s['split']}), test {len(te)}; "
          f"over rate train {tr.y.mean():.3f} test {te.y.mean():.3f}")
    curves = {"_pooled": dict(zip("ab", _fit_logit(tr.x.values, tr.y.values)), n=len(tr))}
    for stat, d in tr.groupby("stat"):
        if len(d) >= MIN_STAT_FIT:
            a, b = _fit_logit(d.x.values, d.y.values)
            curves[stat] = {"a": a, "b": b, "n": len(d)}
    report = {}
    te = te.copy()
    def cal(r):
        c = curves.get(r.stat, curves["_pooled"])
        return expit(c["a"] + max(c["b"], 0.0) * r.x)
    te["p"] = te.apply(cal, axis=1)
    base = tr.y.mean()
    report["brier_model"] = float(np.mean((te.p - te.y) ** 2))
    report["brier_constant_train_rate"] = float(np.mean((base - te.y) ** 2))
    print(f"  OOS Brier: model {report['brier_model']:.4f} vs constant {report['brier_constant_train_rate']:.4f}")
    te["side_p"] = np.maximum(te.p, 1 - te.p)
    te["won"] = np.where(te.p >= 0.5, te.y, 1 - te.y)
    for lo in (0.50, 0.52, 0.54, 0.56, 0.58, 0.60):
        d = te[te.side_p >= lo]
        if len(d):
            print(f"  OOS best side p>={lo:.2f}: n={len(d):5d} predicted {d.side_p.mean():.3f} actual {d.won.mean():.3f} "
                  f"(over share {(d.p >= 0.5).mean():.2f}; break-even at -110 = 0.524)")
    for stat, c in curves.items():
        print(f"  {stat:8s} a={c['a']:+.3f} b={c['b']:+.3f} n={c['n']}")
    all_curves = json.loads(CURVES_PATH.read_text()) if CURVES_PATH.exists() else {}
    all_curves[league] = {"curves": curves, "oos": report, "split": s["split"], "n_test": len(te)}
    CURVES_PATH.write_text(json.dumps(all_curves, indent=2))
    return all_curves[league]


_CACHE: Optional[dict] = None


def calibrated_over(league: str, stat: str, raw: float, market: float) -> float:
    """Calibrated P(over), anchored on the market price. Negative slopes are floored
    at 0: a model that anti-predicts must not create edge in either direction."""
    global _CACHE
    if _CACHE is None:
        _CACHE = json.loads(CURVES_PATH.read_text())
    cs = _CACHE[league]["curves"]
    c = cs.get(stat, cs["_pooled"])
    return expit(logit(market) + c["a"] + max(c["b"], 0.0) * (logit(raw) - logit(market)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fit", action="store_true")
    ap.add_argument("--league", choices=sorted(SPEC), required=True)
    args = ap.parse_args()
    if args.fit:
        fit(args.league)
    sys.exit(0)
