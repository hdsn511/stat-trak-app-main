"""
analytics/engine/game_model.py

Closed-form game model for StatTrak Analytics (NBA, ESPN basic data only).

Produces two derived quantities per game:
  - win_prob (home)   — logistic of strength differential
  - margin (home)     — linear from strength differential

"Strength" is a team's rolling average point differential (from final scores in
the `games` table) adjusted for rest. Home court is added by callers. All math is
closed-form; no ML libs, no advanced stats (no ratings/pace/usage).

Coefficients were originally calibrated against net-rating units, which are
within a point or two of per-game margin in the NBA. Revisit annually.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Optional

from analytics.db.connection import supabase

# ── Calibration constants ───────────────────────────────────────────────────

# Point-differential units per logit. Softer = win-probs hug 0.5; sharper = extreme probs.
# Calibrated offline against last season's margins; revisit annually.
SOFTNESS_COEF = 6.0

# Multiplier translating strength differential to expected margin in points.
# From historical regression of margin ~ strength_diff. Revisit annually.
MARGIN_COEF = 0.55

# Point bump applied to the home team by callers. NBA home edge ~ 2.5 pts/game.
# Applied by callers (not by compute_game_strength) so the function stays role-agnostic.
HOME_BUMP = 2.5

# Point penalty applied when a team plays on consecutive days.
B2B_PENALTY = -1.5

# Point bonus when a team has 3+ days of rest.
LONG_REST_BONUS = 0.5

# Games averaged for rolling point differential. Larger = smoother + slower to react;
# smaller = noisier but picks up recent form.
ROLLING_MARGIN_WINDOW = 12

# League-average total. Consumed by picks callers ranking "extreme" totals
# — kept here alongside the other model constants.
NBA_TOTAL_BASELINE = 220.0


# ── Core math ───────────────────────────────────────────────────────────────

def predict_winner(home_strength: float, away_strength: float) -> tuple[float, float]:
    """
    Return (home_win_prob, home_margin).

    home_win_prob is a logistic of the strength differential.
    home_margin is linear in the differential.
    """
    diff = home_strength - away_strength
    win_prob = 1.0 / (1.0 + math.exp(-diff / SOFTNESS_COEF))
    margin = diff * MARGIN_COEF
    return win_prob, margin


# ── Data-dependent helpers ──────────────────────────────────────────────────

def compute_game_strength(team_id: int, game_date: date) -> Optional[float]:
    """
    Return adjusted strength (in points of rolling margin) for a team on a date.
    None if insufficient data (< 5 completed games).

    Formula:
      strength = rolling_avg_point_differential + rest_adjustment

    Note: home_bump is NOT applied here. Callers add HOME_BUMP based on whether
    the team is playing at home, so this function stays role-agnostic.
    """
    date_str = game_date.isoformat()
    resp = (
        supabase.table("games")
        .select("game_date,home_team_id,away_team_id,home_score,away_score")
        .or_(f"home_team_id.eq.{team_id},away_team_id.eq.{team_id}")
        .lt("game_date", date_str)
        .neq("game_type", "preseason")
        .not_.is_("home_score", "null")
        .not_.is_("away_score", "null")
        .order("game_date", desc=True)
        .limit(ROLLING_MARGIN_WINDOW)
        .execute()
    )
    rows = resp.data or []
    if len(rows) < 5:
        return None

    margins = []
    for r in rows:
        diff = float(r["home_score"]) - float(r["away_score"])
        margins.append(diff if r["home_team_id"] == team_id else -diff)
    rolling_margin = sum(margins) / len(margins)

    prior_game = rows[0]["game_date"]
    days_rest = (game_date - date.fromisoformat(prior_game)).days
    if days_rest <= 1:
        rest_adj = B2B_PENALTY
    elif days_rest >= 3:
        rest_adj = LONG_REST_BONUS
    else:
        rest_adj = 0.0

    return rolling_margin + rest_adj


# ── Self-test ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    p, m = predict_winner(100.0, 100.0)
    assert abs(p - 0.5) < 1e-9, f"symmetry fail: {p}"
    assert abs(m) < 1e-9, f"margin not zero: {m}"

    p, m = predict_winner(106.0, 100.0)
    assert 0.72 < p < 0.74, f"favorite win prob off: {p}"
    assert 3.2 < m < 3.4, f"margin coef off: {m}"

    p_small, _ = predict_winner(102.0, 100.0)
    p_big, _ = predict_winner(110.0, 100.0)
    assert p_small < p_big, "not monotonic"

    print("game_model.py self-test PASSED")
