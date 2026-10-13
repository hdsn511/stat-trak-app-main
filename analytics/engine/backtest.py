"""
analytics/engine/backtest.py

Condition-matched backtesting engine for StatTrak Analytics.

For each player prop or game prop, finds historical games where the
contextual conditions were similar to today, then computes hit rates against a
given line. Uses ONLY basic ESPN box-score data (no advanced stats):
  - player props: minutes played, rest, home/away, opponent position-defense rank
  - game props:   each team's rolling points scored / allowed (final scores)

Condition loosening: if the initial query returns fewer than
MIN_SAMPLE_SIZE games, conditions are dropped one at a time in
CONDITION_DROP_ORDER until either the sample is large enough or we hit
the end of CONDITION_DROP_ORDER, at which point we return None.

CLI:
    python -m analytics.engine.backtest --player-id 123 --stat pts --line 25.5 --date 2026-03-22
    python -m analytics.engine.backtest --game-id 456 --prop-type total --line 220.5 --date 2026-03-22
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional

from analytics.db.connection import supabase, POSITION_GROUP_MAP  # noqa: F401
from analytics.engine.common import rest_category as _rest_category
from analytics.engine.common import weighted_hit_rate as _weighted_hit_rate_generic

# ── Tunable constants ────────────────────────────────────────────────────────────

MINUTES_BUCKET = 6.0
# +/- minutes around today's rolling-5-game minutes. Historical single-game
# minutes are matched against a 5-game average, so the window is deliberately
# wide (~1 std dev of a rotation player's game-to-game minutes). This is the
# only "opportunity" signal: it comes straight from the box score.

TEAM_POINTS_BUCKET_WIDTH = 5.0
# +/- points-per-game bucket applied to each of the four team-form conditions
# for game props (home points for/against, away points for/against), each a
# rolling TEAM_FORM_WINDOW-game average entering the game.

TEAM_FORM_WINDOW = 10
TEAM_FORM_MIN_GAMES = 5

MATCHUP_RANK_WINDOW = 12
# Opponent defensive rank window for player prop matchup filtering.
# Historical games are included only when |today_rank - hist_rank| <= this value.
# Replaces the previous 3-tier (tough/mid/soft) system which had hard cliffs at
# rank 10 and 20 boundaries. A window of 12 gives broader coverage during the
# playoffs when sample sizes are thin.
# Raise for more coverage; lower for stricter matching.

MAX_DAYS_REST = 10
# Historical games with days_rest > this value are excluded from the sample.
# Values above 10 indicate cross-season rows (first game back from summer break,
# 100-300+ days) which are meaningless context comparisons against mid-season rest.
# These pollute the "extended" rest bucket, causing the rest filter to discard
# nearly all valid candidates.

MIN_SAMPLE_SIZE = 8
# Hard floor. If fewer than this many matching historical games are found,
# we return None rather than report an unreliable hit rate.
# Increase to be more conservative; decrease to get more coverage at the
# cost of statistical reliability.

CONDITION_DROP_ORDER = ["home_away", "matchup_rank", "rest"]
# home_away → matchup_rank → rest, in that order. Rest is included
# because stored days_rest has had data-quality gaps (multi-game
# absences and across-season rows produce 50-450 day "rest" values that fail
# MAX_DAYS_REST). For players with limited normal-rest samples (e.g. centers
# pulled for foul trouble), the rest filter alone can collapse the sample to 0.
# Dropping it is preferable to returning None.

CONDITION_DROP_ORDER_EXTENDED_REST = ["rest", "home_away", "matchup_rank"]
# When a player has >= EXTENDED_REST_THRESHOLD days of rest (standard inter-round
# playoff wait), drop rest FIRST. The "extended" bucket (4+ days) is thin in
# history, so keeping it would exhaust all three drops to find MIN_SAMPLE_SIZE
# games, leaving cond=2/5 and killing confidence. Dropping rest first preserves
# the more signal-rich home/away and matchup conditions.

EXTENDED_REST_THRESHOLD = 7
# Days-rest value above which CONDITION_DROP_ORDER_EXTENDED_REST is used.
# 7 days covers standard inter-round waits (5-10 days) without touching
# typical b2b / short / normal rest scenarios.

PLAYER_TOTAL_CONDITIONS = 4
# Core player-prop conditions: minutes (non-droppable), rest, home_away,
# matchup_rank (droppable in CONDITION_DROP_ORDER).

# Picks v2: recency-weighted hit rate. weight_i = HIT_RATE_DECAY ** i where
# i=0 is the most recent matched historical game.
# Tuned 2026-05-03: 0.95 was too aggressive — a single recent miss could drop
# a 90%+ player to <60% weighted, killing the entire "safe pick" distribution.
# 0.98 still tilts toward recent form (10th game weight 0.82 vs 1.0) but does
# not let one bad night dominate.
HIT_RATE_DECAY = 0.98

# Picks v2: minimum historical samples required to *activate* the optional
# teammate-out condition. Below this we still match without it (to avoid losing
# the entire candidate when the teammate-out scenario hasn't occurred enough).
# TODO: raise this if 3-sample matches produce too-noisy condition activations.
MIN_TEAMMATE_HISTORICAL_SAMPLES = 3

STAT_COLUMN_MAP = {
    "pts":  "points",
    "reb":  "rebounds",
    "ast":  "assists",
    "fg3m": "three_points_made",
}
# Maps API-facing stat abbreviations to the actual column names in nba_player_stats.
# Add entries here as new stat types are supported by the pipeline.

STAT_OPP_RANK_COL = {
    "pts":  "opp_def_rank_position",
    "reb":  "opp_reb_rank_position",
    "ast":  "opp_ast_rank_position",
    "fg3m": "opp_fg3m_rank_position",
}
# Maps stat abbreviations to the daily_conditions column holding the opponent's
# position-defense rank for that specific stat. Using a stat-specific rank
# means a guard's fg3m backtest matches games where the opponent was also a
# good/bad 3PT defender, not just a good overall G-position defender.


# ── Helper functions ─────────────────────────────────────────────────────────────

# _rest_category is imported from analytics.engine.common (sport-neutral).


def _season_start(game_date: str) -> str:
    """Return the Oct-1 season boundary for the season containing game_date.

    Mirrors currentSeasonStart() in server/src/jobs/computeNBATrends.ts. Used to
    floor backtest queries so a player's (or team's) prior-season role, team, and
    form don't pollute the current-season sample. A game on/after Oct 1 belongs to
    that calendar year's season; before Oct 1 it belongs to the prior year's.

    Tradeoff: very early in a new season this tightens samples and a thin player
    may fall below MIN_SAMPLE_SIZE and return None (no pick) rather than a pick
    built on stale cross-season games — the conservative, correct default.
    """
    y, m, _d = game_date.split("-")
    year = int(y) if int(m) >= 10 else int(y) - 1
    return f"{year}-10-01"


def _weighted_hit_rate(historical_results: list[tuple[str, bool]]) -> float:
    """NBA wrapper around the shared recency-weighted hit rate, pinned to this
    engine's HIT_RATE_DECAY. Kept as a thin alias so call sites are unchanged."""
    return _weighted_hit_rate_generic(historical_results, HIT_RATE_DECAY)


def _player_season_history(player_id: int, season_start: str, before_date: str) -> list[dict]:
    """The player's current-season played games (minutes > 0), straight from
    nba_player_stats + games: {game_id, game_date, minutes, days_rest,
    home_away, opponent_team_id}. days_rest is calendar days since the player's
    previous played game; the season opener has days_rest None (excluded, like
    the old cross-season rows). Basic box-score data only — independent of the
    player_game_conditions table."""
    st = (
        supabase.table("nba_player_stats")
        .select("game_id,game_date,team_id,minutes_played")
        .eq("player_id", player_id)
        .gte("game_date", season_start)
        .lt("game_date", before_date)
        .gt("minutes_played", 0)
        .order("game_date")
        .execute()
    ).data or []
    if not st:
        return []
    gids = [r["game_id"] for r in st]
    games: dict[int, dict] = {}
    for i in range(0, len(gids), 100):
        res = (
            supabase.table("games")
            .select("id,home_team_id,away_team_id,game_type")
            .in_("id", gids[i:i + 100])
            .execute()
        )
        for g in (res.data or []):
            games[g["id"]] = g
    from datetime import date as _date
    out: list[dict] = []
    prev: Optional[_date] = None
    for r in st:
        gd = _date.fromisoformat(r["game_date"])
        g = games.get(r["game_id"])
        rest = (gd - prev).days if prev is not None else None
        prev = gd
        if not g or g.get("game_type") == "preseason":
            continue
        if r["team_id"] == g["home_team_id"]:
            ha, opp = "home", g["away_team_id"]
        elif r["team_id"] == g["away_team_id"]:
            ha, opp = "away", g["home_team_id"]
        else:
            continue
        out.append({
            "game_id": r["game_id"], "game_date": r["game_date"],
            "minutes": r["minutes_played"], "days_rest": rest,
            "home_away": ha, "opponent_team_id": opp,
        })
    return out


def _history_with_teammate_intersect(
    candidate_id: int,
    target_teammates: list[int],
) -> set[int]:
    """
    Return the set of game_ids where:
      - candidate_id played (had a nba_player_stats row with minutes>0), AND
      - at least one of `target_teammates` had status='out' on that same game_id
        (per player_availability).

    Used by the optional teammate-out condition to constrain historical samples
    to games where the candidate was playing without those specific teammates.
    """
    if not target_teammates:
        return set()

    # Candidate's history with team & game info
    own_games = (
        supabase.table("nba_player_stats")
        .select("game_id")
        .eq("player_id", candidate_id)
        .gt("minutes_played", 0)
        .execute()
    ).data or []
    own_game_ids = [r["game_id"] for r in own_games]
    if not own_game_ids:
        return set()

    # Chunked lookup of out-availability for those games
    matched: set[int] = set()
    chunk = 100
    for i in range(0, len(own_game_ids), chunk):
        ids_chunk = own_game_ids[i:i + chunk]
        res = (
            supabase.table("player_availability")
            .select("game_id,player_id")
            .in_("game_id", ids_chunk)
            .eq("status", "out")
            .in_("player_id", target_teammates)
            .execute()
        )
        for r in (res.data or []):
            matched.add(r["game_id"])
    return matched


def _matchup_rank_close(today_rank: Optional[int], hist_rank: Optional[int]) -> bool:
    """
    Return True when the historical opponent's defensive rank is within
    MATCHUP_RANK_WINDOW positions of today's opponent.

    Replaces the old 3-tier (tough/mid/soft) approach, which created hard
    context cliffs at ranks 10 and 20. A continuous window eliminates the
    cliff effect: rank-10 vs rank-11 opponents are now correctly treated as
    similar contexts rather than different tiers.

    Returns False when either rank is None (data unavailable).
    """
    if today_rank is None or hist_rank is None:
        return False
    return abs(today_rank - hist_rank) <= MATCHUP_RANK_WINDOW


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

    # Floor every historical lookup to the current season so a player's prior
    # role/team doesn't leak into the matched sample (see _season_start).
    season_start = _season_start(game_date)

    # ── 1. Load today's conditions ───────────────────────────────────────────
    dc_result = (
        supabase.table("daily_conditions")
        .select(
            "rolling_min_5g,days_rest,home_away,"
            "opp_def_rank_position,opp_reb_rank_position,"
            "opp_ast_rank_position,opp_fg3m_rank_position,"
            "key_teammates_out,game_id"
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
    today_min = dc.get("rolling_min_5g")
    today_rest = dc.get("days_rest")
    today_home_away = dc.get("home_away")
    today_game_id = dc.get("game_id")
    today_key_teammates_out = dc.get("key_teammates_out") or []

    # Use stat-specific opponent defense rank for matchup filtering.
    rank_col = STAT_OPP_RANK_COL.get(stat, "opp_def_rank_position")
    today_opp_rank = dc.get(rank_col) or dc.get("opp_def_rank_position")

    if today_min is None:
        print(
            f"  WARNING: rolling_min_5g is None for player_id={player_id} "
            f"on {game_date}. Cannot backtest."
        )
        return None

    # Default rest to "normal" if missing.
    if today_rest is None:
        today_rest = 3

    # ── 2. Compute condition ranges ──────────────────────────────────────────
    min_lo = today_min - MINUTES_BUCKET
    min_hi = today_min + MINUTES_BUCKET
    today_rest_cat = _rest_category(today_rest)

    # Condition state: minutes is non-droppable; home_away, matchup_rank, rest
    # are droppable in that order.
    droppable = {
        "home_away": True,
        "matchup_rank": True,
        "rest": True,
    }

    # ── Optional teammate-out condition ──────────────────────────────────────
    teammate_eligible = bool(today_key_teammates_out)
    teammate_active = False
    teammate_match_game_ids: set[int] = set()
    if teammate_eligible:
        teammate_match_game_ids = _history_with_teammate_intersect(
            player_id, today_key_teammates_out
        )
        if len(teammate_match_game_ids) >= MIN_TEAMMATE_HISTORICAL_SAMPLES:
            teammate_active = True

    # Season history (basic box score + games), loaded once per call.
    history = _player_season_history(player_id, season_start, game_date)

    # ── 3. Iteratively loosen until we have enough samples ───────────────────
    drop_order = (
        CONDITION_DROP_ORDER_EXTENDED_REST
        if today_rest >= EXTENDED_REST_THRESHOLD
        else CONDITION_DROP_ORDER
    )
    drop_idx = 0  # pointer into drop_order

    while True:
        # ── Candidate games: minutes in range, no cross-season rest gaps ─────
        candidate_rows = [
            h for h in history
            if min_lo <= h["minutes"] <= min_hi
            and h["days_rest"] is not None
            and h["days_rest"] <= MAX_DAYS_REST
            and (today_game_id is None or h["game_id"] != today_game_id)
        ]

        # ── Filter rest, home_away (droppable), teammate (optional) ──
        filtered_game_ids: list[int] = []
        for row in candidate_rows:
            # Rest filter — droppable
            if droppable["rest"]:
                row_rest_cat = _rest_category(row["days_rest"])
                if row_rest_cat != today_rest_cat:
                    continue

            # Home/away filter — droppable
            if droppable["home_away"]:
                if row.get("home_away") != today_home_away:
                    continue

            # Optional teammate-out filter
            if teammate_active and row["game_id"] not in teammate_match_game_ids:
                continue

            filtered_game_ids.append(row["game_id"])

        # ── Matchup rank filtering (batch) ────────────────────────────────────
        if droppable["matchup_rank"] and filtered_game_ids and today_opp_rank is not None:
            rank_result = (
                supabase.table("daily_conditions")
                .select(
                    "game_id,opp_def_rank_position,"
                    "opp_reb_rank_position,opp_ast_rank_position,opp_fg3m_rank_position"
                )
                .eq("player_id", player_id)
                .in_("game_id", filtered_game_ids)
                .execute()
            )
            rank_map: dict[int, Optional[int]] = {
                tr["game_id"]: (tr.get(rank_col) or tr.get("opp_def_rank_position"))
                for tr in (rank_result.data or [])
            }
            filtered_game_ids = [
                gid for gid in filtered_game_ids
                if _matchup_rank_close(today_opp_rank, rank_map.get(gid))
            ]

        sample_size = len(filtered_game_ids)

        if sample_size >= MIN_SAMPLE_SIZE:
            break

        # ── Loosen one droppable condition if possible ───────────────────────
        if drop_idx >= len(drop_order):
            print(
                f"  INFO: only {sample_size} matching games for player_id={player_id} "
                f"stat={stat} after loosening all allowed conditions. Returning None."
            )
            return None
        condition_to_drop = drop_order[drop_idx]
        droppable[condition_to_drop] = False
        drop_idx += 1
        # Loop back and re-query with the relaxed condition set

    # ── 4. Fetch actual stats + game_date for matching games (weighted hit rate) ──
    if not filtered_game_ids:
        return None

    stats_result = (
        supabase.table("nba_player_stats")
        .select(f"{stat_col},game_date,game_id")
        .eq("player_id", player_id)
        .in_("game_id", filtered_game_ids)
        .gt("minutes_played", 0)
        .execute()
    )
    stat_rows = stats_result.data or []

    valid = [
        (r["game_date"], r[stat_col])
        for r in stat_rows
        if r.get(stat_col) is not None and r.get("game_date")
    ]
    if len(valid) < MIN_SAMPLE_SIZE:
        return None

    # ── 5. Compute recency-weighted hit rate ─────────────────────────────────
    valid.sort(key=lambda x: x[0], reverse=True)  # most recent first
    historical_results = [(d, v > line) for d, v in valid]
    hit_rate = _weighted_hit_rate(historical_results)

    # Core condition count (excludes the optional teammate condition)
    conditions_matched = 1 + sum(1 for v in droppable.values() if v)  # 1 = minutes (non-droppable)

    # ── 6. Build condition breakdown ─────────────────────────────────────────
    condition_breakdown = {
        "minutes":          "active",
        "rest":             "active" if droppable["rest"] else "dropped",
        "home_away":        "active" if droppable["home_away"] else "dropped",
        "matchup_rank":     "active" if droppable["matchup_rank"] else "dropped",
        "key_teammate_out": (
            "active" if teammate_active
            else ("inactive" if not teammate_eligible else "insufficient_sample")
        ),
    }

    return {
        "hit_rate": hit_rate,
        "sample_size": len(valid),
        "conditions_matched": conditions_matched,
        "total_conditions": PLAYER_TOTAL_CONDITIONS,  # excludes optional teammate
        "games_queried": len(filtered_game_ids),
        "condition_breakdown": condition_breakdown,
        "key_teammate_out_active": teammate_active,
    }


# ── Shared data loaders (call once per run, pass to backtest_game_prop) ──────────

def build_team_form_cache(completed_games: list) -> dict:
    """Per-game team scoring form entering each game, from final scores only.

    Returns {game_id: {team_id: {"pf": avg points for, "pa": avg points
    against}}} where each average covers that team's previous
    TEAM_FORM_WINDOW completed games in the SAME season (Oct-1 floor), and the
    team has at least TEAM_FORM_MIN_GAMES of them. Games without enough prior
    history for a team are omitted for that team.
    """
    by_team: dict[int, list[tuple[str, int, float, float]]] = {}
    for g in completed_games:
        if g.get("home_score") is None or g.get("away_score") is None:
            continue
        hs, a_s = float(g["home_score"]), float(g["away_score"])
        by_team.setdefault(g["home_team_id"], []).append((g["game_date"], g["id"], hs, a_s))
        by_team.setdefault(g["away_team_id"], []).append((g["game_date"], g["id"], a_s, hs))

    cache: dict[int, dict[int, dict]] = {}
    for team_id, rows in by_team.items():
        rows.sort(key=lambda r: (r[0], r[1]))
        for i, (gd, gid, _pf, _pa) in enumerate(rows):
            floor = _season_start(gd)
            prior = [r for r in rows[max(0, i - TEAM_FORM_WINDOW):i] if r[0] >= floor]
            if len(prior) < TEAM_FORM_MIN_GAMES:
                continue
            cache.setdefault(gid, {})[team_id] = {
                "pf": sum(r[2] for r in prior) / len(prior),
                "pa": sum(r[3] for r in prior) / len(prior),
            }
    return cache


def team_form_before(completed_games: list, team_id: int, game_date: str) -> Optional[dict]:
    """Team's current-season rolling points for/against before game_date."""
    floor = _season_start(game_date)
    rows = []
    for g in completed_games:
        if g["game_date"] >= game_date or g["game_date"] < floor:
            continue
        if g.get("home_score") is None or g.get("away_score") is None:
            continue
        if g["home_team_id"] == team_id:
            rows.append((g["game_date"], float(g["home_score"]), float(g["away_score"])))
        elif g["away_team_id"] == team_id:
            rows.append((g["game_date"], float(g["away_score"]), float(g["home_score"])))
    rows.sort(reverse=True)
    rows = rows[:TEAM_FORM_WINDOW]
    if len(rows) < TEAM_FORM_MIN_GAMES:
        return None
    return {"pf": sum(r[1] for r in rows) / len(rows),
            "pa": sum(r[2] for r in rows) / len(rows)}


def load_completed_games(before_date: str) -> list:
    """Load all completed games (regular season + playoffs) before a date.

    Excludes preseason games only. Including playoff history is necessary
    during the postseason so that game prop backtests have any data at all —
    the team-form condition filters will naturally select contextually
    similar games regardless of game_type.

    NOTE: deliberately NOT season-floored (unlike the player backtest and
    _rolling_team_stats). This is the comparison pool for total/spread props,
    matched purely on each team's rolling points for/against — a high-scoring
    matchup two seasons ago is still a valid context, and roster identity doesn't
    enter the match.
    The volume from prior seasons improves coverage when the bucket filters are
    strict. Today's team *form*, by contrast, is current-season only.

    Uses manual pagination to bypass PostgREST's 1000-row default cap.
    """
    rows: list[dict] = []
    page, page_size = 0, 1000
    while True:
        start = page * page_size
        result = (
            supabase.table("games")
            .select("id,home_team_id,away_team_id,home_score,away_score,game_date,game_type")
            .lt("game_date", before_date)
            .neq("game_type", "preseason")
            .not_.is_("home_score", "null")
            .not_.is_("away_score", "null")
            .order("id")
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return rows


# ── Game prop backtester ─────────────────────────────────────────────────────────

def backtest_game_prop(
    game_id: int,
    prop_type: str,
    line: float,
    game_date: str,
    form_cache: Optional[dict] = None,
    completed_games: Optional[list] = None,
) -> Optional[dict]:
    """
    Find historical games where both teams entered with similar scoring form
    (rolling points for / against) to today's matchup, then compute hit rates
    for the given game prop.

    Supported prop_type values: "total" (home+away combined score),
    "spread" (home_score - away_score).

    Args:
        game_id:         Internal DB id (games.id) for today's game.
        prop_type:       "total" or "spread".
        line:            The line to beat.
        game_date:       ISO date string "YYYY-MM-DD" for today's game.
        form_cache:      Pre-built build_team_form_cache(completed_games). If
                         None, built from completed_games.
        completed_games: Pre-loaded list of completed historical games. If None, loads from DB.

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

    # ── 2. Load historical games (once per run) ──────────────────────────────
    historical_games = completed_games if completed_games is not None else load_completed_games(game_date)
    if not historical_games:
        print("  WARNING: no historical games with scores found.")
        return None

    # ── 3. Today's rolling team scoring form ─────────────────────────────────
    home_form = team_form_before(historical_games, home_team_id, game_date)
    away_form = team_form_before(historical_games, away_team_id, game_date)
    if home_form is None or away_form is None:
        print(
            f"  WARNING: insufficient completed games for game_id={game_id} "
            "to compute rolling team scoring form. Skipping."
        )
        return None

    _form = form_cache if form_cache is not None else build_team_form_cache(historical_games)

    # ── 4. Match historical games by conditions ──────────────────────────────
    matched_actuals: list[float] = []

    for hgame in historical_games:
        hgid = hgame["id"]
        hform = _form.get(hgid, {})
        h = hform.get(hgame["home_team_id"])
        a = hform.get(hgame["away_team_id"])
        if h is None or a is None:
            continue  # not enough prior games for one of the teams

        if abs(h["pf"] - home_form["pf"]) > TEAM_POINTS_BUCKET_WIDTH:
            continue
        if abs(h["pa"] - home_form["pa"]) > TEAM_POINTS_BUCKET_WIDTH:
            continue
        if abs(a["pf"] - away_form["pf"]) > TEAM_POINTS_BUCKET_WIDTH:
            continue
        if abs(a["pa"] - away_form["pa"]) > TEAM_POINTS_BUCKET_WIDTH:
            continue

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
        return None

    # ── 5. Compute hit rate ──────────────────────────────────────────────────
    hits = sum(1 for v in matched_actuals if v > line)
    hit_rate = hits / sample_size

    condition_breakdown = {
        "home_points_for": "active",
        "home_points_against": "active",
        "away_points_for": "active",
        "away_points_against": "active",
    }

    return {
        "hit_rate": hit_rate,
        "sample_size": sample_size,
        "conditions_matched": 4,
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
    from datetime import date as _date

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
        gd_str = hgame["game_date"]
        hhome = hgame["home_team_id"]
        haway = hgame["away_team_id"]
        h_score = hgame["home_score"]
        a_score = hgame["away_score"]

        gd_date = _date.fromisoformat(gd_str)
        home_str = compute_game_strength(hhome, gd_date)
        away_str = compute_game_strength(haway, gd_date)

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
