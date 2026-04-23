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
import sys
import time
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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _date_str(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def _safe_avg(values: list) -> Optional[float]:
    """Return mean of non-None values, or None if empty."""
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return sum(clean) / len(clean)


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
        _fetch_and_insert_box_scores(yesterday)

    # ── Resolve player props ─────────────────────────────────────────────────
    PROP_STAT_MAP = {
        "points": "points",
        "rebounds": "rebounds",
        "assists": "assists",
        "three_points_made": "three_points_made",
        "fg3m": "three_points_made",
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
    Fetch box scores for target_date via BoxScoreTraditionalV2 and insert rows
    into nba_player_stats.

    If game_ext_ids is provided (list of zero-padded strings from the DB), use
    them directly. Otherwise fall back to LeagueGameFinder.
    """
    try:
        from nba_api.stats.endpoints import BoxScoreTraditionalV2, LeagueGameFinder
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

    if not game_ext_ids:
        print(f"  No game IDs for {date_str}. Cannot fetch box scores.")
        return

    print(f"  Fetching box scores for {len(game_ext_ids)} game(s) on {date_str} ...")

    # Load player and team ID maps
    player_rows = supabase.table("players").select("id,ext_id").eq("league", "nba").execute()
    player_map = {r["ext_id"]: r["id"] for r in (player_rows.data or [])}

    team_rows = supabase.table("teams").select("id,ext_id").eq("league_id", NBA_LEAGUE_ID).execute()
    team_map = {r["ext_id"]: r["id"] for r in (team_rows.data or [])}

    # Query only the specific games we need — avoids PostgREST 1000-row default cap
    game_rows = (
        supabase.table("games")
        .select("id,ext_id")
        .eq("league_id", NBA_LEAGUE_ID)
        .in_("ext_id", game_ext_ids)
        .execute()
    )
    game_map = {r["ext_id"]: r["id"] for r in (game_rows.data or [])}

    stat_buffer: list[dict] = []

    for ext_id in game_ext_ids:
        game_db_id = game_map.get(ext_id)
        if not game_db_id:
            print(f"  WARNING: game ext_id {ext_id!r} not found in game_map. Skipping.")
            continue

        def _trad(gid=ext_id):
            return BoxScoreTraditionalV2(game_id=gid)

        result = api_call_with_retry(_trad, f"BoxScoreTraditionalV2 {ext_id}")
        if result is None:
            print(f"  WARNING: BoxScoreTraditionalV2 returned None for {ext_id}.")
            continue

        try:
            frames = result.get_data_frames()
            player_df = frames[0]
        except Exception as exc:
            print(f"  WARNING: parse error for game {ext_id}: {exc}")
            continue

        print(f"    {ext_id}: {len(player_df)} player rows")

        for _, row in player_df.iterrows():
            try:
                p_ext_id = str(int(float(row["PLAYER_ID"])))
                t_ext_id = str(int(float(row["TEAM_ID"])))
            except (ValueError, TypeError, KeyError):
                continue
            p_db_id = player_map.get(p_ext_id)
            t_db_id = team_map.get(t_ext_id)
            if not p_db_id or not t_db_id:
                continue

            def _si(val, default=0):
                if val is None:
                    return default
                try:
                    return int(float(val))
                except (ValueError, TypeError):
                    return default

            minutes = _parse_minutes(row.get("MIN"))

            stat_buffer.append({
                "game_id": game_db_id,
                "player_id": p_db_id,
                "team_id": t_db_id,
                "game_date": date_str,
                "points": _si(row.get("PTS")),
                "rebounds": _si(row.get("REB")),
                "assists": _si(row.get("AST")),
                "three_points_made": _si(row.get("FG3M")),
                "fouls": _si(row.get("PF")),
                "minutes_played": minutes,
            })

    if stat_buffer:
        for i in range(0, len(stat_buffer), BATCH_SIZE):
            chunk = stat_buffer[i: i + BATCH_SIZE]
            supabase.table("nba_player_stats").upsert(chunk, on_conflict="game_id,player_id").execute()
        print(f"  Inserted {len(stat_buffer)} nba_player_stats rows for {date_str}.")
    else:
        print("  No box score rows to insert.")


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

        # Check whether box scores are already in nba_player_stats for this date
        stats_exist = (
            supabase.table("nba_player_stats")
            .select("player_id")
            .eq("game_date", date_str)
            .limit(1)
            .execute()
        )
        if stats_exist.data:
            print(f"  {date_str}: box scores already present. Skipping fetch.")
        else:
            # Fetch game ext_ids for this date directly from DB (avoids format guessing)
            date_game_rows = (
                supabase.table("games")
                .select("ext_id")
                .eq("game_date", date_str)
                .eq("league_id", NBA_LEAGUE_ID)
                .execute()
            )
            date_ext_ids = [r["ext_id"] for r in (date_game_rows.data or [])]
            _fetch_and_insert_box_scores(current, game_ext_ids=date_ext_ids)

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

    # Load latest opponent_position_defense snapshot
    opd_rows = (
        supabase.table("opponent_position_defense")
        .select("team_id,position_group,league_rank,snapshot_date")
        .order("snapshot_date", desc=True)
        .execute()
    )
    # Keep only the latest snapshot per (team_id, position_group)
    opd_map: dict[tuple[int, str], int] = {}
    seen_opd: set[tuple[int, str]] = set()
    for row in (opd_rows.data or []):
        key = (row["team_id"], row["position_group"])
        if key not in seen_opd:
            opd_map[key] = row["league_rank"]
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
        cond_res = (
            supabase.table("player_game_conditions")
            .select("game_date,usg_pct,pace")
            .eq("player_id", player_id)
            .lt("game_date", date_str)
            .order("game_date", desc=True)
            .limit(5)
            .execute()
        )
        recent_cond = cond_res.data or []
        rolling_usg = _safe_avg([r.get("usg_pct") for r in recent_cond])
        rolling_pace = _safe_avg([r.get("pace") for r in recent_cond])

        # ── Season avg usg ────────────────────────────────────────────
        season_usg_res = (
            supabase.table("player_game_conditions")
            .select("usg_pct")
            .eq("player_id", player_id)
            .execute()
        )
        season_usg_vals = [r.get("usg_pct") for r in (season_usg_res.data or [])]
        season_avg_usg = _safe_avg(season_usg_vals)

        # ── Opponent defense rank ─────────────────────────────────────
        opp_def_rank: Optional[int] = None
        if pos_group:
            opp_def_rank = opd_map.get((opp_team_id, pos_group))

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
            "opp_def_rank_position": opp_def_rank,
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

def run_nightly(target_date: date, test: bool = False) -> None:
    """
    Full nightly pipeline:
      Step 0   - reconcile picks from yesterday
      Step 0.5 - backfill completed games + box scores since last DB entry
      Step 1   - fetch game slate for target_date
      Steps 2+3 - compute daily_conditions for all players on today's teams
    """
    yesterday = target_date - timedelta(days=1)

    print("=" * 60)
    print(f"StatTrak Nightly Batch  |  target: {_date_str(target_date)}")
    if test:
        print("(TEST MODE - no writes will be skipped, but limited scope)")
    print("=" * 60)

    # Step 0
    try:
        reconcile_picks(yesterday)
    except (Exception, KeyboardInterrupt) as exc:
        print(f"  ERROR in reconcile_picks: {exc}")

    # Step 0.5 — backfill any completed games since the last DB entry
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

    args = parser.parse_args()

    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(f"ERROR: invalid date format '{args.date}'. Use YYYY-MM-DD.")
            return 1
    else:
        target_date = date.today() + timedelta(days=1)

    run_nightly(target_date, test=args.test)
    return 0


if __name__ == "__main__":
    sys.exit(main())
