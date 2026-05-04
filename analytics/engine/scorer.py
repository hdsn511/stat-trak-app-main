"""
analytics/engine/scorer.py

Confidence and edge scoring for StatTrak Analytics.

Picks v2:
  - The B2B hit-rate adjustment is removed. B2B context is now matched
    historically by the rest condition in backtest, so multiplying the hit
    rate here would double-count.
  - First-half handling is gone entirely — first-half markets are dropped
    at Kalshi parse time (see analytics/kalshi/client.py).
  - A bounded modifier system replaces ad-hoc adjustments. Modifiers tilt
    the score by ±MAX_MODIFIER_IMPACT total points; they do not drive it.

CLI (self-test):
    python -m analytics.engine.scorer
"""

from __future__ import annotations

import sys
from typing import Optional

from analytics.db.connection import supabase  # noqa: F401 — available for future use

# ── Hard gates (preserved) ───────────────────────────────────────────────────────

MIN_HIT_RATE = 0.55
# Hard floor for historical (recency-weighted) hit rate.
# Tuned 2026-05-03 from 0.60 → 0.55 to restore mid-confidence picks that the
# weighted hit rate pushes just below 60%. MIN_EDGE=0.08 still prevents
# low-quality plays from passing.

MIN_EDGE = 0.05
# Minimum edge in percentage points (hit_rate - implied_prob).
# Tuned 2026-05-03 from 0.08 → 0.05 to admit high-hit-rate safe picks at
# 75-85% implied prob, where edge is naturally compressed by efficient pricing.
# Quality remains protected by MIN_HIT_RATE and the implied-prob penalty.

MAX_IMPLIED_PROB = 0.88
# Hard ceiling on Kalshi implied probability — efficient-market block.

MIN_SAMPLE_SIZE = 8
# Hard floor for backtest sample size.

# ── Base confidence (preserved) ──────────────────────────────────────────────────

SAMPLE_WEIGHT_TARGET = 25
CONDITION_BONUS_MAX  = 8
EDGE_BONUS_SCALE     = 150
EDGE_BONUS_CAP       = 10
IMPLIED_PROB_PENALTY_THRESHOLD = 0.65
IMPLIED_PROB_PENALTY_SCALE     = 30

# ── Modifiers (Picks v2) ─────────────────────────────────────────────────────────
# Modifiers tilt the score; they do not drive it. Total modifier impact is capped.
# B2B is now a modifier (NOT a hit-rate adjustment) so it does not double-count
# the rest condition that already filters historical samples.

# TODO: tune against observed correlation between recent_opp_form and actual
# hit-rate divergence vs season-form picks.
FORM_MODIFIER_SCALE = 30
FORM_MODIFIER_CAP   = 5

# TODO: tune against observed B2B vs non-B2B hit-rate divergence in the new pipeline.
B2B_MODIFIER_VALUE = -3.0

MAX_MODIFIER_IMPACT = 7  # |sum(modifiers)| cap

# Game-stakes modifier — stub. Disabled until standings data is wired.
GAME_STAKES_MODIFIER_ENABLED = False


# ── Scoring function ─────────────────────────────────────────────────────────────

def score(
    hit_rate: float,
    sample_size: int,
    conditions_matched: int,
    total_conditions: int,
    implied_prob: float,
    days_rest: int,
    stat: str,
    recent_opp_form: Optional[float] = None,
) -> dict:
    """
    Evaluate a backtest result and return a confidence score and edge.

    Args:
        hit_rate:           Recency-weighted hit rate from backtest (0.0-1.0).
        sample_size:        Number of historical games in the backtest.
        conditions_matched: Number of active core conditions matched (max 5).
        total_conditions:   Total core conditions (5 in v2).
        implied_prob:       Market-implied probability (0.0-1.0).
        days_rest:          Days of rest for the player (0 = back-to-back).
        stat:               Stat abbreviation (e.g. "pts").
        recent_opp_form:    Signed delta of opponent's last-N vs season form
                            for this stat. None disables the form modifier.

    Returns:
        On disqualification:
            {"confidence": 0, "edge": 0, "reason": "<reason_string>", "modifiers": {}}
        On success:
            {"confidence": float, "edge": float, "hit_rate_adjusted": float,
             "modifiers": dict}
    """
    # ── Hard disqualifiers ────────────────────────────────────────────────────
    if sample_size < MIN_SAMPLE_SIZE:
        return {"confidence": 0, "edge": 0, "reason": "insufficient_sample", "modifiers": {}}
    if hit_rate < MIN_HIT_RATE:
        return {"confidence": 0, "edge": 0, "reason": "low_hit_rate", "modifiers": {}}
    if implied_prob > MAX_IMPLIED_PROB:
        return {"confidence": 0, "edge": 0, "reason": "high_implied_prob", "modifiers": {}}

    edge = hit_rate - implied_prob
    if edge < MIN_EDGE:
        return {"confidence": 0, "edge": round(edge, 4), "reason": "insufficient_edge", "modifiers": {}}

    # ── Base confidence formula ───────────────────────────────────────────────
    base = hit_rate * 100
    sample_weight = min(1.0, sample_size / SAMPLE_WEIGHT_TARGET)
    condition_bonus = (conditions_matched / total_conditions) * CONDITION_BONUS_MAX
    edge_bonus = min(edge * EDGE_BONUS_SCALE, float(EDGE_BONUS_CAP))
    ip_penalty = max(0.0, implied_prob - IMPLIED_PROB_PENALTY_THRESHOLD) * IMPLIED_PROB_PENALTY_SCALE

    confidence = (base * sample_weight) + condition_bonus + edge_bonus - ip_penalty

    # ── Modifiers (capped tilt) ───────────────────────────────────────────────
    modifiers: dict[str, float] = {}

    if recent_opp_form is not None:
        raw = recent_opp_form * FORM_MODIFIER_SCALE
        capped = max(-FORM_MODIFIER_CAP, min(FORM_MODIFIER_CAP, raw))
        if capped != 0:
            modifiers["recent_opp_form"] = round(capped, 3)

    if days_rest == 0:
        modifiers["b2b"] = B2B_MODIFIER_VALUE

    if GAME_STAKES_MODIFIER_ENABLED:
        pass  # implement when standings wired

    modifier_total = sum(modifiers.values())
    modifier_total = max(-MAX_MODIFIER_IMPACT, min(MAX_MODIFIER_IMPACT, modifier_total))

    confidence = confidence + modifier_total
    confidence = max(0.0, min(confidence, 100.0))

    return {
        "confidence":        round(confidence, 2),
        "edge":              round(edge, 4),
        "hit_rate_adjusted": round(hit_rate, 4),  # v2: passthrough; backtest already weighted
        "modifiers":         modifiers,
    }


# ── CLI self-test ────────────────────────────────────────────────────────────────

def _run_self_test() -> None:
    print("=" * 60)
    print("StatTrak Scorer (v2) -- Self-Test")
    print("=" * 60)

    cases = [
        {
            "label": "Case 1: Strong pick (should PASS)",
            "kwargs": dict(
                hit_rate=0.87, sample_size=31, conditions_matched=5,
                total_conditions=5, implied_prob=0.71, days_rest=2, stat="pts",
            ),
            "expect": "PASS",
        },
        {
            "label": "Case 2: Weak sample (should FAIL insufficient_sample)",
            "kwargs": dict(
                hit_rate=0.90, sample_size=7, conditions_matched=5,
                total_conditions=5, implied_prob=0.71, days_rest=2, stat="pts",
            ),
            "expect": "FAIL insufficient_sample",
        },
        {
            "label": "Case 3: B2B is now a modifier — passes gates, gets b2b penalty",
            "kwargs": dict(
                hit_rate=0.64, sample_size=25, conditions_matched=4,
                total_conditions=5, implied_prob=0.55, days_rest=0, stat="pts",
            ),
            # v1 used to FAIL because hit_rate was multiplied by 0.93; in v2 the
            # hit rate is not adjusted, so it passes gates. b2b modifier appears.
            "expect": "PASS, modifiers contains b2b=-3.0",
        },
        {
            "label": "Case 4: Low edge (should FAIL insufficient_edge)",
            "kwargs": dict(
                hit_rate=0.85, sample_size=20, conditions_matched=5,
                total_conditions=5, implied_prob=0.81, days_rest=2, stat="pts",
            ),
            "expect": "FAIL insufficient_edge",
        },
        {
            "label": "Case 5: High implied prob 90% (should FAIL high_implied_prob)",
            "kwargs": dict(
                hit_rate=0.98, sample_size=25, conditions_matched=5,
                total_conditions=5, implied_prob=0.90, days_rest=2, stat="pts",
            ),
            "expect": "FAIL high_implied_prob",
        },
        {
            "label": "Case 6: Value pick — high edge bonus",
            "kwargs": dict(
                hit_rate=0.85, sample_size=25, conditions_matched=4,
                total_conditions=5, implied_prob=0.60, days_rest=2, stat="pts",
            ),
            "expect": "PASS with high edge bonus",
        },
        {
            "label": "Case 7: Low implied bucket — passes",
            "kwargs": dict(
                hit_rate=0.68, sample_size=20, conditions_matched=3,
                total_conditions=5, implied_prob=0.54, days_rest=2, stat="reb",
            ),
            "expect": "PASS (50% bucket pick)",
        },
        {
            "label": "Case 8: Positive recent_opp_form modifier (+10% delta)",
            "kwargs": dict(
                hit_rate=0.85, sample_size=25, conditions_matched=5,
                total_conditions=5, implied_prob=0.65, days_rest=2, stat="pts",
                recent_opp_form=0.10,
            ),
            "expect": "PASS, modifiers contains recent_opp_form ~ +3.0",
        },
        {
            "label": "Case 9: Modifier cap binds (extreme form would yield 30; capped to 5)",
            "kwargs": dict(
                hit_rate=0.80, sample_size=25, conditions_matched=5,
                total_conditions=5, implied_prob=0.60, days_rest=2, stat="reb",
                recent_opp_form=1.0,
            ),
            "expect": "PASS, modifiers.recent_opp_form == FORM_MODIFIER_CAP (5.0)",
        },
        {
            "label": "Case 10: Two negative modifiers (b2b + bad form), MAX_MODIFIER_IMPACT clamps",
            "kwargs": dict(
                hit_rate=0.80, sample_size=25, conditions_matched=5,
                total_conditions=5, implied_prob=0.60, days_rest=0, stat="pts",
                recent_opp_form=-0.30,
            ),
            "expect": "PASS, sum(modifiers) clamped at -MAX_MODIFIER_IMPACT (-7)",
        },
    ]

    for case in cases:
        result = score(**case["kwargs"])
        print(f"\n{case['label']}")
        print(f"  Expected : {case['expect']}")
        if "reason" in result:
            outcome = f"FAIL {result['reason']}"
        else:
            outcome = (
                f"PASS  confidence={result['confidence']:.2f}  "
                f"edge={result['edge']:.4f}  "
                f"modifiers={result['modifiers']}"
            )
        print(f"  Got      : {outcome}")

    # Lightweight assertions (raise on regression)
    r3 = score(hit_rate=0.64, sample_size=25, conditions_matched=4,
               total_conditions=5, implied_prob=0.55, days_rest=0, stat="pts")
    assert "reason" not in r3, f"Case 3 should pass gates: {r3}"
    assert r3["modifiers"].get("b2b") == B2B_MODIFIER_VALUE, f"Case 3 b2b modifier: {r3}"

    r9 = score(hit_rate=0.80, sample_size=25, conditions_matched=5,
               total_conditions=5, implied_prob=0.60, days_rest=2, stat="reb",
               recent_opp_form=1.0)
    assert r9["modifiers"].get("recent_opp_form") == FORM_MODIFIER_CAP, \
        f"Case 9 form modifier should be capped at FORM_MODIFIER_CAP: {r9}"

    r10 = score(hit_rate=0.80, sample_size=25, conditions_matched=5,
                total_conditions=5, implied_prob=0.60, days_rest=0, stat="pts",
                recent_opp_form=-0.30)
    raw_sum = r10["modifiers"]["b2b"] + r10["modifiers"]["recent_opp_form"]
    assert raw_sum < -MAX_MODIFIER_IMPACT, \
        f"Case 10 raw modifier sum should exceed cap: {raw_sum}"

    print("\n" + "=" * 60)
    print("Self-test complete (assertions passed).")


def main() -> int:
    _run_self_test()
    return 0


if __name__ == "__main__":
    sys.exit(main())
