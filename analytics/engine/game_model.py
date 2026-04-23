"""
analytics/engine/game_model.py

Closed-form game model for StatTrak Analytics.

Produces three derived quantities per game:
  - win_prob (home)   — logistic of strength differential
  - margin (home)     — linear from strength differential
  - total             — pace-weighted sum of offensive ratings

"Strength" blends rolling net rating with adjustments for home court,
rest, and absent players' usage. All math is closed-form; no ML libs.

Coefficients were calibrated once against last season's games +
team_game_stats. Revisit annually via analytics/notebooks (deferred).
"""

from __future__ import annotations

import math
from datetime import date
from typing import Optional

from analytics.db.connection import supabase

# ── Calibration constants ───────────────────────────────────────────────────

# Net-rating units per logit. Softer = win-probs hug 0.5; sharper = extreme probs.
# Calibrated offline against last season's margins; revisit annually.
SOFTNESS_COEF = 6.0

# Multiplier translating strength differential to expected margin in points.
# From historical regression of margin ~ strength_diff. Revisit annually.
MARGIN_COEF = 0.55

# Net-rating bump applied to the home team by callers. NBA home edge ~ 2.5 pts/game.
# Applied by callers (not by compute_game_strength) so the function stays role-agnostic.
HOME_BUMP = 2.5

# Net-rating penalty applied when a team plays on consecutive days.
B2B_PENALTY = -1.5

# Net-rating bonus when a team has 3+ days of rest.
LONG_REST_BONUS = 0.5

# Games averaged for rolling net rating. Larger = smoother + slower to react;
# smaller = noisier but picks up recent form.
ROLLING_NET_WINDOW = 12

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


def predict_total(
    home_pace: float,
    away_pace: float,
    home_off_rating: float,
    away_off_rating: float,
) -> float:
    """
    Expected game total = average pace * average offensive rating / 100.
    Offensive rating is points per 100 possessions, pace is possessions per 48 min,
    so the product naturally scales to full-game points.
    """
    pace = (home_pace + away_pace) / 2.0
    off = (home_off_rating + away_off_rating) / 2.0
    return pace * off / 100.0


# ── Data-dependent helpers ──────────────────────────────────────────────────

def compute_game_strength(team_id: int, game_date: date) -> Optional[float]:
    """
    Return adjusted strength (in net-rating units) for a team on a given date.
    None if insufficient data.

    Formula:
      strength = rolling_net_rating
               + rest_adjustment
               - weighted_absent_usage

    Note: home_bump is NOT applied here. Callers add HOME_BUMP based on whether
    the team is playing at home, so this function stays role-agnostic.
    """
    date_str = game_date.isoformat()
    resp = (
        supabase.table("team_game_stats")
        .select("game_date,off_rating,def_rating")
        .eq("team_id", team_id)
        .lt("game_date", date_str)
        .order("game_date", desc=True)
        .limit(ROLLING_NET_WINDOW)
        .execute()
    )
    rows = resp.data or []
    if len(rows) < 5:
        return None

    net_ratings = [
        (r["off_rating"] - r["def_rating"])
        for r in rows
        if r.get("off_rating") is not None and r.get("def_rating") is not None
    ]
    if not net_ratings:
        return None
    rolling_net = sum(net_ratings) / len(net_ratings)

    prior_game = rows[0]["game_date"]
    days_rest = (game_date - date.fromisoformat(prior_game)).days
    if days_rest <= 1:
        rest_adj = B2B_PENALTY
    elif days_rest >= 3:
        rest_adj = LONG_REST_BONUS
    else:
        rest_adj = 0.0

    out_usg = _absent_usage(team_id, game_date)
    return rolling_net + rest_adj - out_usg


def _absent_usage(team_id: int, game_date: date) -> float:
    """Sum of rolling_usg_5g across players marked 'out' for this team's game on game_date."""
    date_str = game_date.isoformat()

    game_resp = (
        supabase.table("games")
        .select("id")
        .eq("game_date", date_str)
        .or_(f"home_team_id.eq.{team_id},away_team_id.eq.{team_id}")
        .limit(1)
        .execute()
    )
    if not game_resp.data:
        print(f"  WARNING: _absent_usage found no scheduled game for team_id={team_id} on {date_str}; returning 0.0")
        return 0.0
    game_id = game_resp.data[0]["id"]

    out_resp = (
        supabase.table("player_availability")
        .select("player_id")
        .eq("game_id", game_id)
        .eq("status", "out")
        .execute()
    )
    out_ids = [r["player_id"] for r in (out_resp.data or [])]
    if not out_ids:
        return 0.0

    cond_resp = (
        supabase.table("daily_conditions")
        .select("rolling_usg_5g")
        .in_("player_id", out_ids)
        .eq("game_date", date_str)
        .execute()
    )
    usgs = [r["rolling_usg_5g"] for r in (cond_resp.data or []) if r.get("rolling_usg_5g") is not None]
    return sum(usgs) if usgs else 0.0


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

    t = predict_total(100.0, 100.0, 115.0, 115.0)
    assert 114 < t < 116, f"total off: {t}"

    print("game_model.py self-test PASSED")
