"""
analytics/engine/win_model.py

Moneyline probability for NBA and NFL. Replaces the NBA `backtest_winner`, which
reported the model's self-accuracy over the home team's last 8 games as if it were
P(win) and gave both sides the same number.

Point-in-time margin ratings (Elo style, regressed between seasons) feed a logistic
model fit on a train split, then blended with the de-vigged closing moneyline from
game_odds in logit space. The weight w is fit on train and reported out of sample.
A small w means the market already holds the signal.

CLI: python -m analytics.engine.win_model --fit --league nfl
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

from analytics.engine.prop_model import _fit_logit, _paged, expit, logit

COEF_PATH = Path(__file__).with_name("win_model.json")
SPEC = {
    "nba": {"league_id": 1, "k": 0.06, "carry": 0.6, "cap": 25.0, "split": "2025-07-01"},
    "nfl": {"league_id": 3, "k": 0.12, "carry": 0.5, "cap": 24.0, "split": "2026-07-01"},
}


def american_to_prob(ml) -> Optional[float]:
    try:
        ml = float(ml)
    except (TypeError, ValueError):
        return None
    if ml == 0:
        return None
    return 100 / (ml + 100) if ml > 0 else -ml / (-ml + 100)


def devig(home_ml, away_ml) -> Optional[float]:
    """De-vigged home win probability from a two-way moneyline."""
    h, a = american_to_prob(home_ml), american_to_prob(away_ml)
    return h / (h + a) if h and a else None


def load_games(league: str) -> pd.DataFrame:
    g = pd.DataFrame(_paged("games", "id,season,game_date,game_type,status,home_team_id,away_team_id,home_score,away_score",
                            "id", league_id=SPEC[league]["league_id"]))
    g = g[(g.game_type != "preseason") & (g.status == 2) & g.home_score.notna() & g.away_score.notna()]
    g = g[(g.home_score + g.away_score) > 0]    # a 0-0 row is a not-yet-played snapshot
    return g.sort_values(["game_date", "id"]).reset_index(drop=True)


def ratings(league: str, g: pd.DataFrame) -> tuple[pd.DataFrame, dict, dict]:
    """Walk games in order. Returns per-game pre-game features plus end state."""
    s = SPEC[league]
    r: dict[int, float] = {}
    last: dict[int, str] = {}
    season = None
    hfa = 2.0
    rows = []
    for x in g.itertuples():
        if x.season != season:
            r = {t: v * s["carry"] for t, v in r.items()}
            season = x.season
        rh, ra = r.get(x.home_team_id, 0.0), r.get(x.away_team_id, 0.0)
        rows.append({"id": x.id, "date": x.game_date, "diff": rh - ra,
                     "rest": _rest(last, x.home_team_id, x.game_date) - _rest(last, x.away_team_id, x.game_date),
                     "y": int(x.home_score > x.away_score)})
        m = max(min(float(x.home_score - x.away_score), s["cap"]), -s["cap"])
        err = m - (rh - ra + hfa)
        r[x.home_team_id] = rh + s["k"] * err
        r[x.away_team_id] = ra - s["k"] * err
        last[x.home_team_id] = last[x.away_team_id] = x.game_date
    return pd.DataFrame(rows), r, last


def _rest(last: dict, team: int, date: str) -> float:
    if team not in last:
        return 3.0
    days = (pd.Timestamp(date) - pd.Timestamp(last[team])).days
    return float(min(days, 7 if days < 30 else 7))


def _ll(p, y) -> float:
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def fit(league: str) -> dict:
    s = SPEC[league]
    g = load_games(league)
    f, _, _ = ratings(league, g)
    f["x"] = f["diff"] + 0.3 * f["rest"].clip(-3, 3)
    tr = f[f.date < s["split"]]
    a, b = _fit_logit(tr.x.values, tr.y.values, l2=0.01)
    f["model"] = 1 / (1 + np.exp(-(a + b * f.x)))
    odds = pd.DataFrame(_paged("game_odds", "game_id,home_ml,away_ml", "game_id", league_id=s["league_id"]))
    odds["mkt"] = [devig(h, w) for h, w in zip(odds.home_ml, odds.away_ml)]
    m = f.merge(odds.dropna(subset=["mkt"]), left_on="id", right_on="game_id")
    mtr, mte = m[m.date < s["split"]], m[m.date >= s["split"]]
    lm, lk = m.model.map(logit), m.mkt.map(logit)
    m["lm"], m["lk"] = lm, lk
    mtr, mte = m[m.date < s["split"]], m[m.date >= s["split"]]
    best = (9.0, 0.0)
    for w in np.arange(0, 0.51, 0.01):
        v = _ll(1 / (1 + np.exp(-(w * mtr.lm + (1 - w) * mtr.lk))), mtr.y.values)
        if v < best[0]:
            best = (v, float(w))
    w = best[1]
    blend = 1 / (1 + np.exp(-(w * mte.lm + (1 - w) * mte.lk)))
    res = {"a": a, "b": b, "w": round(w, 3), "n_train": len(mtr), "n_test": len(mte),
           "ll_model": _ll(mte.model.values, mte.y.values), "ll_market": _ll(mte.mkt.values, mte.y.values),
           "ll_blend": _ll(blend.values, mte.y.values)}
    print(f"[{league}] {res}")
    allc = json.loads(COEF_PATH.read_text()) if COEF_PATH.exists() else {}
    allc[league] = res
    COEF_PATH.write_text(json.dumps(allc, indent=2))
    return res


class WinModel:
    def __init__(self, league: str):
        self.league = league
        self.c = json.loads(COEF_PATH.read_text())[league]
        g = load_games(league)
        _, self.r, self.last = ratings(league, g)

    def home_prob(self, home: int, away: int, date: str, market_home: float) -> tuple[float, float]:
        """(raw model P(home), blended P(home))."""
        x = self.r.get(home, 0.0) - self.r.get(away, 0.0) + 0.3 * max(min(
            _rest(self.last, home, date) - _rest(self.last, away, date), 3), -3)
        raw = expit(self.c["a"] + self.c["b"] * x)
        w = self.c["w"]
        return raw, expit(w * logit(raw) + (1 - w) * logit(market_home))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fit", action="store_true")
    ap.add_argument("--league", choices=sorted(SPEC), required=True)
    args = ap.parse_args()
    if args.fit:
        fit(args.league)
    sys.exit(0)
