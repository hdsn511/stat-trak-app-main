"""
analytics/batch/nightly.py

Nightly batch processor. Runs ~2am to prepare daily_conditions for upcoming games.

Steps:
  0. reconcile_picks(yesterday)    -- fill actual_result / did_hit on pick_results
  1. get_slate(target_date)        -- fetch today's/tomorrow's game list
  2+3. compute_daily_conditions()  -- rolling avgs, usage, rest, opponent rank -> daily_conditions

CLI:
    python -m analytics.batch.nightly --date 2026-03-22
    python -m analytics.batch.nightly --test
    (default target date = tomorrow)
"""

from __future__ import annotations

import argparse
import re
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from datetime import date, datetime, timedelta
from typing import Optional

from analytics.db.connection import (
    API_DELAY_SECONDS,
    BATCH_SIZE,
    NBA_LEAGUE_ID,
    POSITION_GROUP_MAP,
    season_int_to_str,
    supabase,
)
from analytics.data.enrich_games import api_call_with_retry, _parse_minutes


# ── Picks v2 tunables ─────────────────────────────────────────────────────────
# TODO: tune against observed lineup behavior. 3 captures the team's primary
# creators without dragging in role players whose absence has minimal lineup impact.
TOP_USAGE_TEAMMATE_COUNT = 3

# TODO: window N=7 chosen as "recent enough to capture trend, not so short as to
# be noisy". Recalibrate after collecting recent_opp_form data for a full season.
RECENT_OPP_FORM_WINDOW = 7


# ── Helpers ──────────────────────────────────────────────────────────────────

def _date_str(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def _safe_avg(values: list) -> Optional[float]:
    """Return mean of non-None values, or None if empty."""
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return sum(clean) / len(clean)


def _season_start_iso(target_date_str: str) -> str:
    """
    Return the ISO date string for the start of the NBA season containing
    target_date_str. NBA seasons run Oct of year Y through Jun of year Y+1,
    so the season-start year = Y when month >= 10, else Y-1, with start
    fixed at Oct 1.
    """
    y = int(target_date_str[:4])
    m = int(target_date_str[5:7])
    season_year = y if m >= 10 else y - 1
    return f"{season_year}-10-01"


def _compute_recent_opp_form(
    opponent_team_id: int,
    target_date_str: str,
) -> dict[str, Optional[float]]:
    """
    Returns {pts, reb, ast, fg3m} where each value is
    (opp_last_N_avg_allowed / opp_season_avg_allowed) - 1.0.
    Allowed = stat scored against `opponent_team_id` by opposing players in
    completed games this season, prior to `target_date_str`.
    """
    season_start = _season_start_iso(target_date_str)

    # Find this team's games this season prior to target date
    games_res = (
        supabase.table("games")
        .select("id,game_date,home_team_id,away_team_id")
        .eq("league_id", NBA_LEAGUE_ID)
        .gte("game_date", season_start)
        .lt("game_date", target_date_str)
        .or_(f"home_team_id.eq.{opponent_team_id},away_team_id.eq.{opponent_team_id}")
        .execute()
    )
    team_games = games_res.data or []
    if not team_games:
        return {"pts": None, "reb": None, "ast": None, "fg3m": None}

    game_ids = [g["id"] for g in team_games]
    game_to_date: dict[int, str] = {g["id"]: g["game_date"] for g in team_games}

    # Pull stats for ALL players in these games — we filter to the ones whose
    # team is NOT opponent_team_id (i.e. the opposing team's players that
    # scored against opponent_team_id).
    stat_rows: list[dict] = []
    chunk = 80
    for i in range(0, len(game_ids), chunk):
        ids_chunk = game_ids[i:i + chunk]
        page, page_size = 0, 1000
        while True:
            start = page * page_size
            res = (
                supabase.table("nba_player_stats")
                .select("game_id,team_id,points,rebounds,assists,three_points_made")
                .in_("game_id", ids_chunk)
                .range(start, start + page_size - 1)
                .execute()
            )
            batch = res.data or []
            stat_rows.extend(batch)
            if len(batch) < page_size:
                break
            page += 1

    # Aggregate per-game opponent totals (sum across opposing players in each game)
    per_game: dict[int, dict[str, float]] = {}
    for r in stat_rows:
        if r["team_id"] == opponent_team_id:
            continue  # we only want opposing-team rows
        g = per_game.setdefault(r["game_id"], {"pts": 0.0, "reb": 0.0, "ast": 0.0, "fg3m": 0.0})
        g["pts"]  += r.get("points") or 0
        g["reb"]  += r.get("rebounds") or 0
        g["ast"]  += r.get("assists") or 0
        g["fg3m"] += r.get("three_points_made") or 0

    if not per_game:
        return {"pts": None, "reb": None, "ast": None, "fg3m": None}

    # Sort game_ids by date desc, take last N for the recent window
    sorted_gids = sorted(per_game.keys(), key=lambda gid: game_to_date.get(gid, ""), reverse=True)
    recent_gids = sorted_gids[:RECENT_OPP_FORM_WINDOW]

    def _form(stat_key: str) -> Optional[float]:
        season_vals = [per_game[gid][stat_key] for gid in sorted_gids]
        recent_vals = [per_game[gid][stat_key] for gid in recent_gids]
        if not season_vals or not recent_vals:
            return None
        season_avg = sum(season_vals) / len(season_vals)
        recent_avg = sum(recent_vals) / len(recent_vals)
        if season_avg == 0:
            return None
        return (recent_avg / season_avg) - 1.0

    return {
        "pts":  _form("pts"),
        "reb":  _form("reb"),
        "ast":  _form("ast"),
        "fg3m": _form("fg3m"),
    }


# ── Step 0: Reconcile Picks ───────────────────────────────────────────────────

def reconcile_picks(yesterday: date) -> None:
    """
    Fill actual_result and did_hit for pick_results rows from yesterday
    that are still unresolved.

    For player props, looks up nba_player_stats for the matching stat column.
    For game props (total/spread), looks up games scores.

    If no actual data is found yet, attempts to fetch yesterday's box scores
    via BoxScoreTraditionalV2 and inserts them into nba_player_stats first.
    """
    yest_str = _date_str(yesterday)
    print(f"[Step 0] Reconciling picks for {yest_str} ...")

    # Fetch unresolved picks from yesterday
    result = (
        supabase.table("pick_results")
        .select("*")
        .eq("game_date", yest_str)
        .is_("actual_result", "null")
        .execute()
    )
    picks = result.data or []

    if not picks:
        print("  No unresolved picks for yesterday. Skipping.")
        return

    print(f"  Found {len(picks)} unresolved pick(s).")

    # Check whether nba_player_stats has any rows for yesterday
    stat_check = (
        supabase.table("nba_player_stats")
        .select("player_id")
        .eq("game_date", yest_str)
        .limit(1)
        .execute()
    )
    has_stats = bool(stat_check.data)

    if not has_stats:
        print("  No nba_player_stats rows found for yesterday. Attempting fresh box score fetch ...")
        # Look up game ext_ids from DB first — avoids LeagueGameFinder (times out on GH Actions)
        game_rows = (
            supabase.table("games")
            .select("ext_id")
            .eq("game_date", yest_str)
            .eq("league_id", NBA_LEAGUE_ID)
            .execute()
        )
        known_ext_ids = [r["ext_id"] for r in (game_rows.data or [])] or None
        _fetch_and_insert_box_scores(yesterday, game_ext_ids=known_ext_ids)

    # ── Resolve player props ─────────────────────────────────────────────────
    PROP_STAT_MAP = {
        # Short-form keys (stored in pick_results.stat by generate.py)
        "pts":  "points",
        "reb":  "rebounds",
        "ast":  "assists",
        "fg3m": "three_points_made",
        # Long-form aliases for forward compatibility
        "points":            "points",
        "rebounds":          "rebounds",
        "assists":           "assists",
        "three_points_made": "three_points_made",
    }

    # ── Resolve game props ───────────────────────────────────────────────────
    GAME_PROP_TYPES = {"total", "spread"}

    resolved = 0
    for pick in picks:
        prop_type: str = (pick.get("prop_type") or "").lower()
        entity_id = pick.get("entity_id")
        stat_key: str = (pick.get("stat") or "").lower()
        line = pick.get("recommended_line")
        pick_id = pick.get("id")

        actual: Optional[float] = None

        if prop_type in GAME_PROP_TYPES:
            # entity_id is a game id for game props
            game_res = (
                supabase.table("games")
                .select("home_score,away_score")
                .eq("id", entity_id)
                .limit(1)
                .execute()
            )
            game_rows = game_res.data or []
            if game_rows:
                g = game_rows[0]
                h = g.get("home_score")
                a = g.get("away_score")
                if h is not None and a is not None:
                    if prop_type == "total":
                        actual = float(h) + float(a)
                    elif prop_type == "spread":
                        actual = float(h) - float(a)

        elif stat_key in PROP_STAT_MAP:
            # entity_id is a player id for player props
            db_col = PROP_STAT_MAP[stat_key]
            stat_res = (
                supabase.table("nba_player_stats")
                .select(db_col)
                .eq("player_id", entity_id)
                .eq("game_date", yest_str)
                .limit(1)
                .execute()
            )
            stat_rows = stat_res.data or []
            if stat_rows:
                actual = stat_rows[0].get(db_col)
                if actual is not None:
                    actual = float(actual)

        if actual is None:
            print(f"  WARNING: could not resolve pick id={pick_id} (entity={entity_id}, stat={stat_key})")
            continue

        did_hit = (actual > float(line)) if line is not None else None

        supabase.table("pick_results").update(
            {"actual_result": actual, "did_hit": did_hit}
        ).eq("id", pick_id).execute()
        resolved += 1

    print(f"  Resolved {resolved}/{len(picks)} picks.")


def _fetch_and_insert_box_scores(
    target_date: date,
    game_ext_ids: Optional[list] = None,
) -> None:
    """
    Fetch box scores for target_date via BoxScoreTraditionalV3 and insert rows
    into nba_player_stats.

    If game_ext_ids is provided (list of zero-padded strings from the DB), use
    them directly. Otherwise fall back to LeagueGameFinder.

    Pre-season game IDs (prefix "001") are silently skipped — the NBA stats
    API does not expose pre-season box scores via this endpoint.
    """
    try:
        from nba_api.stats.endpoints import BoxScoreTraditionalV3, BoxScoreTraditionalV2, LeagueGameFinder
    except ImportError as exc:
        print(f"  ERROR: nba_api not installed: {exc}")
        return

    date_str = _date_str(target_date)

    if game_ext_ids is None:
        # Fall back: discover game IDs via LeagueGameFinder
        def _find_games():
            return LeagueGameFinder(
                date_from_nullable=date_str,
                date_to_nullable=date_str,
                league_id_nullable="00",
            )

        lgf = api_call_with_retry(_find_games, f"LeagueGameFinder {date_str}")
        if lgf is None:
            print("  WARNING: LeagueGameFinder returned nothing for box score fetch.")
            return

        try:
            df = lgf.get_data_frames()[0]
            game_ext_ids = list({str(int(r)).zfill(10) for r in df["GAME_ID"].tolist() if r})
        except Exception as exc:
            print(f"  WARNING: could not parse LeagueGameFinder results: {exc}")
            return

    # Skip pre-season game IDs (001 prefix) — no box score data available
    regular_ext_ids = [g for g in (game_ext_ids or []) if not g.startswith("001")]
    skipped = len((game_ext_ids or [])) - len(regular_ext_ids)
    if skipped:
        print(f"  Skipping {skipped} pre-season game(s).")

    if not regular_ext_ids:
        print(f"  No regular-season game IDs for {date_str}. Cannot fetch box scores.")
        return

    print(f"  Fetching box scores for {len(regular_ext_ids)} game(s) on {date_str} ...")

    # Load player and team ID maps
    player_rows = supabase.table("players").select("id,ext_id").eq("league", "nba").execute()
    player_map = {r["ext_id"]: r["id"] for r in (player_rows.data or [])}

    team_rows = supabase.table("teams").select("id,ext_id").eq("league_id", NBA_LEAGUE_ID).execute()
    team_map = {r["ext_id"]: r["id"] for r in (team_rows.data or [])}

    # Query only the specific games we need — avoids PostgREST 1000-row default cap
    game_rows = (
        supabase.table("games")
        .select("id,ext_id,home_team_id,away_team_id")
        .eq("league_id", NBA_LEAGUE_ID)
        .in_("ext_id", regular_ext_ids)
        .execute()
    )
    game_map = {r["ext_id"]: r["id"] for r in (game_rows.data or [])}
    game_teams = {r["id"]: (r["home_team_id"], r["away_team_id"]) for r in (game_rows.data or [])}

    stat_buffer: list[dict] = []
    position_updates: dict[int, str] = {}  # player_db_id -> position
    score_updates: dict[int, dict] = {}

    def _si(val, default=0):
        if val is None:
            return default
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return default

    for ext_id in regular_ext_ids:
        game_db_id = game_map.get(ext_id)
        if not game_db_id:
            print(f"  WARNING: game ext_id {ext_id!r} not found in game_map. Skipping.")
            continue

        def _trad(gid=ext_id):
            return BoxScoreTraditionalV3(game_id=gid)

        result = api_call_with_retry(_trad, f"BoxScoreTraditionalV3 {ext_id}")

        # V3 fails for playoff games — try V2
        if result is None:
            def _trad_v2(gid=ext_id):
                return BoxScoreTraditionalV2(game_id=gid)
            result = api_call_with_retry(_trad_v2, f"BoxScoreTraditionalV2 {ext_id}")

        # Parse whichever stats API responded (V3 or V2)
        player_rows_from_api: list[dict] = []
        if result is not None:
            try:
                player_df = result.get_data_frames()[0]
                for _, row in player_df.iterrows():
                    # V3 uses camelCase int IDs; V2 uses UPPER_CASE string IDs
                    if "personId" in player_df.columns:
                        p_ext = str(int(row["personId"]))
                        t_ext = str(int(row["teamId"]))
                        player_rows_from_api.append({
                            "p_ext": p_ext, "t_ext": t_ext,
                            "pts": _si(row.get("points")),
                            "reb": _si(row.get("reboundsTotal")),
                            "ast": _si(row.get("assists")),
                            "fg3m": _si(row.get("threePointersMade")),
                            "fouls": _si(row.get("foulsPersonal")),
                            "mins": _parse_minutes(row.get("minutes")),
                            "pos": str(row.get("position") or "").strip(),
                        })
                    else:
                        p_ext = str(row.get("PLAYER_ID", "") or "").strip()
                        t_ext = str(row.get("TEAM_ID", "") or "").strip()
                        player_rows_from_api.append({
                            "p_ext": p_ext, "t_ext": t_ext,
                            "pts": _si(row.get("PTS")),
                            "reb": _si(row.get("REB")),
                            "ast": _si(row.get("AST")),
                            "fg3m": _si(row.get("FG3M")),
                            "fouls": _si(row.get("PF")),
                            "mins": _parse_minutes(row.get("MIN")),
                            "pos": str(row.get("START_POSITION") or "").strip(),
                        })
            except Exception as exc:
                print(f"  WARNING: stats API parse error for {ext_id}: {exc}")

        # stats.nba.com returned nothing — fall back to NBA live data API
        if not player_rows_from_api:
            try:
                from nba_api.live.nba.endpoints.boxscore import BoxScore as LiveBoxScore
                live = LiveBoxScore(game_id=ext_id)
                game_data = live.game.get_dict()
                for team_key in ("homeTeam", "awayTeam"):
                    team_data = game_data.get(team_key, {})
                    t_ext = str(team_data.get("teamId", "") or "").strip()
                    team_score = team_data.get("score")
                    if team_score is not None and game_db_id in game_teams:
                        score_updates.setdefault(game_db_id, {})
                        score_key = "home_score" if team_key == "homeTeam" else "away_score"
                        score_updates[game_db_id][score_key] = int(team_score)
                    for player in team_data.get("players", []):
                        p_ext = str(player.get("personId", "") or "").strip()
                        stats = player.get("statistics", {})
                        mins_raw = str(stats.get("minutesCalculated", "") or "")
                        mins_m = re.match(r"PT(\d+)M", mins_raw)
                        player_rows_from_api.append({
                            "p_ext": p_ext, "t_ext": t_ext,
                            "pts": _si(stats.get("points")),
                            "reb": _si(stats.get("reboundsTotal")),
                            "ast": _si(stats.get("assists")),
                            "fg3m": _si(stats.get("threePointersMade")),
                            "fouls": _si(stats.get("foulsPersonal")),
                            "mins": int(mins_m.group(1)) if mins_m else 0,
                            "pos": str(player.get("position", "") or "").strip(),
                        })
                print(f"    {ext_id}: {len(player_rows_from_api)} player rows (live API)")
            except ImportError:
                print(f"  WARNING: nba_api.live not available for {ext_id}")
            except Exception as exc:
                print(f"  WARNING: live API error for {ext_id}: {exc}")
        else:
            print(f"    {ext_id}: {len(player_rows_from_api)} player rows (stats API)")

        if not player_rows_from_api:
            print(f"  WARNING: no box score data found for {ext_id} from any source.")
            continue

        # Accumulate team scores from stats API rows (live API sets them above)
        if result is not None:
            try:
                team_pts: dict[str, int] = {}
                for r in player_rows_from_api:
                    team_pts[r["t_ext"]] = team_pts.get(r["t_ext"], 0) + r["pts"]
                if team_pts and game_db_id in game_teams:
                    home_db_t, away_db_t = game_teams[game_db_id]
                    pts_by_db = {team_map.get(ext): pts for ext, pts in team_pts.items()}
                    hs = pts_by_db.get(home_db_t)
                    aws = pts_by_db.get(away_db_t)
                    if hs is not None and aws is not None:
                        score_updates[game_db_id] = {"home_score": hs, "away_score": aws}
            except Exception:
                pass

        for r in player_rows_from_api:
            p_db_id = player_map.get(r["p_ext"])
            t_db_id = team_map.get(r["t_ext"])
            if not p_db_id or not t_db_id:
                continue
            stat_buffer.append({
                "game_id": game_db_id,
                "player_id": p_db_id,
                "team_id": t_db_id,
                "game_date": date_str,
                "points": r["pts"],
                "rebounds": r["reb"],
                "assists": r["ast"],
                "three_points_made": r["fg3m"],
                "fouls": r["fouls"],
                "minutes_played": r["mins"],
            })
            if r["pos"] and p_db_id:
                position_updates[p_db_id] = r["pos"]

    if stat_buffer:
        for i in range(0, len(stat_buffer), BATCH_SIZE):
            chunk = stat_buffer[i: i + BATCH_SIZE]
            supabase.table("nba_player_stats").upsert(chunk, on_conflict="game_id,player_id").execute()
        print(f"  Inserted {len(stat_buffer)} nba_player_stats rows for {date_str}.")
    else:
        print("  No box score rows to insert.")

    if score_updates:
        for gid, scores in score_updates.items():
            supabase.table("games").update(scores).eq("id", gid).execute()
        print(f"  Updated scores for {len(score_updates)} game(s).")

    # Flush position updates in batches
    if position_updates:
        pos_items = list(position_updates.items())
        for i in range(0, len(pos_items), BATCH_SIZE):
            chunk = pos_items[i: i + BATCH_SIZE]
            for p_db_id, pos in chunk:
                supabase.table("players").update({"position": pos}).eq("id", p_db_id).execute()
        print(f"  Updated positions for {len(pos_items)} player(s).")


# ── Step 0.5: Backfill Completed Games ───────────────────────────────────────

def backfill_completed_games(up_to: date) -> None:
    """
    Find the latest game_date in the local games table, then for each date
    between that date+1 and up_to (exclusive), fetch completed games via
    LeagueGameFinder and their box scores via _fetch_and_insert_box_scores.

    Runs before get_slate so rolling averages in daily_conditions are current.
    """
    try:
        from nba_api.stats.endpoints import LeagueGameFinder
    except ImportError as exc:
        print(f"[Step 0.5] nba_api not installed: {exc}. Skipping backfill.")
        return

    # Drive the start date from nba_player_stats, not games.
    # Games may already be in the games table but have no box scores yet.
    latest_res = (
        supabase.table("nba_player_stats")
        .select("game_date")
        .lt("game_date", _date_str(up_to))
        .order("game_date", desc=True)
        .limit(1)
        .execute()
    )
    latest_rows = latest_res.data or []
    if not latest_rows:
        print("[Step 0.5] No prior stats in DB. Skipping backfill.")
        return

    latest_str = latest_rows[0]["game_date"]
    latest_date = datetime.strptime(latest_str, "%Y-%m-%d").date()
    start_date = latest_date + timedelta(days=1)

    if start_date >= up_to:
        print(f"[Step 0.5] Stats current through {latest_str}. No backfill needed.")
        return

    print(f"[Step 0.5] Backfilling completed games {_date_str(start_date)} to {_date_str(up_to - timedelta(days=1))} ...")

    # Load lookup maps once
    team_rows = (
        supabase.table("teams").select("id,ext_id").eq("league_id", NBA_LEAGUE_ID).execute()
    )
    team_map = {r["ext_id"]: r["id"] for r in (team_rows.data or [])}

    current = start_date
    total_games = 0

    while current < up_to:
        date_str = _date_str(current)

        # Check whether games are already in the games table
        games_exist = (
            supabase.table("games")
            .select("id")
            .eq("game_date", date_str)
            .eq("league_id", NBA_LEAGUE_ID)
            .limit(1)
            .execute()
        )

        if not games_exist.data:
            # Need to fetch and insert game rows via LeagueGameFinder
            def _lgf(ds=date_str):
                return LeagueGameFinder(
                    date_from_nullable=ds,
                    date_to_nullable=ds,
                    league_id_nullable="00",
                )

            lgf_result = api_call_with_retry(_lgf, f"LeagueGameFinder {date_str}")
            if lgf_result is None:
                print(f"  WARNING: no LeagueGameFinder data for {date_str}. Skipping.")
                current += timedelta(days=1)
                continue

            try:
                df = lgf_result.get_data_frames()[0]
            except Exception as exc:
                print(f"  WARNING: parse error for {date_str}: {exc}")
                current += timedelta(days=1)
                continue

            if df.empty:
                current += timedelta(days=1)
                continue

            from collections import defaultdict
            game_groups: dict[str, list] = defaultdict(list)
            for _, row in df.iterrows():
                gid_raw = row.get("GAME_ID")
                if gid_raw:
                    gid = str(int(gid_raw)).zfill(10)
                    game_groups[gid].append(row)

            games_to_insert: list[dict] = []
            for ext_id, rows in game_groups.items():
                home_row = next((r for r in rows if " vs. " in str(r.get("MATCHUP", ""))), None)
                away_row = next((r for r in rows if " @ " in str(r.get("MATCHUP", ""))), None)
                if home_row is None or away_row is None:
                    continue
                home_db = team_map.get(str(home_row.get("TEAM_ID", "")).strip())
                away_db = team_map.get(str(away_row.get("TEAM_ID", "")).strip())
                if not home_db or not away_db:
                    continue
                games_to_insert.append({
                    "ext_id": ext_id,
                    "league_id": NBA_LEAGUE_ID,
                    "game_date": date_str,
                    "home_team_id": home_db,
                    "away_team_id": away_db,
                    "season": int(date_str[:4]) if int(date_str[5:7]) >= 10 else int(date_str[:4]) - 1,
                })

            if games_to_insert:
                supabase.table("games").upsert(games_to_insert, on_conflict="league_id,ext_id").execute()
                print(f"  {date_str}: inserted {len(games_to_insert)} game(s).")
                total_games += len(games_to_insert)

        # Per-game self-heal: only skip games that already have box scores
        date_game_rows = (
            supabase.table("games")
            .select("id,ext_id")
            .eq("game_date", date_str)
            .eq("league_id", NBA_LEAGUE_ID)
            .execute()
        )
        date_ext_ids = [r["ext_id"] for r in (date_game_rows.data or [])]
        date_game_id_map = {r["ext_id"]: r["id"] for r in (date_game_rows.data or [])}

        if not date_ext_ids:
            current += timedelta(days=1)
            continue

        stats_game_ids: set[int] = set()
        if date_game_id_map:
            stats_res = (
                supabase.table("nba_player_stats")
                .select("game_id")
                .in_("game_id", list(date_game_id_map.values()))
                .limit(500)
                .execute()
            )
            stats_game_ids = {r["game_id"] for r in (stats_res.data or [])}

        missing_ext_ids = [eid for eid in date_ext_ids if date_game_id_map.get(eid) not in stats_game_ids]
        if not missing_ext_ids:
            print(f"  {date_str}: all {len(date_ext_ids)} game(s) have box scores. Skipping.")
        else:
            print(f"  {date_str}: fetching box scores for {len(missing_ext_ids)}/{len(date_ext_ids)} game(s).")
            _fetch_and_insert_box_scores(current, game_ext_ids=missing_ext_ids)

        current += timedelta(days=1)
        time.sleep(API_DELAY_SECONDS)

    print(f"[Step 0.5] Backfill complete. {total_games} new game(s) inserted.")


# ── Step 1: Get Slate ────────────────────────────────────────────────────────

def get_slate(target_date: date) -> list[dict]:
    """
    Return list of game dicts (id, home_team_id, away_team_id, game_date)
    for target_date. Checks local DB first; falls back to LeagueGameFinder
    from nba_api if none found.
    """
    date_str = _date_str(target_date)
    print(f"[Step 1] Fetching slate for {date_str} ...")

    db_result = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id,game_date")
        .eq("game_date", date_str)
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    games = db_result.data or []

    if games:
        print(f"  Found {len(games)} game(s) in local DB.")
        return games

    print("  No games in local DB. Trying NBA API ...")

    try:
        from nba_api.stats.endpoints import LeagueGameFinder
        from nba_api.stats.endpoints.scoreboardv2 import ScoreboardV2
    except ImportError as exc:
        print(f"  ERROR: nba_api not installed: {exc}")
        return []

    # Load team ext_id -> db_id map (needed by both paths)
    team_rows = (
        supabase.table("teams")
        .select("id,ext_id")
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    team_map = {r["ext_id"]: r["id"] for r in (team_rows.data or [])}

    # ── Path A: ScoreBoard (works for scheduled/future games) ────────────────
    games_to_insert: list[dict] = []

    def _sb():
        return ScoreboardV2(game_date=date_str)

    sb_result = api_call_with_retry(_sb, f"ScoreBoard {date_str}")
    if sb_result is not None:
        try:
            header_df = sb_result.game_header.get_data_frame()
            season_yr = int(date_str[:4]) if int(date_str[5:7]) >= 10 else int(date_str[:4]) - 1
            seen_sb: set[str] = set()
            for _, row in header_df.iterrows():
                gid_raw = row.get("GAME_ID")
                if not gid_raw:
                    continue
                ext_id = str(int(gid_raw)).zfill(10)
                if ext_id in seen_sb:
                    continue
                seen_sb.add(ext_id)
                home_t_ext = str(row.get("HOME_TEAM_ID", "")).strip()
                away_t_ext = str(row.get("VISITOR_TEAM_ID", "")).strip()
                home_db_id = team_map.get(home_t_ext)
                away_db_id = team_map.get(away_t_ext)
                if not home_db_id or not away_db_id:
                    continue
                games_to_insert.append({
                    "ext_id": ext_id,
                    "league_id": NBA_LEAGUE_ID,
                    "game_date": date_str,
                    "home_team_id": home_db_id,
                    "away_team_id": away_db_id,
                    "season": season_yr,
                })
            if games_to_insert:
                print(f"  ScoreBoard found {len(games_to_insert)} game(s).")
        except Exception as exc:
            print(f"  ScoreBoard parse warning: {exc}")
            games_to_insert = []

    # ── Path B: LeagueGameFinder fallback (completed games only) ─────────────
    if not games_to_insert:
        def _lgf():
            return LeagueGameFinder(
                date_from_nullable=date_str,
                date_to_nullable=date_str,
                league_id_nullable="00",
            )

        lgf_result = api_call_with_retry(_lgf, f"LeagueGameFinder {date_str}")
        if lgf_result is None:
            print("  WARNING: NBA API returned nothing for this date.")
        else:
            try:
                df = lgf_result.get_data_frames()[0]
                from collections import defaultdict
                game_groups: dict[str, list] = defaultdict(list)
                for _, row in df.iterrows():
                    gid_raw = row.get("GAME_ID")
                    if gid_raw:
                        gid = str(int(gid_raw)).zfill(10)
                        game_groups[gid].append(row)

                season_yr = int(date_str[:4]) if int(date_str[5:7]) >= 10 else int(date_str[:4]) - 1
                seen_lgf: set[str] = set()
                for ext_id, rows in game_groups.items():
                    if ext_id in seen_lgf:
                        continue
                    seen_lgf.add(ext_id)
                    home_row, away_row = None, None
                    for row in rows:
                        matchup = str(row.get("MATCHUP", ""))
                        if " vs. " in matchup:
                            home_row = row
                        elif " @ " in matchup:
                            away_row = row
                    if home_row is None or away_row is None:
                        continue
                    home_t_ext = str(home_row.get("TEAM_ID", "")).strip()
                    away_t_ext = str(away_row.get("TEAM_ID", "")).strip()
                    home_db_id = team_map.get(home_t_ext)
                    away_db_id = team_map.get(away_t_ext)
                    if not home_db_id or not away_db_id:
                        continue
                    games_to_insert.append({
                        "ext_id": ext_id,
                        "league_id": NBA_LEAGUE_ID,
                        "game_date": date_str,
                        "home_team_id": home_db_id,
                        "away_team_id": away_db_id,
                        "season": season_yr,
                    })
            except Exception as exc:
                print(f"  WARNING: could not parse LeagueGameFinder: {exc}")

    if not games_to_insert:
        print(f"  Slate: 0 game(s) for {date_str}.")
        return []

    supabase.table("games").upsert(games_to_insert, on_conflict="league_id,ext_id").execute()
    print(f"  Inserted/confirmed {len(games_to_insert)} game(s).")

    # Re-query to get DB-assigned ids
    db_result2 = (
        supabase.table("games")
        .select("id,home_team_id,away_team_id,game_date")
        .eq("game_date", date_str)
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    games = db_result2.data or []
    print(f"  Slate: {len(games)} game(s) for {date_str}.")
    return games


# ── Steps 2+3: Compute Daily Conditions ──────────────────────────────────────

def compute_daily_conditions(games: list[dict], target_date: date) -> None:
    """
    For every player on a team playing target_date, compute rolling averages,
    usage, rest, home/away, and opponent defense rank, then upsert to
    daily_conditions.
    """
    if not games:
        print("[Steps 2+3] No games to process. Skipping daily_conditions.")
        return

    date_str = _date_str(target_date)
    print(f"[Steps 2+3] Computing daily_conditions for {date_str} ...")

    # Collect all team DB ids playing today
    team_ids_playing: set[int] = set()
    game_id_map: dict[int, int] = {}  # team_db_id -> game_db_id
    home_team_ids: set[int] = set()

    for g in games:
        h = g["home_team_id"]
        a = g["away_team_id"]
        gid = g["id"]
        team_ids_playing.add(h)
        team_ids_playing.add(a)
        game_id_map[h] = gid
        game_id_map[a] = gid
        home_team_ids.add(h)

    if not team_ids_playing:
        print("  No teams found. Skipping.")
        return

    # Load team abbreviations for matching
    team_rows = (
        supabase.table("teams")
        .select("id,abbreviation")
        .eq("league_id", NBA_LEAGUE_ID)
        .execute()
    )
    team_abbr_map: dict[int, str] = {r["id"]: r["abbreviation"] for r in (team_rows.data or [])}
    abbr_to_id: dict[str, int] = {v: k for k, v in team_abbr_map.items()}

    playing_abbrs = {team_abbr_map[tid] for tid in team_ids_playing if tid in team_abbr_map}

    # Load active players on those teams
    player_rows = (
        supabase.table("players")
        .select("id,name,position,team")
        .eq("league", "nba")
        .eq("is_active", True)
        .execute()
    )
    players = [
        p for p in (player_rows.data or [])
        if p.get("team") in playing_abbrs
    ]

    print(f"  Players found on today's teams: {len(players)}")

    if not players:
        print("  No players to process. Skipping.")
        return

    # ── Picks v2: precompute season averages + team usage rankings ────────
    # Single batch query gives us season_avg_usg for top-3 ranking. We also
    # pull season_avg_minutes from nba_player_stats so positional-sub logic
    # can pick the next-highest-minutes player at the out starter's position.
    candidate_player_ids = [p["id"] for p in players]
    candidate_team_ids = list({abbr_to_id[p["team"]] for p in players if p.get("team") in abbr_to_id})

    # Pull all NBA active players on today's teams in a single batched select.
    # Used to identify top-usage teammates regardless of whether they're in `players`.
    team_roster_rows = (
        supabase.table("players")
        .select("id,name,position,team")
        .eq("league", "nba")
        .eq("is_active", True)
        .in_("team", list(playing_abbrs))
        .execute()
    )
    team_roster = team_roster_rows.data or []
    all_roster_ids = list({r["id"] for r in team_roster})

    # season_avg_usg per player (batched). The existing per-player season query
    # below remains for backward-compat fields but we use this map for ranking.
    season_usg_map: dict[int, float] = {}
    if all_roster_ids:
        # Chunk to keep PostgREST query string size manageable
        chunk = 200
        for i in range(0, len(all_roster_ids), chunk):
            ids_chunk = all_roster_ids[i:i + chunk]
            res = (
                supabase.table("player_game_conditions")
                .select("player_id,usg_pct")
                .in_("player_id", ids_chunk)
                .not_.is_("usg_pct", "null")
                .execute()
            )
            buckets: dict[int, list[float]] = {}
            for r in (res.data or []):
                buckets.setdefault(r["player_id"], []).append(r["usg_pct"])
            for pid, vals in buckets.items():
                avg = _safe_avg(vals)
                if avg is not None:
                    season_usg_map[pid] = avg

    # season_avg_minutes per player (current season only — derive from stats)
    season_min_map: dict[int, float] = {}
    if all_roster_ids:
        season_start_str = _season_start_iso(date_str)
        chunk = 200
        for i in range(0, len(all_roster_ids), chunk):
            ids_chunk = all_roster_ids[i:i + chunk]
            res = (
                supabase.table("nba_player_stats")
                .select("player_id,minutes_played")
                .in_("player_id", ids_chunk)
                .gte("game_date", season_start_str)
                .gt("minutes_played", 0)
                .execute()
            )
            buckets: dict[int, list[float]] = {}
            for r in (res.data or []):
                buckets.setdefault(r["player_id"], []).append(r["minutes_played"])
            for pid, vals in buckets.items():
                avg = _safe_avg(vals)
                if avg is not None:
                    season_min_map[pid] = avg

    # Build top-N-usage roster per team
    top_usage_per_team: dict[int, list[int]] = {}
    by_team: dict[int, list[tuple[int, float]]] = {}
    for r in team_roster:
        team_db_id = abbr_to_id.get(r.get("team") or "")
        if not team_db_id:
            continue
        usg = season_usg_map.get(r["id"])
        if usg is None:
            continue
        by_team.setdefault(team_db_id, []).append((r["id"], usg))
    for tid, plist in by_team.items():
        plist.sort(key=lambda x: x[1], reverse=True)
        top_usage_per_team[tid] = [pid for pid, _ in plist[:TOP_USAGE_TEAMMATE_COUNT]]

    # Player → position_group lookup (for positional-sub logic)
    player_pos_group: dict[int, Optional[str]] = {}
    player_team_id: dict[int, int] = {}
    for r in team_roster:
        team_db_id = abbr_to_id.get(r.get("team") or "")
        if team_db_id:
            player_team_id[r["id"]] = team_db_id
        pg = POSITION_GROUP_MAP.get(r.get("position") or "")
        player_pos_group[r["id"]] = pg

    # Out-today availability — by game_id and by team
    out_today_by_game: dict[int, set[int]] = {}
    today_game_ids = list({g["id"] for g in games})
    if today_game_ids:
        avail_res = (
            supabase.table("player_availability")
            .select("game_id,player_id,status")
            .in_("game_id", today_game_ids)
            .eq("status", "out")
            .execute()
        )
        for r in (avail_res.data or []):
            out_today_by_game.setdefault(r["game_id"], set()).add(r["player_id"])

    # Recent opp-form cache: many candidates share the same opponent today
    opp_form_cache: dict[int, dict] = {}
    def _opp_form(opp_team_id: int) -> dict:
        if opp_team_id not in opp_form_cache:
            opp_form_cache[opp_team_id] = _compute_recent_opp_form(opp_team_id, date_str)
        return opp_form_cache[opp_team_id]

    # Load latest opponent_position_defense snapshot (all 4 stat-specific ranks)
    opd_rows = (
        supabase.table("opponent_position_defense")
        .select("team_id,position_group,league_rank,reb_rank,ast_rank,fg3m_rank,snapshot_date")
        .order("snapshot_date", desc=True)
        .execute()
    )
    # Keep only the latest snapshot per (team_id, position_group)
    opd_map: dict[tuple[int, str], dict] = {}
    seen_opd: set[tuple[int, str]] = set()
    for row in (opd_rows.data or []):
        key = (row["team_id"], row["position_group"])
        if key not in seen_opd:
            opd_map[key] = {
                "pts_rank":  row.get("league_rank"),
                "reb_rank":  row.get("reb_rank"),
                "ast_rank":  row.get("ast_rank"),
                "fg3m_rank": row.get("fg3m_rank"),
            }
            seen_opd.add(key)

    daily_rows: list[dict] = []

    for player in players:
        player_id: int = player["id"]
        position_raw: str = player.get("position") or ""
        team_abbr: str = player.get("team") or ""

        team_db_id = abbr_to_id.get(team_abbr)
        if not team_db_id:
            continue

        game_db_id = game_id_map.get(team_db_id)
        if not game_db_id:
            continue

        # Determine opponent team id
        for g in games:
            if g["home_team_id"] == team_db_id:
                opp_team_id = g["away_team_id"]
                home_away = "home"
                break
            elif g["away_team_id"] == team_db_id:
                opp_team_id = g["home_team_id"]
                home_away = "away"
                break
        else:
            continue

        # Position group
        pos_group: Optional[str] = POSITION_GROUP_MAP.get(position_raw)

        # ── Rolling stats: last 5 nba_player_stats ─────────────────────
        stats_res = (
            supabase.table("nba_player_stats")
            .select("game_date,points,rebounds,assists,three_points_made,minutes_played")
            .eq("player_id", player_id)
            .lt("game_date", date_str)
            .order("game_date", desc=True)
            .limit(5)
            .execute()
        )
        recent_stats = stats_res.data or []

        rolling_pts = _safe_avg([r.get("points") for r in recent_stats])
        rolling_reb = _safe_avg([r.get("rebounds") for r in recent_stats])
        rolling_ast = _safe_avg([r.get("assists") for r in recent_stats])
        rolling_fg3m = _safe_avg([r.get("three_points_made") for r in recent_stats])
        rolling_min = _safe_avg([r.get("minutes_played") for r in recent_stats])

        # Days rest from last game
        days_rest: Optional[int] = None
        if recent_stats:
            last_date_str = recent_stats[0].get("game_date")
            if last_date_str:
                try:
                    last_date = datetime.strptime(last_date_str, "%Y-%m-%d").date()
                    days_rest = (target_date - last_date).days
                except ValueError:
                    pass

        # ── Rolling conditions: last 5 player_game_conditions ──────────
        # Picks v2: also pull touches. TOP/front_court/paint_touches are
        # always-NULL (V3 doesn't expose them) — see fetch_player_track docstring.
        cond_res = (
            supabase.table("player_game_conditions")
            .select("game_date,usg_pct,pace,touches")
            .eq("player_id", player_id)
            .lt("game_date", date_str)
            .gt("pace", 0)  # exclude DNP rows where pace wasn't computed
            .order("game_date", desc=True)
            .limit(5)
            .execute()
        )
        recent_cond = cond_res.data or []
        rolling_usg = _safe_avg([r.get("usg_pct") for r in recent_cond])
        rolling_pace = _safe_avg([r.get("pace") for r in recent_cond])
        rolling_touches = _safe_avg([r.get("touches") for r in recent_cond])

        # ── Season averages (usg legacy + touches v2) ─────────────────
        season_cond_res = (
            supabase.table("player_game_conditions")
            .select("usg_pct,touches")
            .eq("player_id", player_id)
            .execute()
        )
        season_cond_rows = season_cond_res.data or []
        season_avg_usg = _safe_avg([r.get("usg_pct") for r in season_cond_rows])
        season_avg_touches = _safe_avg([r.get("touches") for r in season_cond_rows])

        # ── Opponent defense ranks (stat-specific) ───────────────────────
        opd_data: dict = {}
        if pos_group:
            opd_data = opd_map.get((opp_team_id, pos_group)) or {}

        # ── Picks v2: key_teammates_out + positional_sub_for ───────────
        out_in_game = out_today_by_game.get(game_db_id, set())
        out_teammate_ids = {
            pid for pid in out_in_game
            if pid != player_id and player_team_id.get(pid) == team_db_id
        }

        # Scenario (b): top-3-usage teammates who are out
        team_top3 = top_usage_per_team.get(team_db_id, [])
        top_usage_out = [pid for pid in team_top3 if pid in out_teammate_ids]

        # Scenario (a): is this candidate a positional sub for any out starter?
        # Out-starter candidate = same position group on this team, sorted by season minutes desc.
        positional_sub_for: Optional[int] = None
        if out_teammate_ids and pos_group:
            same_pos_out = [
                pid for pid in out_teammate_ids
                if player_pos_group.get(pid) == pos_group
            ]
            if same_pos_out:
                # Pick the highest-minutes out starter as the slot the candidate is filling.
                # If multiple candidates exist on the team, only treat the next-highest-minutes
                # one as the sub (keeps key_teammates_out from firing for every reserve).
                same_pos_out.sort(key=lambda pid: season_min_map.get(pid, 0.0), reverse=True)
                top_out = same_pos_out[0]
                # Find non-out same-pos teammates on this team, ranked by minutes
                same_pos_available = [
                    pid for pid in player_team_id
                    if player_team_id[pid] == team_db_id
                    and player_pos_group.get(pid) == pos_group
                    and pid not in out_teammate_ids
                ]
                same_pos_available.sort(key=lambda pid: season_min_map.get(pid, 0.0), reverse=True)
                if same_pos_available and same_pos_available[0] == player_id:
                    positional_sub_for = top_out

        key_teammates_out = sorted(
            set(top_usage_out) | ({positional_sub_for} if positional_sub_for else set())
        )

        daily_rows.append({
            "player_id": player_id,
            "game_id": game_db_id,
            "game_date": date_str,
            "home_away": home_away,
            "opponent_team_id": opp_team_id,
            "days_rest": days_rest,
            "position_group": pos_group,
            "rolling_pts_5g": rolling_pts,
            "rolling_reb_5g": rolling_reb,
            "rolling_ast_5g": rolling_ast,
            "rolling_fg3m_5g": rolling_fg3m,
            "rolling_min_5g": rolling_min,
            "rolling_usg_5g": rolling_usg,
            "rolling_pace_5g": rolling_pace,
            "season_avg_usg": season_avg_usg,
            # Picks v2: touches as the sole opportunity signal
            # (TOP / paint_touches deliberately NULL — see fetch_player_track docstring).
            "rolling_touches_5g": rolling_touches,
            "season_avg_touches": season_avg_touches,
            "key_teammates_out": key_teammates_out,
            "positional_sub_for": positional_sub_for,
            "opp_def_rank_position":  opd_data.get("pts_rank"),
            "opp_reb_rank_position":  opd_data.get("reb_rank"),
            "opp_ast_rank_position":  opd_data.get("ast_rank"),
            "opp_fg3m_rank_position": opd_data.get("fg3m_rank"),
            # Picks v2: opponent's last-N vs season form delta per stat
            "recent_opp_pts_form":  _opp_form(opp_team_id)["pts"],
            "recent_opp_reb_form":  _opp_form(opp_team_id)["reb"],
            "recent_opp_ast_form":  _opp_form(opp_team_id)["ast"],
            "recent_opp_fg3m_form": _opp_form(opp_team_id)["fg3m"],
        })

    if daily_rows:
        for i in range(0, len(daily_rows), BATCH_SIZE):
            chunk = daily_rows[i: i + BATCH_SIZE]
            supabase.table("daily_conditions").upsert(
                chunk, on_conflict="player_id,game_date"
            ).execute()
        print(f"  Upserted {len(daily_rows)} daily_conditions rows for {date_str}.")
    else:
        print("  No daily_conditions rows to write.")


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run_nightly(
    target_date: date,
    test: bool = False,
    slate_only: bool = False,
    reconcile_only: bool = False,
) -> None:
    """
    Full nightly pipeline:
      Step 0   - reconcile picks from yesterday           (skipped with --slate-only)
      Step 0.5 - backfill completed games + box scores    (skipped with --slate-only / --reconcile-only skips 1+2+3)
      Step 1   - fetch game slate for target_date         (skipped with --reconcile-only)
      Steps 2+3 - compute daily_conditions                (skipped with --reconcile-only)

    --slate-only:     Run only steps 1 and 2+3 (future-date slate syncs).
    --reconcile-only: Run only step 0 (noon reconcile job).
    """
    yesterday = target_date - timedelta(days=1)

    mode = " [SLATE-ONLY]" if slate_only else " [RECONCILE-ONLY]" if reconcile_only else ""
    print("=" * 60)
    print(f"StatTrak Nightly Batch  |  target: {_date_str(target_date)}{mode}")
    if test:
        print("(TEST MODE - limited scope)")
    print("=" * 60)

    # Step 0: reconcile picks — only when not doing a forward slate sync
    if not slate_only:
        try:
            reconcile_picks(yesterday)
        except (Exception, KeyboardInterrupt) as exc:
            print(f"  ERROR in reconcile_picks: {exc}")

    if reconcile_only:
        print("=" * 60)
        print("Reconcile-only run complete.")
        return

    # Step 0.5 — backfill any completed games (full run only; slate syncs skip this)
    if not slate_only:
        try:
            backfill_completed_games(up_to=target_date)
        except (Exception, KeyboardInterrupt) as exc:
            print(f"  ERROR in backfill_completed_games: {exc}")

    # Step 1
    try:
        games = get_slate(target_date)
    except (Exception, KeyboardInterrupt) as exc:
        print(f"  ERROR in get_slate: {exc}")
        games = []

    if test:
        games = games[:2]
        print(f"  Test mode: limiting to {len(games)} game(s).")

    # Steps 2+3
    try:
        compute_daily_conditions(games, target_date)
    except Exception as exc:
        print(f"  ERROR in compute_daily_conditions: {exc}")

    print("=" * 60)
    print("Nightly batch complete.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="StatTrak nightly batch processor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m analytics.batch.nightly --date 2026-03-22
  python -m analytics.batch.nightly --test
  python -m analytics.batch.nightly          (default: tomorrow)
        """,
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Target date in YYYY-MM-DD format (default: tomorrow)",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run in test mode (limited games, no destructive ops)",
    )
    parser.add_argument(
        "--slate-only",
        action="store_true",
        dest="slate_only",
        help="Skip reconcile + backfill; only sync slate + daily_conditions (use for future-date loops)",
    )
    parser.add_argument(
        "--reconcile-only",
        action="store_true",
        dest="reconcile_only",
        help="Only run Step 0 (reconcile yesterday's picks); skip slate + backfill + conditions",
    )

    args = parser.parse_args()

    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(f"ERROR: invalid date format '{args.date}'. Use YYYY-MM-DD.")
            return 1
    else:
        target_date = date.today() + timedelta(days=1)

    run_nightly(
        target_date,
        test=args.test,
        slate_only=args.slate_only,
        reconcile_only=args.reconcile_only,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
