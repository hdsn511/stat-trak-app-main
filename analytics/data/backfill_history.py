"""
Backfill historical NBA seasons into games + nba_player_stats.

Adds 2019-20, 2020-21, 2021-22 seasons to match the 5-season window
needed for robust backtesting. Reuses existing team/player DB records.

Usage:
    python -m analytics.data.backfill_history                    # All 3 missing seasons
    python -m analytics.data.backfill_history --season 2019      # Single season
    python -m analytics.data.backfill_history --stats-only       # Skip games, just stats
    python -m analytics.data.backfill_history --test             # 1 season, 5 players
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from typing import Any, Optional

from requests.exceptions import ConnectionError, ReadTimeout

from analytics.db.connection import (
    API_DELAY_SECONDS,
    BATCH_SIZE,
    NBA_LEAGUE_ID,
    season_int_to_str,
    supabase,
)
from analytics.data.enrich_games import (
    _fetch_all,
    _parse_minutes,
    _upsert_batch,
    api_call_with_retry,
)

# ── Constants ─────────────────────────────────────────────────────────────────

BACKFILL_SEASONS = [2019, 2020, 2021]
TEST_PLAYER_LIMIT = 5
BREAK_EVERY_N_PLAYERS = 50
BREAK_DURATION_SECONDS = 30

# Handle historical team abbreviation differences in nba_api matchup strings
ABBR_ALIASES: dict[str, str] = {
    "NJN": "BKN",
    "CHO": "CHA",
    "NOH": "NOP",
}


# ── DB map loaders ────────────────────────────────────────────────────────────

def _load_team_abbr_map() -> dict[str, int]:
    """Load {abbreviation: db_id} from teams table."""
    rows = _fetch_all("teams", "id,abbreviation")
    mapping = {r["abbreviation"]: r["id"] for r in rows}
    print(f"  Teams loaded: {len(mapping)}")
    return mapping


def _load_player_ext_map() -> dict[str, int]:
    """Load {ext_id: db_id} from players table (NBA only)."""
    rows = _fetch_all("players", "id,ext_id", [("eq", "league", "nba")])
    mapping = {r["ext_id"]: r["id"] for r in rows}
    print(f"  Players loaded: {len(mapping)}")
    return mapping


def _load_game_ext_map() -> dict[str, int]:
    """Load {ext_id: db_id} from games table (NBA only)."""
    rows = _fetch_all("games", "id,ext_id", [("eq", "league_id", NBA_LEAGUE_ID)])
    mapping = {r["ext_id"]: r["id"] for r in rows}
    print(f"  Games loaded: {len(mapping)}")
    return mapping


def _resolve_abbr(abbr: str) -> str:
    """Resolve historical abbreviation aliases to current ones."""
    return ABBR_ALIASES.get(abbr, abbr)


# ── Game backfill ─────────────────────────────────────────────────────────────

def _parse_matchup(matchup: str, team_abbr_map: dict[str, int]):
    """
    Parse NBA API matchup string like 'LAL vs. BOS' or 'BOS @ LAL'.

    'X vs. Y' means X is home, Y is away.
    'X @ Y'   means X is away, Y is home.

    Returns (home_team_db_id, away_team_db_id) or (None, None) on failure.
    """
    if " vs. " in matchup:
        parts = matchup.split(" vs. ")
        home_abbr = _resolve_abbr(parts[0].strip())
        away_abbr = _resolve_abbr(parts[1].strip())
    elif " @ " in matchup:
        parts = matchup.split(" @ ")
        away_abbr = _resolve_abbr(parts[0].strip())
        home_abbr = _resolve_abbr(parts[1].strip())
    else:
        return None, None

    home_id = team_abbr_map.get(home_abbr)
    away_id = team_abbr_map.get(away_abbr)
    return home_id, away_id


def backfill_games(seasons: list[int]) -> None:
    """
    Fetch all regular-season games for the given seasons via LeagueGameFinder
    and upsert into the games table.
    """
    try:
        from nba_api.stats.endpoints import LeagueGameFinder
    except ImportError as exc:
        print(f"ERROR: nba_api not installed: {exc}")
        sys.exit(1)

    print("Loading team abbreviation map ...")
    team_abbr_map = _load_team_abbr_map()

    for season_int in seasons:
        season_str = season_int_to_str(season_int)
        print(f"\n{'='*60}")
        print(f"Backfilling games for season {season_str} ...")
        print(f"{'='*60}")

        def _call(s=season_str):
            return LeagueGameFinder(
                season_nullable=s,
                league_id_nullable="00",
            )

        result = api_call_with_retry(_call, f"LeagueGameFinder {season_str}")
        if result is None:
            print(f"  ERROR: Could not fetch games for {season_str}. Skipping.")
            continue

        try:
            df = result.get_data_frames()[0]
        except Exception as exc:
            print(f"  ERROR: Could not parse LeagueGameFinder response: {exc}")
            continue

        if df.empty:
            print(f"  No games found for {season_str}.")
            continue

        # Deduplicate by GAME_ID — LeagueGameFinder returns one row per team
        # so each game appears twice. We keep both rows to extract matchup info,
        # but deduplicate for the insert.
        seen_game_ids: set[str] = set()
        game_rows: list[dict] = []

        for _, row in df.iterrows():
            game_ext_id = str(row.get("GAME_ID", "")).strip()
            if not game_ext_id or game_ext_id in seen_game_ids:
                continue

            matchup = str(row.get("MATCHUP", ""))
            home_id, away_id = _parse_matchup(matchup, team_abbr_map)
            if home_id is None or away_id is None:
                # Try to find the other row for this game to get the home matchup
                other_rows = df[
                    (df["GAME_ID"].astype(str) == game_ext_id)
                    & (df.index != row.name)
                ]
                resolved = False
                for _, other in other_rows.iterrows():
                    other_matchup = str(other.get("MATCHUP", ""))
                    home_id, away_id = _parse_matchup(other_matchup, team_abbr_map)
                    if home_id is not None and away_id is not None:
                        resolved = True
                        break
                if not resolved:
                    # Last resort: skip if we can't determine home/away
                    continue

            # Parse game date
            game_date_raw = str(row.get("GAME_DATE", ""))
            # GAME_DATE format from nba_api is typically 'YYYY-MM-DD'
            game_date = game_date_raw[:10] if len(game_date_raw) >= 10 else game_date_raw

            # Scores: we need both teams' scores. Get from both rows.
            all_rows_for_game = df[df["GAME_ID"].astype(str) == game_ext_id]
            home_score = None
            away_score = None
            for _, g_row in all_rows_for_game.iterrows():
                g_matchup = str(g_row.get("MATCHUP", ""))
                g_abbr = _resolve_abbr(str(g_row.get("TEAM_ABBREVIATION", "")).strip())
                pts = g_row.get("PTS")
                if g_abbr and team_abbr_map.get(g_abbr) == home_id:
                    home_score = int(pts) if pts is not None and not (isinstance(pts, float) and math.isnan(pts)) else None
                elif g_abbr and team_abbr_map.get(g_abbr) == away_id:
                    away_score = int(pts) if pts is not None and not (isinstance(pts, float) and math.isnan(pts)) else None

            seen_game_ids.add(game_ext_id)
            game_rows.append({
                "league_id": NBA_LEAGUE_ID,
                "season": season_int,
                "game_date": game_date,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "home_score": home_score,
                "away_score": away_score,
                "status": "completed",
                "ext_id": game_ext_id,
            })

        print(f"  Parsed {len(game_rows)} unique games for {season_str}.")

        if game_rows:
            _upsert_batch("games", game_rows, "league_id,ext_id")
            print(f"  Upserted {len(game_rows)} games.")

    print("\nGame backfill complete.")


# ── Player stats backfill ─────────────────────────────────────────────────────

def _load_existing_player_seasons() -> set[tuple[int, int]]:
    """
    Load set of (player_db_id, season_int) pairs that already have stats
    in nba_player_stats. Used by --resume to skip completed player/season combos.
    """
    print("Loading existing player stats for resume check ...")
    rows = _fetch_all(
        "nba_player_stats",
        "player_id,game_date",
    )
    # Derive season from game_date: games in Oct-Dec belong to that year's season,
    # games in Jan-Jun belong to previous year's season.
    existing: set[tuple[int, int]] = set()
    for r in rows:
        pid = r["player_id"]
        gd = r.get("game_date", "")
        if not gd:
            continue
        try:
            year = int(gd[:4])
            month = int(gd[5:7])
            season = year if month >= 10 else year - 1
            existing.add((pid, season))
        except (ValueError, IndexError):
            pass
    print(f"  Found stats for {len(existing)} player-season combinations.")
    return existing


def backfill_stats(
    seasons: list[int],
    test_mode: bool = False,
    resume: bool = False,
) -> None:
    """
    For each player in our DB, fetch their game logs for the given seasons
    via PlayerGameLog and upsert into nba_player_stats.
    """
    try:
        from nba_api.stats.endpoints import PlayerGameLog
    except ImportError as exc:
        print(f"ERROR: nba_api not installed: {exc}")
        sys.exit(1)

    print("\nLoading DB maps ...")
    player_ext_map = _load_player_ext_map()
    game_ext_map = _load_game_ext_map()

    # Build reverse map: ext_id -> player_ext_id for iteration
    player_list = list(player_ext_map.items())  # [(ext_id, db_id), ...]

    if test_mode:
        player_list = player_list[:TEST_PLAYER_LIMIT]
        seasons = seasons[:1]
        print(f"Test mode: {len(player_list)} players, season(s) {seasons}")

    existing_combos: set[tuple[int, int]] = set()
    if resume:
        existing_combos = _load_existing_player_seasons()

    total_players = len(player_list)
    total_seasons = len(seasons)
    total_ops = total_players * total_seasons
    estimated_seconds = total_ops * API_DELAY_SECONDS + (
        total_players // BREAK_EVERY_N_PLAYERS * BREAK_DURATION_SECONDS
    )
    estimated_minutes = math.ceil(estimated_seconds / 60)

    if not test_mode:
        print(
            f"\nAbout to fetch game logs for {total_players} players "
            f"x {total_seasons} seasons = {total_ops} API calls "
            f"(~{estimated_minutes} min estimated)."
        )
        confirm = input("Proceed? [y/N] ").strip().lower()
        if confirm != "y":
            print("Aborted.")
            return

    stat_rows_buffer: list[dict] = []
    players_processed = 0
    stats_inserted = 0

    for p_idx, (p_ext_id, p_db_id) in enumerate(player_list, start=1):
        for season_int in seasons:
            if resume and (p_db_id, season_int) in existing_combos:
                continue

            season_str = season_int_to_str(season_int)
            print(
                f"  [{p_idx}/{total_players}] Player ext_id={p_ext_id} "
                f"season={season_str}",
                end=" ... ",
                flush=True,
            )

            def _call(pid=p_ext_id, s=season_str):
                return PlayerGameLog(
                    player_id=pid,
                    season=s,
                    season_type_all_star="Regular Season",
                )

            result = api_call_with_retry(
                _call, f"PlayerGameLog {p_ext_id} {season_str}"
            )
            if result is None:
                print("SKIPPED (API failure)")
                continue

            try:
                df = result.get_data_frames()[0]
            except Exception as exc:
                print(f"ERROR parsing: {exc}")
                continue

            if df.empty:
                print("no games")
                continue

            count = 0
            for _, row in df.iterrows():
                game_ext_id = str(row.get("Game_ID", "")).strip()
                game_db_id = game_ext_map.get(game_ext_id)
                if game_db_id is None:
                    # Game not in our DB — skip
                    continue

                # Parse game date from the log row
                game_date_raw = str(row.get("GAME_DATE", ""))
                # PlayerGameLog GAME_DATE can be 'MMM DD, YYYY' or 'YYYY-MM-DD'
                game_date = game_date_raw[:10] if len(game_date_raw) >= 10 else game_date_raw

                # Determine team_id from MATCHUP
                matchup = str(row.get("MATCHUP", ""))
                team_abbr_raw = matchup.split(" ")[0].strip() if matchup else ""
                # We don't have team_abbr_map here — load it or use a different approach
                # Actually, PlayerGameLog does not have TEAM_ID directly, but we can
                # look up the player's team from the game's home/away teams.
                # Simpler: just use None for team_id and let the upsert skip it.
                # Actually we need team_id. Let's just load the team abbr map.

                # We'll set team_id below after we build the abbr map outside the loop
                stat_rows_buffer.append({
                    "game_id": game_db_id,
                    "player_id": p_db_id,
                    "team_id": None,  # will be resolved
                    "game_date": game_date,
                    "points": _safe_int(row.get("PTS")),
                    "rebounds": _safe_int(row.get("REB")),
                    "assists": _safe_int(row.get("AST")),
                    "three_points_made": _safe_int(row.get("FG3M")),
                    "fouls": _safe_int(row.get("PF")),
                    "minutes_played": _parse_minutes(row.get("MIN")),
                    "_matchup": matchup,  # temporary, for team resolution
                })
                count += 1

            print(f"{count} games")
            stats_inserted += count

        players_processed += 1

        # Periodic break
        if players_processed % BREAK_EVERY_N_PLAYERS == 0 and p_idx < total_players:
            # Resolve team IDs and flush before break
            stat_rows_buffer = _resolve_team_ids(stat_rows_buffer)
            if stat_rows_buffer:
                _upsert_batch("nba_player_stats", stat_rows_buffer, "game_id,player_id")
                stat_rows_buffer = []
            print(
                f"  -- Processed {players_processed}/{total_players} players. "
                f"Pausing {BREAK_DURATION_SECONDS}s ..."
            )
            time.sleep(BREAK_DURATION_SECONDS)

        # Flush when buffer is large
        if len(stat_rows_buffer) >= BATCH_SIZE:
            stat_rows_buffer = _resolve_team_ids(stat_rows_buffer)
            _upsert_batch("nba_player_stats", stat_rows_buffer, "game_id,player_id")
            stat_rows_buffer = []

    # Final flush
    if stat_rows_buffer:
        stat_rows_buffer = _resolve_team_ids(stat_rows_buffer)
        _upsert_batch("nba_player_stats", stat_rows_buffer, "game_id,player_id")

    print(f"\nStats backfill complete. {stats_inserted} stat rows across {players_processed} players.")


# Team abbreviation map (loaded lazily for stats backfill)
_team_abbr_map_cache: Optional[dict[str, int]] = None


def _get_team_abbr_map() -> dict[str, int]:
    """Lazy-load team abbreviation map."""
    global _team_abbr_map_cache
    if _team_abbr_map_cache is None:
        _team_abbr_map_cache = _load_team_abbr_map()
    return _team_abbr_map_cache


def _resolve_team_ids(rows: list[dict]) -> list[dict]:
    """
    Resolve the _matchup temporary field to a team_id for each row,
    then remove the _matchup field.
    """
    team_map = _get_team_abbr_map()
    resolved = []
    for row in rows:
        matchup = row.pop("_matchup", "")
        if row["team_id"] is None and matchup:
            # First token of matchup is the player's team abbreviation
            abbr = _resolve_abbr(matchup.split(" ")[0].strip())
            row["team_id"] = team_map.get(abbr)
        if row["team_id"] is not None:
            resolved.append(row)
        else:
            # Can't determine team — skip this row
            pass
    return resolved


def _safe_int(val, default: int = 0) -> Optional[int]:
    """Safely convert a value to int."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill historical NBA seasons (2019-2021) into games + nba_player_stats",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m analytics.data.backfill_history                    # All 3 missing seasons
  python -m analytics.data.backfill_history --season 2019      # Single season
  python -m analytics.data.backfill_history --stats-only       # Skip games, just stats
  python -m analytics.data.backfill_history --test             # 1 season, 5 players
  python -m analytics.data.backfill_history --resume           # Skip already-fetched
        """,
    )
    parser.add_argument(
        "--season",
        type=int,
        choices=BACKFILL_SEASONS,
        metavar="{" + ",".join(str(s) for s in BACKFILL_SEASONS) + "}",
        help="Backfill only this season (2019, 2020, or 2021)",
    )
    parser.add_argument(
        "--stats-only",
        action="store_true",
        dest="stats_only",
        help="Skip game backfill, only fetch player stats",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help=f"Limit to first season, first {TEST_PLAYER_LIMIT} players",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip players that already have stats for a given season",
    )

    args = parser.parse_args()

    seasons = [args.season] if args.season else BACKFILL_SEASONS

    if args.test:
        seasons = seasons[:1]

    if not args.stats_only:
        backfill_games(seasons)

    backfill_stats(
        seasons=seasons,
        test_mode=args.test,
        resume=args.resume,
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
