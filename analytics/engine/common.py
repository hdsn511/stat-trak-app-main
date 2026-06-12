"""
analytics/engine/common.py

Sport-neutral helpers shared by every backtest engine (NBA, MLB, ...).

These encode the *method* — recency-weighted hit rate and rest bucketing — that
is identical across sports. Sport-specific engines (backtest.py, backtest_mlb.py)
import these and supply their own stat columns, conditions, and table queries.
The scorer (analytics/engine/scorer.py) is likewise shared as-is.
"""

from __future__ import annotations


def rest_category(days_rest: int) -> str:
    """Bucket days of rest into four qualitative categories.

    0 -> "b2b", 1 -> "short", 2-3 -> "normal", 4+ -> "extended".
    """
    if days_rest == 0:
        return "b2b"
    if days_rest == 1:
        return "short"
    if days_rest <= 3:
        return "normal"
    return "extended"


def weighted_hit_rate(historical_results: list[tuple[str, bool]], decay: float) -> float:
    """Recency-weighted hit rate.

    Inputs: (game_date, hit) tuples sorted by game_date DESCENDING (most recent
    first). weight_i = decay ** i, i = 0 for the most recent game.
    """
    if not historical_results:
        return 0.0
    weights = [decay ** i for i in range(len(historical_results))]
    total_w = sum(weights)
    if total_w == 0:
        return 0.0
    weighted_hits = sum(
        w * (1 if hit else 0)
        for w, (_, hit) in zip(weights, historical_results)
    )
    return weighted_hits / total_w
