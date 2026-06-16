"""
analytics/engine/backtest_mlb.py

MLB condition-matched backtester — the MLB engine. Same *method* as the NBA
backtester (analytics/engine/backtest.py): find historical games where this
player faced similar conditions to today, then compute a recency-weighted hit
rate against a line, loosening conditions until the sample is large enough.

Only the inputs differ from NBA:
  - Stat columns: hits / total_bases / rbi / runs / home_runs (batters),
    strikeouts_pitched (pitcher "ks").
  - Opportunity signal: rolling plate appearances (batters) / pitcher outs.
  - Matchup signal: opposing starter HANDEDNESS (L/R) — the dominant baseball
    platoon effect — instead of NBA opponent position-defense rank.

Shared with NBA: recency weighting + rest bucketing (analytics/engine/common.py)
and the scorer (analytics/engine/scorer.py).

CLI:
    python -m analytics.engine.backtest_mlb --player-id 123 --stat hits --line 1.5 --date 2026-06-11
"""

from __future__ import annotations

import argparse
import math
import sys
from typing import Optional

from analytics.db.connection import supabase, MLB_LEAGUE_ID, MLB_STAT_COLUMN_MAP, mlb_value_cols
from analytics.engine.common import weighted_hit_rate

# ── Tunables ────────────────────────────────────────────────────────────────────
HIT_RATE_DECAY = 0.98          # same recency decay as NBA
MIN_SAMPLE_SIZE = 8            # hard floor (matches scorer.MIN_SAMPLE_SIZE)

PA_BUCKET = 1.5                # ± plate appearances around today's rolling avg
OUTS_BUCKET = 6.0             # ± pitcher outs (≈ 2 innings) for the "ks" prop

# Batter core conditions: opportunity (non-droppable) + handedness + home_away.
BATTER_DROP_ORDER = ["home_away", "handedness"]  # drop weakest first; keep platoon longest
BATTER_TOTAL_CONDITIONS = 3
# Pitcher core conditions: opportunity (non-droppable) + home_away.
PITCHER_DROP_ORDER = ["home_away"]
PITCHER_TOTAL_CONDITIONS = 2

PITCHER_STATS = {"ks"}


def _home_away_for_games(player_id: int, game_ids: list[int]) -> dict[int, str]:
    """game_id -> home_away for this player's historical games."""
    out: dict[int, str] = {}
    for i in range(0, len(game_ids), 100):
        chunk = game_ids[i:i + 100]
        rows = (supabase.table("mlb_player_game_conditions")
                .select("game_id,home_away").eq("player_id", player_id)
                .in_("game_id", chunk).execute()).data or []
        for r in rows:
            out[r["game_id"]] = r.get("home_away")
    return out


# ── Batter props ────────────────────────────────────────────────────────────────

def _backtest_batter(player_id: int, stat: str, stat_cols: list[str], line: float,
                     game_date: str) -> Optional[dict]:
    dc = (supabase.table("mlb_daily_conditions")
          .select("rolling_pa_5g,opp_starter_hand,home_away,game_id")
          .eq("player_id", player_id).eq("game_date", game_date).limit(1).execute()).data
    if not dc:
        return None
    dc = dc[0]
    today_pa = dc.get("rolling_pa_5g")
    today_hand = dc.get("opp_starter_hand")
    today_home_away = dc.get("home_away")
    today_game_id = dc.get("game_id")
    if today_pa is None:
        return None

    # plate_appearances is SMALLINT — use integer bucket bounds.
    pa_lo, pa_hi = math.floor(today_pa - PA_BUCKET), math.ceil(today_pa + PA_BUCKET)
    droppable = {"handedness": bool(today_hand), "home_away": today_home_away is not None}
    drop_idx = 0

    filtered_game_ids: list[int] = []
    while True:
        rows = (supabase.table("mlb_player_game_conditions")
                .select("game_id,home_away,opp_starter_hand,plate_appearances")
                .eq("player_id", player_id)
                .gte("plate_appearances", pa_lo).lte("plate_appearances", pa_hi)
                .execute()).data or []
        filtered_game_ids = []
        for r in rows:
            if today_game_id is not None and r["game_id"] == today_game_id:
                continue
            if droppable["handedness"] and r.get("opp_starter_hand") != today_hand:
                continue
            if droppable["home_away"] and r.get("home_away") != today_home_away:
                continue
            filtered_game_ids.append(r["game_id"])
        if len(filtered_game_ids) >= MIN_SAMPLE_SIZE:
            break
        if drop_idx >= len(BATTER_DROP_ORDER):
            return None
        droppable[BATTER_DROP_ORDER[drop_idx]] = False
        drop_idx += 1

    return _finish(player_id, stat_cols, line, filtered_game_ids,
                   conditions_active=1 + sum(1 for v in droppable.values() if v),
                   total_conditions=BATTER_TOTAL_CONDITIONS,
                   breakdown={
                       "opportunity": "active(pa)",
                       "handedness": "active" if droppable["handedness"] else "dropped",
                       "home_away": "active" if droppable["home_away"] else "dropped",
                   })


# ── Pitcher strikeouts ───────────────────────────────────────────────────────────

def _backtest_pitcher_ks(player_id: int, line: float, game_date: str) -> Optional[dict]:
    dc = (supabase.table("mlb_daily_conditions")
          .select("rolling_outs_5g,home_away,game_id")
          .eq("player_id", player_id).eq("game_date", game_date).limit(1).execute()).data
    if not dc:
        return None
    dc = dc[0]
    today_outs = dc.get("rolling_outs_5g")
    today_home_away = dc.get("home_away")
    today_game_id = dc.get("game_id")
    if today_outs is None:
        return None

    # outs_pitched is SMALLINT — use integer bucket bounds.
    lo, hi = math.floor(today_outs - OUTS_BUCKET), math.ceil(today_outs + OUTS_BUCKET)
    droppable = {"home_away": today_home_away is not None}
    drop_idx = 0

    while True:
        rows = (supabase.table("mlb_player_stats")
                .select("game_id,outs_pitched").eq("player_id", player_id)
                .gte("outs_pitched", lo).lte("outs_pitched", hi)
                .gt("batters_faced", 0).execute()).data or []
        cand = [r["game_id"] for r in rows if r["game_id"] != today_game_id]
        if droppable["home_away"] and cand:
            ha = _home_away_for_games(player_id, cand)
            cand = [g for g in cand if ha.get(g) == today_home_away]
        if len(cand) >= MIN_SAMPLE_SIZE:
            filtered_game_ids = cand
            break
        if drop_idx >= len(PITCHER_DROP_ORDER):
            return None
        droppable[PITCHER_DROP_ORDER[drop_idx]] = False
        drop_idx += 1

    return _finish(player_id, ["strikeouts_pitched"], line, filtered_game_ids,
                   conditions_active=1 + sum(1 for v in droppable.values() if v),
                   total_conditions=PITCHER_TOTAL_CONDITIONS,
                   breakdown={
                       "opportunity": "active(outs)",
                       "home_away": "active" if droppable["home_away"] else "dropped",
                   })


# ── Shared finish: fetch outcomes, weighted hit rate ─────────────────────────────

def _finish(player_id: int, stat_cols: list[str], line: float, game_ids: list[int],
            conditions_active: int, total_conditions: int,
            breakdown: dict) -> Optional[dict]:
    if not game_ids:
        return None
    sel = ",".join([*stat_cols, "game_date", "game_id"])
    rows: list[dict] = []
    for i in range(0, len(game_ids), 200):
        chunk = game_ids[i:i + 200]
        rows.extend((supabase.table("mlb_player_stats")
                     .select(sel).eq("player_id", player_id)
                     .in_("game_id", chunk).execute()).data or [])
    # value = SUM of component columns (1 col for normal stats, 3 for HRR combo)
    valid = [(r["game_date"], sum(r[c] for c in stat_cols)) for r in rows
             if all(r.get(c) is not None for c in stat_cols) and r.get("game_date")]
    if len(valid) < MIN_SAMPLE_SIZE:
        return None
    valid.sort(key=lambda x: x[0], reverse=True)
    historical = [(d, v > line) for d, v in valid]
    return {
        "hit_rate": weighted_hit_rate(historical, HIT_RATE_DECAY),
        "sample_size": len(valid),
        "conditions_matched": conditions_active,
        "total_conditions": total_conditions,
        "games_queried": len(game_ids),
        "condition_breakdown": breakdown,
        "key_teammate_out_active": False,
    }


# ── Public entry point (same signature as NBA backtest_player) ───────────────────

def backtest_player(player_id: int, stat: str, line: float, game_date: str) -> Optional[dict]:
    cols = mlb_value_cols(stat)
    if not cols:
        print(f"  ERROR: unsupported MLB stat '{stat}'.")
        return None
    if stat in PITCHER_STATS:
        return _backtest_pitcher_ks(player_id, line, game_date)
    return _backtest_batter(player_id, stat, cols, line, game_date)


# ── Game props (totals + run line) ───────────────────────────────────────────────

GAME_LOOKBACK = 25  # recent completed games per team to pool


def _team_recent_games(team_id: int, game_date: str) -> list[dict]:
    """This team's completed games before game_date (most recent first), with
    the team's own score, opponent score, and the game total."""
    rows = (supabase.table("games")
            .select("game_date,home_team_id,away_team_id,home_score,away_score")
            .eq("league_id", MLB_LEAGUE_ID)
            .or_(f"home_team_id.eq.{team_id},away_team_id.eq.{team_id}")
            .lt("game_date", game_date)
            .not_.is_("home_score", "null")
            .order("game_date", desc=True).limit(GAME_LOOKBACK).execute()).data or []
    out = []
    for g in rows:
        is_home = g["home_team_id"] == team_id
        team_score = g["home_score"] if is_home else g["away_score"]
        opp_score = g["away_score"] if is_home else g["home_score"]
        out.append({"game_date": g["game_date"],
                    "total": (g["home_score"] or 0) + (g["away_score"] or 0),
                    "margin": (team_score or 0) - (opp_score or 0)})
    return out


def _game_teams(game_id: int) -> Optional[tuple[int, int]]:
    g = (supabase.table("games").select("home_team_id,away_team_id")
         .eq("id", game_id).limit(1).execute()).data
    return (g[0]["home_team_id"], g[0]["away_team_id"]) if g else None


def _abbr_to_team_id(abbr: str) -> Optional[int]:
    r = (supabase.table("teams").select("id")
         .eq("league_id", MLB_LEAGUE_ID).eq("abbreviation", abbr).limit(1).execute()).data
    return r[0]["id"] if r else None


def backtest_game(game_id: int, prop_type: str, line: float, game_date: str,
                  team_abbr: Optional[str] = None) -> Optional[dict]:
    """Empirical game-prop backtest.
      total  -> pool both teams' recent game totals; hit = total > line.
      spread -> the team_abbr team's recent margins; hit = margin > line
                ("{team} wins by over {line} runs").
    """
    teams = _game_teams(game_id)
    if not teams:
        return None
    home_id, away_id = teams

    if prop_type == "total":
        pooled = _team_recent_games(home_id, game_date) + _team_recent_games(away_id, game_date)
        if len(pooled) < MIN_SAMPLE_SIZE:
            return None
        pooled.sort(key=lambda x: x["game_date"], reverse=True)
        historical = [(g["game_date"], g["total"] > line) for g in pooled]
        breakdown = {"run_environment": "active(both teams)"}
    elif prop_type == "spread":
        team_id = _abbr_to_team_id(team_abbr) if team_abbr else None
        if team_id is None:
            return None
        games = _team_recent_games(team_id, game_date)
        if len(games) < MIN_SAMPLE_SIZE:
            return None
        historical = [(g["game_date"], g["margin"] > line) for g in games]
        breakdown = {"team_margin": f"active({team_abbr})"}
    else:
        return None

    return {
        "hit_rate": weighted_hit_rate(historical, HIT_RATE_DECAY),
        "sample_size": len(historical),
        "conditions_matched": 1,
        "total_conditions": 1,
        "games_queried": len(historical),
        "condition_breakdown": breakdown,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="MLB condition-matched backtester")
    parser.add_argument("--player-id", type=int, required=True)
    parser.add_argument("--stat", type=str, required=True)
    parser.add_argument("--line", type=float, required=True)
    parser.add_argument("--date", type=str, required=True)
    args = parser.parse_args()
    result = backtest_player(args.player_id, args.stat, args.line, args.date)
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
