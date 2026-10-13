"""
analytics/data/enrich_games.py

Enrichment operations for StatTrak Analytics. NBA is ESPN-only: there is no
stats.nba.com / nba_api dependency anywhere in the platform.

  1. backfill_positions()          -- ESPN current rosters -> players.position
  2. derive_player_conditions()    -- DB-only: nba_player_stats + games ->
                                      player_game_conditions (minutes, rest,
                                      home/away, opponent). The backtest's
                                      history table; advanced columns (usg,
                                      pace, ratings, touches) are left alone.
  3. backfill_basic_stats()        -- ESPN summary box scores -> nba_player_stats
  4. backfill_opp_defense()        -- opponent_position_defense ranks (DB-only)

CLI:
    python -m analytics.data.enrich_games --positions
    python -m analytics.data.enrich_games --basic-stats
    python -m analytics.data.enrich_games --opp-defense
    python -m analytics.data.enrich_games --conditions [--since YYYY-MM-DD] [--season 2025]
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

from analytics.db.connection import (
    BATCH_SIZE,
    NBA_LEAGUE_ID,
    POSITION_GROUP_MAP,
    SEASON_INTS,
    supabase,
)

TEST_GAME_LIMIT = 5            # Number of games to process in --test mode
DAYS_REST_DEFAULT = 3          # Days rest assumed when no prior game exists (full-history mode)
CONDITIONS_LOOKBACK_DAYS = 45  # Incremental mode: how far back to look for a player's prior game


# ── Supabase pagination helper ──────────────────────────────────────────────────

# Tables without a surrogate `id` column page over their composite key.
_PK_ORDER: dict[str, list[str]] = {
    "nba_player_stats": ["game_id", "player_id"],
}

def _fetch_all(table: str, select: str = "*", filters: Optional[list] = None) -> list[dict]:
    """
    Paginate through a Supabase table, fetching up to 1000 rows per request.
    filters is a list of (method_name, *args) tuples applied to the query
    builder. Dotted method names traverse builder attributes, e.g.
    ("not_.like", "ext_id", "00%") -> q.not_.like("ext_id", "00%").

    Example:
        _fetch_all("games", "id,ext_id,season", [("eq", "league_id", 1)])
    """
    rows: list[dict] = []
    page = 0
    page_size = 1000
    # range() paging over an unordered query is not stable in Postgres: pages
    # can overlap or skip rows, silently dropping data from a derived table.
    # Always page over the table's primary key.
    order_cols = _PK_ORDER.get(table, ["id"])
    while True:
        start = page * page_size
        end = start + page_size - 1
        q = supabase.table(table).select(select)
        for col in order_cols:
            q = q.order(col)
        q = q.range(start, end)
        if filters:
            for method, *args in filters:
                target = q
                parts = method.split(".")
                for part in parts[:-1]:
                    target = getattr(target, part)
                q = getattr(target, parts[-1])(*args)
        result = q.execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return rows


# ── Shared retry helper ─────────────────────────────────────────────────────────


# ── 1. POSITION BACKFILL ────────────────────────────────────────────────────────

def backfill_positions() -> None:
    """
    Pull current ESPN rosters for all 30 NBA teams and update
    players.position, players.team, players.is_active for each roster member
    (Phase 8 hybrid — replaces CommonTeamRoster).

    Players are resolved through players.espn_id ONLY; roster athletes without
    a mapping are counted and reported loudly (run analytics/batch/map_espn_ids
    to extend the mapping — no silent name-guessing happens here). Note ESPN
    rosters are current-state (not season-pinned like CommonTeamRoster was).
    """
    from analytics.data.espn import client as espn
    from analytics.data.nba_espn.ingest import (
        LEAGUE, SPORT, load_player_espn_map, load_team_maps,
    )

    team_espn_map, team_abbr_by_espn = load_team_maps()
    player_espn_map = load_player_espn_map()

    total = len(team_espn_map)
    print(f"Backfilling positions for {total} teams (ESPN current rosters) ...")

    total_updated = 0
    total_unmapped = 0
    for idx, (espn_team_id, team_abbr) in enumerate(
            sorted(team_espn_map.items(), key=lambda kv: team_abbr_by_espn[kv[0]]),
            start=1):
        abbr = team_abbr_by_espn[espn_team_id]
        print(f"  [{idx}/{total}] {abbr} ...", end=" ", flush=True)

        roster = espn.get_roster(SPORT, LEAGUE, espn_team_id)
        if not roster:
            print("SKIPPED (empty ESPN roster)")
            continue

        updated = 0
        unmapped = 0
        for athlete in roster:
            espn_id = str(athlete.get("id", ""))
            p_db_id = player_espn_map.get(espn_id)
            if not p_db_id:
                unmapped += 1
                continue
            position = (athlete.get("position") or {}).get("abbreviation")
            try:
                supabase.table("players").update(
                    {
                        "position": position or None,
                        "team": abbr,
                        "is_active": True,
                    }
                ).eq("id", p_db_id).execute()
                updated += 1
            except Exception as exc:
                print(f"\n    WARNING: could not update player {espn_id}: {exc}")

        total_updated += updated
        total_unmapped += unmapped
        note = f", {unmapped} unmapped" if unmapped else ""
        print(f"{updated} players updated{note}")

    print(f"Position backfill complete. {total_updated} updated, "
          f"{total_unmapped} roster athlete(s) without espn_id mapping"
          + (" — run analytics/batch/map_espn_ids for the detailed report."
             if total_unmapped else "."))




def _load_id_maps() -> tuple[dict, dict, dict]:
    """
    Load three lookup dictionaries from the database.

    Returns:
        team_map   -- {ext_id: db_id}
        player_map -- {ext_id: db_id}
        game_map   -- {ext_id: {id, season, game_date, home_team_id, away_team_id}}
    """
    print("Loading ID maps from database ...")

    # Teams
    team_rows = _fetch_all("teams", "id,ext_id", [("eq", "league_id", NBA_LEAGUE_ID)])
    team_map = {r["ext_id"]: r["id"] for r in team_rows}
    print(f"  Teams loaded: {len(team_map)}")

    # Players
    player_rows = _fetch_all("players", "id,ext_id", [("eq", "league", "nba")])
    player_map = {r["ext_id"]: r["id"] for r in player_rows}
    print(f"  Players loaded: {len(player_map)}")

    # Games
    game_rows = _fetch_all(
        "games",
        "id,ext_id,season,game_date,home_team_id,away_team_id",
        [("eq", "league_id", NBA_LEAGUE_ID)],
    )
    game_map = {
        r["ext_id"]: {
            "id": r["id"],
            "season": r["season"],
            "game_date": r["game_date"],
            "home_team_id": r["home_team_id"],
            "away_team_id": r["away_team_id"],
        }
        for r in game_rows
    }
    print(f"  Games loaded: {len(game_map)}")

    return team_map, player_map, game_map




# ── 2. DERIVED PLAYER CONDITIONS (DB-only, no network) ──────────────────────────

def derive_player_conditions(
    since: Optional[str] = None,
    season_filter: Optional[int] = None,
    overwrite: bool = False,
) -> int:
    """
    Build player_game_conditions rows from data already in the DB:
      minutes_played  <- nba_player_stats.minutes_played (> 0 only; DNPs skipped)
      home_away       <- player's team vs games.home_team_id
      opponent_team_id<- the other team in the game
      days_rest       <- calendar days since the player's previous box score

    Rows that already exist (player_id, game_id) are left untouched
    (ignore_duplicates), so historical rows keep whatever advanced columns they
    carry and ESPN minute rounding never rewrites old rows. Advanced fields
    (usg_pct, pace, off/def rating, touches...) are never written here.

    Args:
        since:         ISO date; only games on/after it are derived (incremental
                       nightly mode). A player's prior game is looked up within
                       CONDITIONS_LOOKBACK_DAYS before it; if none, days_rest is
                       set above the backtest's MAX_DAYS_REST so the row is
                       treated as a season opener (same as the old cross-season rows).
        season_filter: restrict to one season int.
        overwrite:     also rewrite rows that already exist (only the basic columns
                       minutes/home_away/days_rest/opponent are set; advanced
                       columns are untouched). Use to repair legacy days_rest values.
    Returns: number of candidate rows submitted.
    """
    game_filters: list = [("eq", "league_id", NBA_LEAGUE_ID)]
    if since:
        game_filters.append(("gte", "game_date", since))
    if season_filter is not None:
        game_filters.append(("eq", "season", season_filter))
    games = {
        g["id"]: g for g in _fetch_all(
            "games", "id,game_date,home_team_id,away_team_id", game_filters)
    }
    if not games:
        print("[derive_player_conditions] no games in range.")
        return 0

    stat_filters: list = []
    if since:
        lookback = (datetime.strptime(since, "%Y-%m-%d").date()
                    - timedelta(days=CONDITIONS_LOOKBACK_DAYS)).isoformat()
        stat_filters.append(("gte", "game_date", lookback))
    stats = _fetch_all(
        "nba_player_stats", "player_id,team_id,game_id,game_date,minutes_played",
        stat_filters)

    dates_by_player: dict[int, list[str]] = {}
    for r in stats:
        if r.get("game_date") and (r.get("minutes_played") or 0) > 0:
            dates_by_player.setdefault(r["player_id"], []).append(r["game_date"])
    for d in dates_by_player.values():
        d.sort()

    import bisect
    rows: list[dict] = []
    for r in stats:
        game = games.get(r["game_id"])
        mins = r.get("minutes_played") or 0
        if not game or mins <= 0:
            continue
        team = r.get("team_id")
        if team == game["home_team_id"]:
            home_away, opp = "home", game["away_team_id"]
        elif team == game["away_team_id"]:
            home_away, opp = "away", game["home_team_id"]
        else:
            continue
        gd = game["game_date"]
        dates = dates_by_player.get(r["player_id"], [])
        i = bisect.bisect_left(dates, gd)
        if i > 0:
            rest = (datetime.strptime(gd, "%Y-%m-%d").date()
                    - datetime.strptime(dates[i - 1], "%Y-%m-%d").date()).days
        else:
            rest = CONDITIONS_LOOKBACK_DAYS if since else DAYS_REST_DEFAULT
        rows.append({
            "player_id": r["player_id"],
            "game_id": r["game_id"],
            "game_date": gd,
            "home_away": home_away,
            "days_rest": rest,
            "opponent_team_id": opp,
            "minutes_played": mins,
        })

    for i in range(0, len(rows), BATCH_SIZE):
        chunk = rows[i:i + BATCH_SIZE]
        for attempt in range(1, 4):
            try:
                supabase.table("player_game_conditions").upsert(
                    chunk, on_conflict="player_id,game_id", ignore_duplicates=not overwrite
                ).execute()
                break
            except Exception as exc:
                if attempt == 3:
                    print(f"  ERROR: pgc upsert failed after 3 attempts: {exc}")
                else:
                    time.sleep(5 * attempt)
    print(f"[derive_player_conditions] submitted {len(rows)} row(s) "
          f"across {len({r['game_id'] for r in rows})} game(s) "
          f"(existing rows untouched).")
    return len(rows)


# ── 3. BASIC STATS BACKFILL ─────────────────────────────────────────────────────

def _find_games_missing_basic_stats(
    season_filter: Optional[int],
    player_map: dict,
    game_map: dict,
) -> list[tuple[str, dict]]:
    """
    Identify games in every season present in game_map (or season_filter) that
    have zero or very few rows in nba_player_stats.

    A game is considered "missing" if it has fewer than 5 stat rows
    (the absolute minimum for any real game).
    """
    # Cover every season the games table knows about — current season included.
    # Using a hardcoded list historically skipped the live season and left
    # nba_player_stats empty for it, which downstream opp-defense ranking read as
    # "no data" and silently no-op'd.
    target_seasons = sorted({info["season"] for info in game_map.values()})
    if season_filter is not None:
        target_seasons = [s for s in target_seasons if s == season_filter]

    # Load stat counts per game_id
    print("Loading nba_player_stats game coverage ...")
    stat_rows = _fetch_all("nba_player_stats", "game_id")
    coverage: dict[int, int] = {}
    for r in stat_rows:
        gid = r["game_id"]
        coverage[gid] = coverage.get(gid, 0) + 1

    missing: list[tuple[str, dict]] = []
    for ext_id, info in game_map.items():
        if info["season"] not in target_seasons:
            continue
        db_id = info["id"]
        if coverage.get(db_id, 0) < 5:
            missing.append((ext_id, info))

    missing.sort(key=lambda x: x[1]["game_date"] or "")
    print(f"  Found {len(missing)} games with missing basic stats.")
    return missing


def backfill_basic_stats(
    season_filter: Optional[int] = None,
    test_mode: bool = False,
    resume: bool = False,
    yes: bool = False,
) -> None:
    """
    For each game with missing nba_player_stats rows, fetch the basic box
    score from ESPN (Phase 8 hybrid — replaces BoxScoreTraditionalV2) and
    upsert the data. Games are grouped by date because ESPN's scoreboard is
    date-driven; events are matched to DB games by (date, home, away team).

    Args:
        season_filter: Limit to one season int (e.g. 2024).
        test_mode:     Process only TEST_GAME_LIMIT games.
        resume:        Skip games that already have >= 5 stat rows
                       (implicit — the gap finder already excludes them).
    """
    from analytics.data.nba_espn.ingest import ingest_boxscores_for_date

    _, player_map, game_map = _load_id_maps()
    games_to_process = _find_games_missing_basic_stats(season_filter, player_map, game_map)

    if resume:
        # _find_games_missing_basic_stats already filters by coverage < 5,
        # so resume is implicitly handled — nothing extra needed.
        print("Resume mode active (games with >= 5 rows already excluded).")

    if test_mode:
        games_to_process = games_to_process[:TEST_GAME_LIMIT]
        print(f"Test mode: processing {len(games_to_process)} games.")
    elif games_to_process:
        # ESPN is not rate-limited — ~1 summary call per game, no pacing needed.
        print(f"\nAbout to backfill basic stats for {len(games_to_process)} "
              f"games via ESPN.")
        if yes:
            print("Auto-confirmed via --yes.")
        else:
            confirm = input("Proceed? [y/N] ").strip().lower()
            if confirm != "y":
                print("Aborted.")
                return

    # Group missing games by date — one scoreboard fetch per date.
    by_date: dict[str, list[str]] = {}
    for ext_id, game_info in games_to_process:
        gd = game_info["game_date"]
        if gd:
            by_date.setdefault(gd, []).append(ext_id)

    total_stat_rows = 0
    for date_num, (date_str, ext_ids) in enumerate(sorted(by_date.items()), start=1):
        print(f"[{date_num}/{len(by_date)}] {date_str} "
              f"({len(ext_ids)} game(s) missing stats)")
        _n_games, n_rows = ingest_boxscores_for_date(
            date_str, only_game_ext_ids=ext_ids)
        total_stat_rows += n_rows

    print(f"\nBasic stats backfill complete. Processed "
          f"{len(games_to_process)} games, {total_stat_rows} stat rows.")




# ── Opponent Position Defense Backfill ──────────────────────────────────────────

# backfill_opp_defense uses the shared POSITION_GROUP_MAP from connection.py
# (imported at the top): it covers both the legacy CommonTeamRoster grammar
# (G/F/C + dual "G-F") and ESPN's granular roster abbreviations (PG/SG/SF/PF).


def backfill_opp_defense(snapshot_date: str | None = None):
    """
    Compute opponent-position-defense rankings from nba_player_stats + player positions.

    For each (team, position_group) pair, compute the average pts/reb/ast that the
    team allows to opponents of that position group over the current season.
    Then rank teams 1-30 by total points allowed per position group (1=best defense).

    The result populates opponent_position_defense, which nightly.py uses to set
    opp_def_rank_position in daily_conditions.

    Args:
        snapshot_date: Date string (YYYY-MM-DD) for the snapshot. Defaults to today.
    """
    from datetime import date as dt_date

    if snapshot_date is None:
        snapshot_date = dt_date.today().strftime("%Y-%m-%d")

    print(f"Backfilling opponent_position_defense (snapshot: {snapshot_date}) ...")

    # Load player positions
    pos_rows = (
        supabase.table("players")
        .select("id,position")
        .eq("league", "nba")
        .not_.is_("position", "null")
        .limit(2000)
        .execute()
    )
    player_pos: dict[int, str] = {}
    for r in (pos_rows.data or []):
        pg = POSITION_GROUP_MAP.get(r["position"])
        if pg:
            player_pos[r["id"]] = pg

    if not player_pos:
        print("  No player positions found. Run --positions first.")
        return

    # Load all teams
    team_rows = supabase.table("teams").select("id").execute()
    all_team_ids = {r["id"] for r in (team_rows.data or [])}

    # Determine current season: games with the most recent dates
    latest_game = (
        supabase.table("games")
        .select("season")
        .order("game_date", desc=True)
        .limit(1)
        .execute()
    )
    current_season = latest_game.data[0]["season"] if latest_game.data else 2024

    # Load all games for the current season — _fetch_all paginates past the 1000-row cap
    game_rows_list = _fetch_all(
        "games",
        "id,home_team_id,away_team_id",
        [("eq", "season", current_season), ("eq", "league_id", NBA_LEAGUE_ID)],
    )
    games = {g["id"]: g for g in game_rows_list}

    # Load all stats for those games.
    # Use chunks of 40 game IDs: 40 games × ~26 rows/game ≈ 1040 rows/chunk which
    # stays within PostgREST's 1000-row default cap when rows per game avg < 25.
    # For any chunk that still hits the cap, paginate with a row-range loop.
    game_ids = list(games.keys())
    all_stats: list[dict] = []
    STAT_CHUNK = 40
    for i in range(0, len(game_ids), STAT_CHUNK):
        chunk = game_ids[i:i + STAT_CHUNK]
        page, page_size = 0, 1000
        while True:
            start = page * page_size
            sr = (
                supabase.table("nba_player_stats")
                .select("player_id,team_id,game_id,points,rebounds,assists,three_points_made")
                .in_("game_id", chunk)
                .range(start, start + page_size - 1)
                .execute()
            )
            batch = sr.data or []
            all_stats.extend(batch)
            if len(batch) < page_size:
                break
            page += 1

    print(f"  Loaded {len(all_stats)} stat rows for season {current_season}")

    # Accumulate: for each defending_team + position_group, sum stats allowed
    # "allowed" = stats by opponents playing AGAINST the team
    from collections import defaultdict
    accum: dict[tuple[int, str], list[dict]] = defaultdict(list)

    for stat in all_stats:
        pid = stat["player_id"]
        pos_group = player_pos.get(pid)
        if not pos_group:
            continue

        game = games.get(stat["game_id"])
        if not game:
            continue

        player_team_id = stat["team_id"]
        # The defending team is the OTHER team in this game
        if player_team_id == game["home_team_id"]:
            defending_team = game["away_team_id"]
        elif player_team_id == game["away_team_id"]:
            defending_team = game["home_team_id"]
        else:
            continue

        accum[(defending_team, pos_group)].append({
            "pts":  stat.get("points", 0) or 0,
            "reb":  stat.get("rebounds", 0) or 0,
            "ast":  stat.get("assists", 0) or 0,
            "fg3m": stat.get("three_points_made", 0) or 0,
        })

    # Compute averages per (team, position_group)
    avgs: dict[tuple[int, str], dict] = {}
    for key, stats_list in accum.items():
        n = len(stats_list)
        if n == 0:
            continue
        avgs[key] = {
            "pts_allowed_pg":  sum(s["pts"]  for s in stats_list) / n,
            "reb_allowed_pg":  sum(s["reb"]  for s in stats_list) / n,
            "ast_allowed_pg":  sum(s["ast"]  for s in stats_list) / n,
            "fg3m_allowed_pg": sum(s["fg3m"] for s in stats_list) / n,
        }

    # Rank each stat within each position_group (1 = fewest allowed = best defense)
    for pos_group in ("G", "F", "C"):
        group_entries = [
            (team_id, data)
            for (team_id, pg), data in avgs.items()
            if pg == pos_group
        ]
        for stat_key, rank_key in (
            ("pts_allowed_pg",  "league_rank"),  # backward-compat name
            ("reb_allowed_pg",  "reb_rank"),
            ("ast_allowed_pg",  "ast_rank"),
            ("fg3m_allowed_pg", "fg3m_rank"),
        ):
            group_entries.sort(key=lambda x: x[1][stat_key])
            for rank, (team_id, data) in enumerate(group_entries, 1):
                avgs[(team_id, pos_group)][rank_key] = rank

    # Upsert into opponent_position_defense
    rows = []
    for (team_id, pos_group), data in avgs.items():
        rows.append({
            "team_id":         team_id,
            "position_group":  pos_group,
            "snapshot_date":   snapshot_date,
            "pts_allowed_pg":  round(data["pts_allowed_pg"],  2),
            "reb_allowed_pg":  round(data["reb_allowed_pg"],  2),
            "ast_allowed_pg":  round(data["ast_allowed_pg"],  2),
            "fg3m_allowed_pg": round(data["fg3m_allowed_pg"], 2),
            "league_rank":     data.get("league_rank"),
            "reb_rank":        data.get("reb_rank"),
            "ast_rank":        data.get("ast_rank"),
            "fg3m_rank":       data.get("fg3m_rank"),
        })

    if not rows:
        # Fail loud: a successful opp-defense run must produce rankings. Reaching
        # here means upstream data is missing (typically nba_player_stats for the
        # current season). Exiting 0 here would mask the gap.
        raise RuntimeError(
            f"No opponent defense data computed for season {current_season}. "
            f"Loaded {len(all_stats)} stat rows across "
            f"{len(game_ids)} games, {len(player_pos)} positioned players. "
            "Verify nba_player_stats coverage for the current season."
        )

    for i in range(0, len(rows), BATCH_SIZE):
        chunk = rows[i:i + BATCH_SIZE]
        supabase.table("opponent_position_defense").upsert(
            chunk, on_conflict="team_id,position_group,snapshot_date"
        ).execute()
    print(f"  Upserted {len(rows)} opponent_position_defense rows.")



# ── CLI ─────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="StatTrak NBA enrichment (ESPN + DB-derived only)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--positions", action="store_true",
                        help="ESPN roster position backfill")
    parser.add_argument("--basic-stats", action="store_true", dest="basic_stats",
                        help="ESPN basic box-score gap fill")
    parser.add_argument("--opp-defense", action="store_true", dest="opp_defense",
                        help="Compute opponent_position_defense rankings")
    parser.add_argument("--conditions", action="store_true",
                        help="Derive player_game_conditions from nba_player_stats + games")
    parser.add_argument("--since", type=str, default=None,
                        help="With --conditions: only games on/after YYYY-MM-DD")
    parser.add_argument("--overwrite", action="store_true",
                        help="With --conditions: also rewrite existing rows' basic columns "
                             "(repairs legacy days_rest); advanced columns untouched")
    parser.add_argument("--test", action="store_true",
                        help=f"Process only {TEST_GAME_LIMIT} games (--basic-stats)")
    parser.add_argument("--season", type=int, choices=SEASON_INTS,
                        metavar="{" + ",".join(str(s) for s in SEASON_INTS) + "}",
                        help="Filter to a single season (e.g. 2024)")
    parser.add_argument("--resume", action="store_true", help="(--basic-stats) no-op; gap finder is already resumable")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    if args.positions:
        backfill_positions()
    elif args.basic_stats:
        backfill_basic_stats(season_filter=args.season, test_mode=args.test,
                             resume=args.resume, yes=args.yes)
    elif args.opp_defense:
        backfill_opp_defense()
    else:
        # Default (and --conditions): derive player_game_conditions.
        derive_player_conditions(since=args.since, season_filter=args.season,
                                 overwrite=args.overwrite)
    return 0


if __name__ == "__main__":
    sys.exit(main())
