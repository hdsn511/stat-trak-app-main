"""
analytics/engine/scorer.py

Confidence and edge scoring for StatTrak Analytics.

Takes a backtest result and market implied probability, applies penalties
and bonuses, and returns a confidence score (0-100) plus an edge figure.

The scorer is the final gate before a pick is recommended:
  1. Hard disqualifiers filter out unreliable or low-value situations.
  2. B2B penalty adjusts points-heavy stats on back-to-back nights.
  3. Confidence formula combines hit rate, sample weight, and condition bonus.

CLI (self-test):
    python -m analytics.engine.scorer
"""

from __future__ import annotations

import sys

from analytics.db.connection import supabase  # noqa: F401 — available for future use

# ── Tunable constants ────────────────────────────────────────────────────────────

MIN_HIT_RATE = 0.82
# Hard floor for historical hit rate (before any adjustment).
# Below 82% we decline to recommend the pick regardless of edge or sample.
# Raise this to be more selective; lower it to generate more picks at higher risk.

MIN_EDGE = 0.08
# Minimum edge in percentage points (hit_rate_adjusted - implied_prob).
# 8 points means we need at least 8% more probability than the market implies.
# This ensures we only recommend plays where the market is meaningfully mispriced.
# Raise to require larger mispricings; lower to capture tighter edges.

MIN_SAMPLE_SIZE = 10
# Hard floor for number of historical games in the backtest.
# Below 10 samples, any hit rate is statistically unreliable.
# Should match (or be >= to) analytics.engine.backtest.MIN_SAMPLE_SIZE.

SAMPLE_WEIGHT_TARGET = 25
# Full confidence weight is achieved at this many historical games.
# Below 25, confidence scales linearly (e.g. 12 games = 48% weight).
# Increase to demand larger samples before giving full credit;
# decrease to reward smaller but still meaningful sample sizes.

CONDITION_BONUS_MAX = 8
# Maximum bonus points added when all 5 conditions are active (5/5).
# Scales linearly: 3/5 conditions = 3/5 * 8 = 4.8 bonus points.
# Rewards picks that were matched under tight, highly-comparable conditions.
# Increase to favour context-rich picks more strongly.

B2B_PENALTY_STATS = ("pts",)
# Stats that receive a downward adjustment when the player is on a
# back-to-back (days_rest == 0).  Points are most sensitive to fatigue;
# add "reb", "ast", etc. here if data supports it.

B2B_PENALTY_FACTOR = 0.93
# Multiply adjusted hit_rate by this factor on back-to-back nights for
# affected stats.  0.93 = 7% reduction.  Calibrate against historical
# B2B vs. non-B2B scoring differences in the dataset.

FIRST_HALF_CONFIDENCE_CAP = 50
# Maximum confidence score for first-half props.
# First-half lines are approximations of half-game performance; the
# historical backtests are inherently noisier for these markets.
# Set to 50 to signal "possible but uncertain". Raise if 1H data improves.


# ── Scoring function ─────────────────────────────────────────────────────────────

def score(
    hit_rate: float,
    sample_size: int,
    conditions_matched: int,
    total_conditions: int,
    implied_prob: float,
    days_rest: int,
    stat: str,
    is_first_half: bool = False,
) -> dict:
    """
    Evaluate a backtest result and return a confidence score and edge.

    Args:
        hit_rate:           Historical fraction of games where the stat beat the line (0.0-1.0).
        sample_size:        Number of historical games in the backtest.
        conditions_matched: Number of active conditions that were matched (e.g. 4 out of 5).
        total_conditions:   Total possible conditions (typically 5 for player, 4 for game).
        implied_prob:       Market-implied probability from the Kalshi price (0.0-1.0).
        days_rest:          Days of rest for the player (0 = back-to-back).
        stat:               Stat abbreviation (e.g. "pts") used to check B2B penalty.
        is_first_half:      If True, cap confidence at FIRST_HALF_CONFIDENCE_CAP.

    Returns:
        On disqualification:
            {"confidence": 0, "edge": 0, "reason": "<reason_string>"}
        On success:
            {"confidence": float, "edge": float, "hit_rate_adjusted": float}
    """

    # ── Hard disqualifier: sample size ───────────────────────────────────────
    if sample_size < MIN_SAMPLE_SIZE:
        return {"confidence": 0, "edge": 0, "reason": "insufficient_sample"}

    # ── Hard disqualifier: raw hit rate ──────────────────────────────────────
    if hit_rate < MIN_HIT_RATE:
        return {"confidence": 0, "edge": 0, "reason": "low_hit_rate"}

    # ── B2B penalty ──────────────────────────────────────────────────────────
    adjusted_rate = hit_rate
    if days_rest == 0 and stat in B2B_PENALTY_STATS:
        adjusted_rate = hit_rate * B2B_PENALTY_FACTOR

    # Re-check adjusted rate against the floor
    if adjusted_rate < MIN_HIT_RATE:
        return {"confidence": 0, "edge": 0, "reason": "low_hit_rate"}

    # ── Edge check ───────────────────────────────────────────────────────────
    edge = adjusted_rate - implied_prob
    if edge < MIN_EDGE:
        return {"confidence": 0, "edge": round(edge, 4), "reason": "insufficient_edge"}

    # ── Confidence formula ───────────────────────────────────────────────────
    base = adjusted_rate * 100
    # Linear sample weight: 0 at 0 games, 1.0 at SAMPLE_WEIGHT_TARGET games.
    sample_weight = min(1.0, sample_size / SAMPLE_WEIGHT_TARGET)
    # Condition bonus: proportional to how many conditions were active.
    condition_bonus = (conditions_matched / total_conditions) * CONDITION_BONUS_MAX

    confidence = (base * sample_weight) + condition_bonus
    confidence = min(confidence, 100.0)

    # ── First-half cap ───────────────────────────────────────────────────────
    if is_first_half:
        confidence = min(confidence, float(FIRST_HALF_CONFIDENCE_CAP))

    return {
        "confidence": round(confidence, 2),
        "edge": round(edge, 4),
        "hit_rate_adjusted": round(adjusted_rate, 4),
    }


# ── CLI self-test ────────────────────────────────────────────────────────────────

def _run_self_test() -> None:
    """
    Run four representative test cases and print results.
    Expected outcomes documented inline.
    """
    print("=" * 60)
    print("StatTrak Scorer -- Self-Test")
    print("=" * 60)

    cases = [
        {
            "label": "Case 1: Strong pick (should PASS)",
            "kwargs": dict(
                hit_rate=0.87,
                sample_size=31,
                conditions_matched=5,
                total_conditions=5,
                implied_prob=0.71,
                days_rest=2,
                stat="pts",
                is_first_half=False,
            ),
            "expect": "PASS",
        },
        {
            "label": "Case 2: Weak sample (should FAIL insufficient_sample)",
            "kwargs": dict(
                hit_rate=0.90,
                sample_size=7,
                conditions_matched=5,
                total_conditions=5,
                implied_prob=0.71,
                days_rest=2,
                stat="pts",
                is_first_half=False,
            ),
            "expect": "FAIL insufficient_sample",
        },
        {
            "label": "Case 3: B2B penalty -- 84% hit, 25 games, 0 rest, pts",
            "kwargs": dict(
                hit_rate=0.84,
                sample_size=25,
                conditions_matched=4,
                total_conditions=5,
                implied_prob=0.71,
                days_rest=0,
                stat="pts",
                is_first_half=False,
            ),
            # 0.84 * 0.93 = 0.7812 < MIN_HIT_RATE 0.82 -> FAIL
            "expect": "FAIL low_hit_rate after B2B penalty",
        },
        {
            "label": "Case 4: Low edge (should FAIL insufficient_edge)",
            "kwargs": dict(
                hit_rate=0.85,
                sample_size=20,
                conditions_matched=5,
                total_conditions=5,
                implied_prob=0.80,
                days_rest=2,
                stat="pts",
                is_first_half=False,
            ),
            # edge = 0.85 - 0.80 = 0.05 < MIN_EDGE 0.08
            "expect": "FAIL insufficient_edge",
        },
    ]

    for case in cases:
        result = score(**case["kwargs"])
        label = case["label"]
        expected = case["expect"]
        print(f"\n{label}")
        print(f"  Expected : {expected}")
        if "reason" in result:
            outcome = f"FAIL {result['reason']}"
        else:
            outcome = (
                f"PASS  confidence={result['confidence']:.2f}  "
                f"edge={result['edge']:.4f}  "
                f"adjusted_rate={result['hit_rate_adjusted']:.4f}"
            )
        print(f"  Got      : {outcome}")

    print("\n" + "=" * 60)
    print("Self-test complete.")


def main() -> int:
    _run_self_test()
    return 0


if __name__ == "__main__":
    sys.exit(main())
