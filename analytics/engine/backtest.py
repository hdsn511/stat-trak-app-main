"""
analytics/engine/backtest.py

Condition-matched backtesting engine for StatTrak Analytics.

For each player prop or game prop, finds historical games where the
contextual conditions (usage rate, pace, rest, matchup tier, home/away)
were similar to today, then computes hit rates against a given line.

Condition loosening: if the initial 5-condition query returns fewer than
MIN_SAMPLE_SIZE games, conditions are dropped one at a time in
CONDITION_DROP_ORDER until either the sample is large enough or we hit
the MIN_CONDITIONS_ACTIVE floor, at which point we return None.

CLI:
    python -m analytics.engine.backtest --player-id 123 --stat pts --line 25.5 --date 2026-03-22
    python -m analytics.engine.backtest --game-id 456 --prop-type total --line 220.5 --date 2026-03-22
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional

from analytics.db.connection import supabase, POSITION_GROUP_MAP  # noqa: F401

# ── Tunable constants ────────────────────────────────────────────────────────────

USG_BUCKET_WIDTH = 0.03
# +/- usage rate bucket applied when filtering historical games.
# Wider = more matching samples but noisier comparison (less context-alike).
# Tighter = fewer samples but purer context match. 0.03 ~ 3 percentage points.

PACE_BUCKET_WIDTH = 3.0
# +/- pace bucket (possessions per 48 min).
# 3.0 covers roughly one standard deviation of game-to-game pace variation.

OFF_RATING_BUCKET_WIDTH = 3.0
# +/- offensive rating bucket used when matching team conditions for game props.
# Tighter values isolate high/low-offense environments more strictly.

DEF_RATING_BUCKET_WIDTH = 3.0
# +/- defensive rating bucket for game props.
# Mirrors OFF_RATING_BUCKET_WIDTH; tune together for consistent strictness.

COMBINED_PACE_BUCKET_WIDTH = 5.0
# +/- combined pace (home_pace + away_pace) bucket for game-level props.
# Wider than per-team because combined pace has higher natural variance.

MIN_SAMPLE_SIZE = 10
# Hard floor. If fewer than this many matching historical games are found,
# we return None rather than report an unreliable hit rate.
# Increase to be more conservative; decrease to get more coverage at the
# cost of statistical reliability.

CONDITION_DROP_ORDER = ["home_away", "matchup_tier", "rest"]
# When the sample is too small, we relax conditions in this order.
# Items earlier in the list are considered less predictive and are dropped first.
# "home_away" is least predictive; "rest" affects fatigue most directly.
# Never touches usg_pct or pace — those are the core context signals.

MIN_CONDITIONS_ACTIVE = 3
# We never loosen below this many active conditions.
# Dropping below 3 means the historical games are no longer meaningfully
# similar to today's context, and the hit rate would be noise.

STAT_COLUMN_MAP = {
    "pts": "points",
    "reb": "rebounds",
    "ast": "assists",
    "fg3m": "three_points_made",
}
# Maps API-facing stat abbreviations to the actual column names in nba_player_stats.
# Add entries here as new stat types are supported by the pipeline.


# ── Helper functions ─────────────────────────────────────────────────────────────

def _rest_category(days_rest: int) -> str:
    """
    Bucket days of rest into three qualitative categories.

    0  days -> "b2b"    (back-to-back; highest fatigue)
    1  day  -> "short"  (minimal recovery)
    2+ days -> "normal" (standard rest)
    """
    if days_rest == 0:
        return "b2b"
    if days_rest == 1:
        return "short"
    return "normal"


def _matchup_tier(opp_rank: Optional[int]) -> str:
    """
    Convert an opponent defensive rank (1=best, 30=worst) into a tier label.

    1-10  -> "tough"   (top-10 defense by position)
    11-20 -> "mid"     (middle-of-the-road defense)
    21-30 -> "soft"    (bottom-10 defense, favorable matchup)
    None  -> "unknown" (rank data unavailable)
    """
    if opp_rank is None:
        return "unknown"
    if 1 <= opp_rank <= 10:
        return "tough"
    if 11 <= opp_rank <= 20:
        return "mid"
    return "soft"


# ── Player prop backtester ───────────────────────────────────────────────────────

def backtest_player(
    player_id: int,
    stat: str,
    line: float,
    game_date: str,
) -> Optional[dict]:
    """
    Find historical games where this player faced similar conditions to today
    and compute what fraction of the time they exceeded `line` for `stat`.

    Args:
        player_id:  Internal DB id (players.id).
        stat:       One of the keys in STAT_COLUMN_MAP ("pts", "reb", "ast", "fg3m").
        line:       The prop line to beat (e.g. 25.5 for "over 25.5 pts").
        game_date:  ISO date string "YYYY-MM-DD" for today's game.

    Returns:
        dict with hit_rate, sample_size, conditions_matched, etc.
        None if conditions are missing, stat is unsupported, or sample too small.
    """
    stat_col = STAT_COLUMN_MAP.get(stat)
    if stat_col is None:
        print(f"  ERROR: unsupported stat '{stat}'. Valid: {list(STAT_COLUMN_MAP)}")
        return None

    # ── 1. Load today's conditions ───────────────────────────────────────────
    dc_result = (
        supabase.table("daily_conditions")
        .select(
            "rolling_usg_5g,rolling_pace_5g,days_rest,home_away,"
            "opp_def_rank_position,game_id"
        )
        .eq("player_id", player_id)
        .eq("game_date", game_date)
        .limit(1)
        .execute()
    )

    if not dc_result.data:
        print(
            f"  WARNING: no daily_conditions row for player_id={player_id} "
            f"on {game_date}. Skipping."
        )
        return None

    dc = dc_result.data[0]
    today_usg = dc.get("rolling_usg_5g")
    today_pace = dc.get("rolling_pace_5g")
    today_rest = dc.get("days_rest")
    today_home_away = dc.get("home_away")
    today_opp_rank = dc.get("opp_def_rank_position")
    today_game_id = dc.get("game_id")

    # Usage and pace are the core numeric anchors — bail without them.
    if today_usg is None or today_pace is None:
        print(
            f"  WARNING: rolling_usg_5g or rolling_pace_5g is None for "
            f"player_id={player_id} on {game_date}. Cannot backtest."
        )
        return None

    # Default rest to "normal" if missing; matchup tier handles None gracefully.
    if today_rest is None:
        today_rest = 3

    # ── 2. Compute condition ranges ──────────────────────────────────────────
    usg_lo = today_usg - USG_BUCKET_WIDTH
    usg_hi = today_usg + USG_BUCKET_WIDTH
    pace_lo = today_pace - PACE_BUCKET_WIDTH
    pace_hi = today_pace + PACE_BUCKET_WIDTH
    today_rest_cat = _rest_category(today_rest)
    today_matchup_tier = _matchup_tier(today_opp_rank)

    # Condition state: 5 total. usg_pct and pace are always active.
    # The droppable conditions start active and may be removed.
    droppable = {
        "home_away": True,
        "matchup_tier": True,
        "rest": True,
    }

    # ── 3. Iteratively loosen until we have enough samples ───────────────────
    drop_idx = 0  # pointer into CONDITION_DROP_ORDER

    while True:
        # Count currently active conditions
        n_active = 2 + sum(1 for v in droppable.values() if v)  # 2 = usg + pace

        # ── Query player_game_conditions for matching game_ids ───────────────
        q = (
            supabase.table("player_game_conditions")
            .select("game_id,days_rest,home_away,opponent_team_id")
            .eq("player_id", player_id)
            .gte("usg_pct", usg_lo)
            .lte("usg_pct", usg_hi)
            .gte("pace", pace_lo)
            .lte("pace", pace_hi)
        )

        # Exclude today's game (we don't know the result yet)
        if today_game_id is not None:
            q = q.neq("game_id", today_game_id)

        pgc_result = q.execute()
        candidate_rows = pgc_result.data or []

        # ── Filter rest and matchup_tier in Python ───────────────────────────
        # (Supabase doesn't natively support enum-bucket comparisons.)
        filtered_game_ids: list[int] = []
        for row in candidate_rows:
            # Rest filter
            if droppable["rest"]:
                row_rest_cat = _rest_category(row.get("days_rest") or 3)
                if row_rest_cat != today_rest_cat:
                    continue

            # Home/away filter
            if droppable["home_away"]:
                if row.get("home_away") != today_home_away:
                    continue

            # Matchup tier: requires a daily_conditions lookup per game to get
            # the opponent's defensive rank at that time. To avoid N+1 queries
            # we batch-fetch the opp team ids and resolve tier via the
            # opponent_position_defense table at game_date granularity.
            # For now, we resolve tier via a pre-joined approach using
            # the opponent_team_id stored in player_game_conditions and
            # the daily_conditions.opp_def_rank_position at each game date.
            # (Full multi-game batch lookup handled below.)
            filtered_game_ids.append(row["game_id"])

        # ── Matchup tier filtering (batch) ───────────────────────────────────
        if droppable["matchup_tier"] and filtered_game_ids and today_matchup_tier != "unknown":
            # Fetch opp_def_rank_position for this player at each candidate game
            tier_result = (
                supabase.table("daily_conditions")
                .select("game_id,opp_def_rank_position")
                .eq("player_id", player_id)
                .in_("game_id", filtered_game_ids)
                .execute()
            )
            tier_map: dict[int, str] = {}
            for tr in (tier_result.data or []):
                gid = tr["game_id"]
                tier_map[gid] = _matchup_tier(tr.get("opp_def_rank_position"))

            filtered_game_ids = [
                gid for gid in filtered_game_ids
                if tier_map.get(gid, "unknown") == today_matchup_tier
            ]

        sample_size = len(filtered_game_ids)

        if sample_size >= MIN_SAMPLE_SIZE:
            break  # Enough data — proceed to stat lookup

        # ── Loosen one condition if possible ─────────────────────────────────
        # Never go below MIN_CONDITIONS_ACTIVE
        if n_active <= MIN_CONDITIONS_ACTIVE or drop_idx >= len(CONDITION_DROP_ORDER):
            # Cannot loosen further
            print(
                f"  INFO: only {sample_size} matching games for player_id={player_id} "
                f"stat={stat} after loosening all allowed conditions. Returning None."
            )
            return None

        condition_to_drop = CONDITION_DROP_ORDER[drop_idx]
        droppable[condition_to_drop] = False
        drop_idx += 1
        # Loop back and re-query with the relaxed condition set

    # ── 4. Fetch actual stats for matching games ─────────────────────────────
    if not filtered_game_ids:
        return None

    stats_result = (
        supabase.table("nba_player_stats")
        .select(f"{stat_col}")
        .eq("player_id", player_id)
        .in_("game_id", filtered_game_ids)
        .execute()
    )
    stat_rows = stats_result.data or []

    if len(stat_rows) < MIN_SAMPLE_SIZE:
        print(
            f"  INFO: matched {len(filtered_game_ids)} game_ids but only "
            f"{len(stat_rows)} stat rows found for player_id={player_id}. "
            "Some games may lack box score data."
        )
        if len(stat_rows) < MIN_SAMPLE_SIZE:
            return None

    # ── 5. Compute hit rate ──────────────────────────────────────────────────
    values = [r[stat_col] for r in stat_rows if r.get(stat_col) is not None]
    if len(values) < MIN_SAMPLE_SIZE:
        return None

    hits = sum(1 for v in values if v > line)
    hit_rate = hits / len(values)
    conditions_matched = 2 + sum(1 for v in droppable.values() if v)

    # ── 6. Build condition breakdown ─────────────────────────────────────────
    condition_breakdown = {
        "usg_pct": "active",
        "pace": "active",
        "home_away": "active" if droppable["home_away"] else "dropped",
        "matchup_tier": "active" if droppable["matchup_tier"] else "dropped",
        "rest": "active" if droppable["rest"] else "dropped",
    }

    return {
        "hit_rate": hit_rate,
        "sample_size": len(values),
        "conditions_matched": conditions_matched,
        "total_conditions": 5,
        "games_queried": len(filtered_game_ids),
        "condition_breakdown": condition_breakdown,
    }


# ── Game prop backtester ─────────────────────────────────────────────────────────

def backtest_game_prop(
    game_id: int,
    prop_type: str,
    line: float,
    game_date: str,
) -> Optional[dict]:
    """
    Find historical games where both teams faced similar pace/rating conditions
    to today's matchup, then compute hit rates for the given game prop.

    Supported prop_type values: "total" (home+away combined score),
    "spread" (home_score - away_score).

    Args:
        game_id:    Internal DB id (games.id) for today's game.
        prop_type:  "total" or "spread".
        line:       The line to beat.
        game_date:  ISO date string "YYYY-MM-DD" for today's game.

    Returns:
        dict with hit_rate, sample_size, conditions_matched, etc.
        None if data is missing or sample too small.
    """
    if prop_type not in ("total", "spread"):
        print(f"  ERROR: unsupported prop_type '{prop_type}'. Valid: total, spread")
        return None

    # ── 1. Get today's game info ─────────────────────────────────────────────
    game_result = (
        supabase.table("games")
        .select("home_team_id,away_team_id,home_score,away_score")
        .eq("id", game_id)
        .limit(1)
        .execute()
    )
    if not game_result.data:
        print(f"  WARNING: game_id={game_id} not found in games table.")
        return None

    game_info = game_result.data[0]
    home_team_id = game_info["home_team_id"]
    away_team_id = game_info["away_team_id"]

    # ── 2. Compute rolling 10-game team stats for today ──────────────────────
    def _rolling_team_stats(team_id: int) -> Optional[dict]:
        """
        Average pace, off_rating, def_rating over the last 10 games
        before game_date for the given team.
        """
        r = (
            supabase.table("team_game_stats")
            .select("pace,off_rating,def_rating,game_date")
            .eq("team_id", team_id)
            .lt("game_date", game_date)
            .order("game_date", desc=True)
            .limit(10)
            .execute()
        )
        rows = r.data or []
        if not rows:
            return None
        paces = [x["pace"] for x in rows if x.get("pace") is not None]
        offs = [x["off_rating"] for x in rows if x.get("off_rating") is not None]
        defs = [x["def_rating"] for x in rows if x.get("def_rating") is not None]
        if not paces or not offs or not defs:
            return None
        avg_pace = sum(paces) / len(paces)
        avg_off = sum(offs) / len(offs)
        avg_def = sum(defs) / len(defs)
        return {"pace": avg_pace, "off_rating": avg_off, "def_rating": avg_def}

    home_stats = _rolling_team_stats(home_team_id)
    away_stats = _rolling_team_stats(away_team_id)

    if home_stats is None or away_stats is None:
        print(
            f"  WARNING: insufficient team_game_stats for game_id={game_id} "
            "to compute rolling averages. Skipping."
        )
        return None

    combined_pace_today = home_stats["pace"] + away_stats["pace"]
    home_off_today = home_stats["off_rating"]
    away_off_today = away_stats["off_rating"]
    home_def_today = home_stats["def_rating"]

    # ── 3. Bulk-load ALL team_game_stats into memory ─────────────────────────
    # Critical: we must avoid N+1 queries when scanning historical games.
    # Load every team_game_stats row once and cache by (team_id, game_id).
    print("  Loading all team_game_stats into memory ...")
    all_tgs_result = (
        supabase.table("team_game_stats")
        .select("team_id,game_id,pace,off_rating,def_rating")
        .execute()
    )
    # Cache: {game_id: {team_id: {pace, off_rating, def_rating}}}
    tgs_cache: dict[int, dict[int, dict]] = {}
    for row in (all_tgs_result.data or []):
        gid = row["game_id"]
        tid = row["team_id"]
        tgs_cache.setdefault(gid, {})[tid] = {
            "pace": row.get("pace"),
            "off_rating": row.get("off_rating"),
            "def_rating": row.get("def_rating"),
        }

    # ── 4. Load all historical games ─────────────────────────────────────────
    print("  Loading historical games ...")
    hist_result = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id,home_score,away_score,game_date")
        .lt("game_date", game_date)
        .not_.is_("home_score", "null")
        .not_.is_("away_score", "null")
        .execute()
    )
    historical_games = hist_result.data or []

    if not historical_games:
        print("  WARNING: no historical games with scores found.")
        return None

    # ── 5. Match historical games by conditions ──────────────────────────────
    matched_actuals: list[float] = []

    for hgame in historical_games:
        hgid = hgame["id"]
        hhome = hgame["home_team_id"]
        haway = hgame["away_team_id"]

        # Look up both teams' stats in the in-memory cache
        home_row = tgs_cache.get(hgid, {}).get(hhome)
        away_row = tgs_cache.get(hgid, {}).get(haway)

        if home_row is None or away_row is None:
            continue  # No advanced stats for this game — skip
        if None in (home_row["pace"], away_row["pace"],
                    home_row["off_rating"], away_row["off_rating"],
                    home_row["def_rating"]):
            continue  # Incomplete stats

        h_pace = home_row["pace"]
        a_pace = away_row["pace"]
        combined_pace = h_pace + a_pace
        h_off = home_row["off_rating"]
        a_off = away_row["off_rating"]
        h_def = home_row["def_rating"]

        # Apply condition buckets
        if abs(combined_pace - combined_pace_today) > COMBINED_PACE_BUCKET_WIDTH:
            continue
        if abs(h_off - home_off_today) > OFF_RATING_BUCKET_WIDTH:
            continue
        if abs(a_off - away_off_today) > OFF_RATING_BUCKET_WIDTH:
            continue
        if abs(h_def - home_def_today) > DEF_RATING_BUCKET_WIDTH:
            continue

        # Compute the actual prop value for this historical game
        h_score = hgame["home_score"]
        a_score = hgame["away_score"]
        if h_score is None or a_score is None:
            continue

        if prop_type == "total":
            actual = float(h_score) + float(a_score)
        else:  # "spread"
            actual = float(h_score) - float(a_score)

        matched_actuals.append(actual)

    sample_size = len(matched_actuals)

    if sample_size < MIN_SAMPLE_SIZE:
        print(
            f"  INFO: only {sample_size} matching historical games for "
            f"game_id={game_id} prop_type={prop_type}. Returning None."
        )
        return None

    # ── 6. Compute hit rate ──────────────────────────────────────────────────
    hits = sum(1 for v in matched_actuals if v > line)
    hit_rate = hits / sample_size

    # Game props use 4 conditions (combined_pace, home_off, away_off, home_def)
    conditions_matched = 4
    condition_breakdown = {
        "combined_pace": "active",
        "home_off_rating": "active",
        "away_off_rating": "active",
        "home_def_rating": "active",
    }

    return {
        "hit_rate": hit_rate,
        "sample_size": sample_size,
        "conditions_matched": conditions_matched,
        "total_conditions": 4,
        "games_queried": len(historical_games),
        "condition_breakdown": condition_breakdown,
    }


# ── Winner prop backtester (model self-accuracy) ─────────────────────────────────

def backtest_winner(game_id: int, game_date: str) -> Optional[dict]:
    """
    Estimate the predictive reliability of the winner model for today's matchup
    by replaying it over the home team's recent game history.

    Unlike player props and spread/total backtests — which compare against
    historical Kalshi lines — winner props have no usable historical lines.
    Instead, this function uses **model self-accuracy** as a proxy: it re-runs
    ``compute_game_strength`` + ``predict_winner`` for the last ``MIN_SAMPLE_SIZE``
    completed games involving the home team and checks whether the model would
    have called the correct winner each time.

    The result's ``conditions_matched`` field is set to the string
    ``"self_accuracy"`` (rather than an integer) to make clear to downstream
    callers that this is a different kind of backtest — not a condition-matched
    historical sample.

    Args:
        game_id:    Internal DB id (games.id) for today's game.
        game_date:  ISO date string "YYYY-MM-DD" for today's game.

    Returns:
        dict with keys:
            hit_rate            – float in [0,1]; fraction of replayed games
                                  where the model predicted the correct winner.
            sample_size         – int; number of games actually replayed (may be
                                  less than MIN_SAMPLE_SIZE if strength data was
                                  unavailable for some games).
            conditions_matched  – the string ``"self_accuracy"``; marks this as a
                                  model-accuracy proxy, not a true backtest.
            total_conditions    – 1 (nominal; there is only one "condition": the
                                  model's own output).
            condition_breakdown – dict with a ``"note"`` key explaining the proxy.
        None if:
            - ``game_id`` is not found in the ``games`` table.
            - Fewer than ``MIN_SAMPLE_SIZE`` prior completed games exist for the
              home team.
            - Fewer than ``MIN_SAMPLE_SIZE // 2`` games yielded valid strength
              data (too many skips due to insufficient historical stats).
    """
    from analytics.engine.game_model import compute_game_strength, predict_winner, HOME_BUMP
    from datetime import date as _date  # noqa: F401 (kept for potential future use)

    # ── 1. Fetch today's game ────────────────────────────────────────────────
    game_result = (
        supabase.table("games")
        .select("id,game_date,home_team_id,away_team_id")
        .eq("id", game_id)
        .limit(1)
        .execute()
    )
    if not game_result.data:
        print(f"  WARNING: game_id={game_id} not found in games table.")
        return None

    game_info = game_result.data[0]
    home_id = game_info["home_team_id"]
    away_id = game_info["away_team_id"]

    # ── 2. Fetch recent completed games involving the home team ──────────────
    # Fetch a larger window (MIN_SAMPLE_SIZE * 2) to account for skips due to
    # missing strength data, then trim to the first MIN_SAMPLE_SIZE with scores.
    fetch_limit = MIN_SAMPLE_SIZE * 2

    hist_result = (
        supabase.table("games")
        .select("id,game_date,home_team_id,away_team_id,home_score,away_score")
        .or_(f"home_team_id.eq.{home_id},away_team_id.eq.{home_id}")
        .lt("game_date", game_date)
        .order("game_date", desc=True)
        .limit(fetch_limit)
        .execute()
    )
    all_hist = hist_result.data or []

    # Keep only rows that have final scores
    completed = [g for g in all_hist if g.get("home_score") is not None]

    if len(completed) < MIN_SAMPLE_SIZE:
        print(
            f"  INFO: only {len(completed)} completed games (with scores) found "
            f"for home_team_id={home_id} before {game_date}. Need {MIN_SAMPLE_SIZE}. "
            "Returning None."
        )
        return None

    # ── 3. Replay the model over MIN_SAMPLE_SIZE historical games ────────────
    correct = 0
    total = 0

    for hgame in completed[:MIN_SAMPLE_SIZE]:
        gd = hgame["game_date"]
        hhome = hgame["home_team_id"]
        haway = hgame["away_team_id"]
        h_score = hgame["home_score"]
        a_score = hgame["away_score"]

        home_str = compute_game_strength(hhome, gd)
        away_str = compute_game_strength(haway, gd)

        if home_str is None or away_str is None:
            continue  # Insufficient data to run model for this game — skip

        # Apply the same home advantage bump the live model uses
        win_prob, _ = predict_winner(home_str + HOME_BUMP, away_str)

        model_predicted_home = win_prob >= 0.5
        actual_home_won = float(h_score) > float(a_score)

        if model_predicted_home == actual_home_won:
            correct += 1
        total += 1

    # ── 4. Guard against too many skips ─────────────────────────────────────
    if total < MIN_SAMPLE_SIZE // 2:
        print(
            f"  INFO: only {total} games had valid strength data out of "
            f"{MIN_SAMPLE_SIZE} candidates for home_team_id={home_id}. "
            "Too many skips — returning None."
        )
        return None

    # ── 5. Return result ─────────────────────────────────────────────────────
    return {
        "hit_rate": correct / total,
        "sample_size": total,
        "conditions_matched": "self_accuracy",
        "total_conditions": 1,
        "condition_breakdown": {
            "note": "model self-accuracy, not a true historical backtest"
        },
    }


# ── CLI ──────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="StatTrak condition-matched backtesting engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m analytics.engine.backtest --player-id 123 --stat pts --line 25.5 --date 2026-03-22
  python -m analytics.engine.backtest --game-id 456 --prop-type total --line 220.5 --date 2026-03-22
  python -m analytics.engine.backtest --game-id 456 --prop-type winner --date 2026-03-22
        """,
    )
    parser.add_argument("--player-id", type=int, dest="player_id",
                        help="Internal player DB id")
    parser.add_argument("--stat", choices=list(STAT_COLUMN_MAP.keys()),
                        help="Stat abbreviation (pts, reb, ast, fg3m)")
    parser.add_argument("--game-id", type=int, dest="game_id",
                        help="Internal game DB id (for game props)")
    parser.add_argument("--prop-type", choices=["total", "spread", "winner"], dest="prop_type",
                        help="Game prop type (total, spread, or winner)")
    parser.add_argument("--line", type=float, required=False, default=None,
                        help="The prop line to evaluate (e.g. 25.5); not required for --prop-type winner")
    parser.add_argument("--date", required=True,
                        help="Game date in YYYY-MM-DD format")

    args = parser.parse_args()

    if args.player_id is not None:
        if not args.stat:
            print("ERROR: --stat is required with --player-id")
            return 1
        result = backtest_player(args.player_id, args.stat, args.line, args.date)
        if result is None:
            print("Result: None (insufficient data or conditions missing)")
        else:
            print("Backtest result (player prop):")
            for k, v in result.items():
                if isinstance(v, dict):
                    print(f"  {k}:")
                    for ck, cv in v.items():
                        print(f"    {ck}: {cv}")
                elif isinstance(v, float):
                    print(f"  {k}: {v:.4f}")
                else:
                    print(f"  {k}: {v}")
        return 0

    if args.game_id is not None:
        if not args.prop_type:
            print("ERROR: --prop-type is required with --game-id")
            return 1
        if args.prop_type == "winner":
            result = backtest_winner(args.game_id, args.date)
        else:
            if args.line is None:
                print("ERROR: --line is required for --prop-type total or spread")
                return 1
            result = backtest_game_prop(args.game_id, args.prop_type, args.line, args.date)
        if result is None:
            print("Result: None (insufficient data or conditions missing)")
        else:
            label = "winner (model self-accuracy)" if args.prop_type == "winner" else "game prop"
            print(f"Backtest result ({label}):")
            for k, v in result.items():
                if isinstance(v, dict):
                    print(f"  {k}:")
                    for ck, cv in v.items():
                        print(f"    {ck}: {cv}")
                elif isinstance(v, float):
                    print(f"  {k}: {v:.4f}")
                else:
                    print(f"  {k}: {v}")
        return 0

    print("ERROR: provide either --player-id or --game-id")
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
