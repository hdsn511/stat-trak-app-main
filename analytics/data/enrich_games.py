"""
analytics/data/enrich_games.py

Enrichment operations for StatTrak Analytics (Phase 8 hybrid: ESPN for basic
data, nba_api ONLY for advanced stats):
  1.   backfill_positions()    -- ESPN current rosters -> players.position
  1.5  resolve_nba_ext_ids()   -- heal ESPN-discovered games to nba-native
                                  ext_ids (one ScoreboardV3 call per date)
  2.   enrich_games()          -- nba_api BoxScoreAdvancedV3 + PlayerTrackV3 +
                                  BoxScoreSummaryV2 (ADVANCED — stays on
                                  nba_api) -> player_game_conditions,
                                  team_game_stats, player_availability
  3.   backfill_basic_stats()  -- ESPN summary box scores -> nba_player_stats

CLI:
    python -m analytics.data.enrich_games --positions
    python -m analytics.data.enrich_games --basic-stats
    python -m analytics.data.enrich_games --test
    python -m analytics.data.enrich_games --season 2024
    python -m analytics.data.enrich_games --resume
    python -m analytics.data.enrich_games
"""

from __future__ import annotations

import argparse
import math
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import date, datetime
from typing import Any, Callable, Optional

from requests.exceptions import ConnectionError, ReadTimeout

from analytics.db.connection import (
    API_DELAY_SECONDS,
    BACKOFF_BASE_SECONDS,
    BACKOFF_MAX_SECONDS,
    BATCH_SIZE,
    MAX_RETRIES,
    NBA_LEAGUE_ID,
    POSITION_GROUP_MAP,
    SEASON_INTS,
    season_int_to_str,
    supabase,
)

# ── Module-level tunable constants ─────────────────────────────────────────────
BREAK_EVERY_N_GAMES = 50       # Pause enrichment loop every N games
BREAK_DURATION_SECONDS = 30    # How long to pause (rate-limit courtesy)
TEST_GAME_LIMIT = 5            # Number of games to process in --test mode
DAYS_REST_DEFAULT = 3          # Days rest assumed when no prior game found
MINUTES_DEFAULT = 0            # Fallback minutes when parsing fails

# Adaptive rate-limiting — kicks in after a call exhausts all retries
COOLDOWN_SECONDS_MIN = 120     # Min cooldown after suspected rate limit
COOLDOWN_SECONDS_MAX = 180     # Max cooldown (jittered)
SLOW_MODE_CALLS = 30           # Number of subsequent calls in slow mode
SLOW_MODE_DELAY_MIN = 5.0      # Min delay between calls while in slow mode
SLOW_MODE_DELAY_MAX = 10.0     # Max delay (jittered)

# Hard wall-clock kill for hung API calls. On Windows, a blackholed socket can
# keep a requests call blocked past the library's own timeout — this ensures
# we always surface a timeout exception so retry/cooldown logic fires.
HARD_TIMEOUT_SECONDS = 45

# ── Backfill speed tuning (used by --backfill-track mode) ─────────────────────
# Backfill assumes the API is healthy — go fast, only slow down on real signal.
# TODO: tune against observed nba_api 429 frequency. Lower if API tolerates faster cadence.
FAST_RETRY_SECONDS = 5
# First-failure quick retry. Most transient errors (timeouts, dropped connections)
# clear in well under 5 seconds.

DOUBLE_FAIL_TRIGGERS_COOLDOWN = True
# When the FAST_RETRY also fails, escalate to the existing _trigger_cooldown()
# (120-180s jittered + 30-call slow mode). Two consecutive failures within seconds
# is a strong signal of a real problem, not a blip.

BACKFILL_API_DELAY_SECONDS = 0.0
# In --backfill-track mode, skip the inter-call API_DELAY_SECONDS floor.
# Rate-limit signal (429s) and the cooldown ladder are the only governors.

# Module-level state for adaptive delay
_slow_mode_calls_remaining = 0


def _adaptive_delay() -> float:
    """Return delay to apply before the next API call.

    Normally returns API_DELAY_SECONDS. After a cooldown trigger, returns a
    random value in [SLOW_MODE_DELAY_MIN, SLOW_MODE_DELAY_MAX] for the next
    SLOW_MODE_CALLS calls before auto-returning to normal pace.
    """
    global _slow_mode_calls_remaining
    if _slow_mode_calls_remaining > 0:
        _slow_mode_calls_remaining -= 1
        return random.uniform(SLOW_MODE_DELAY_MIN, SLOW_MODE_DELAY_MAX)
    return API_DELAY_SECONDS


def _call_with_hard_timeout(fn: Callable) -> Any:
    """Run fn() in a worker thread with a strict wall-clock timeout.

    If the call doesn't return within HARD_TIMEOUT_SECONDS, raises FutureTimeout
    and the worker is abandoned (shutdown(wait=False)). This is the only reliable
    way to recover from Windows socket hangs where requests' own timeout never
    fires because the kernel never sees an RST/FIN from the peer.
    """
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="nba_api")
    try:
        future = executor.submit(fn)
        return future.result(timeout=HARD_TIMEOUT_SECONDS)
    finally:
        executor.shutdown(wait=False)


def _trigger_cooldown(description: str) -> None:
    """Sleep a long jittered cooldown and engage slow mode.

    Called after an API call exhausts all retries — indicates the NBA Stats
    API has started rate-limiting this IP. Subsequent calls use 5-10s
    randomized delays for SLOW_MODE_CALLS to let the rate limit window clear
    without risking a longer blacklist.
    """
    global _slow_mode_calls_remaining
    cooldown = random.uniform(COOLDOWN_SECONDS_MIN, COOLDOWN_SECONDS_MAX)
    print(
        f"\n  RATE LIMIT suspected after [{description}] — "
        f"cooling down {cooldown:.0f}s, then slow mode for next "
        f"{SLOW_MODE_CALLS} calls."
    )
    time.sleep(cooldown)
    _slow_mode_calls_remaining = SLOW_MODE_CALLS


# ── Supabase pagination helper ──────────────────────────────────────────────────

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
    while True:
        start = page * page_size
        end = start + page_size - 1
        q = supabase.table(table).select(select).range(start, end)
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

def api_call_with_retry(call_fn, description: str, backfill_mode: bool = False) -> Optional[Any]:
    """
    Call call_fn() with exponential backoff on network errors and HTTP 429.

    Returns the result of call_fn() or None after MAX_RETRIES failures.
    Always sleeps API_DELAY_SECONDS before the first attempt and between retries.
    On HTTP 429 (rate limit), uses double backoff and does not count against retries,
    up to a maximum of MAX_RATE_LIMIT_RETRIES times before giving up.

    backfill_mode (Task 3): when True, use FAST_RETRY_SECONDS on first failure,
    then escalate to _trigger_cooldown() on the second consecutive failure;
    skip the inter-call API_DELAY_SECONDS floor so backfill cadence is governed
    by 429s and the cooldown ladder rather than a fixed delay.
    """
    MAX_RATE_LIMIT_RETRIES = 10
    rate_limit_hits = 0
    consecutive_failures = 0
    attempt = 0
    while attempt < MAX_RETRIES:
        attempt += 1
        # Backfill mode skips the adaptive_delay floor — let cooldown ladder govern cadence
        if backfill_mode:
            time.sleep(BACKFILL_API_DELAY_SECONDS)
        else:
            time.sleep(_adaptive_delay())
        try:
            result = _call_with_hard_timeout(call_fn)
            consecutive_failures = 0
            return result
        except (ReadTimeout, ConnectionError, FutureTimeout) as exc:
            label = (
                f"hard timeout after {HARD_TIMEOUT_SECONDS}s"
                if isinstance(exc, FutureTimeout)
                else type(exc).__name__
            )
            consecutive_failures += 1
            if backfill_mode:
                # Fast retry on first transient failure
                if consecutive_failures == 1:
                    print(
                        f"  WARNING [{description}] attempt {attempt}/{MAX_RETRIES} "
                        f"failed ({label}). Fast retry in {FAST_RETRY_SECONDS}s ..."
                    )
                    time.sleep(FAST_RETRY_SECONDS)
                    continue
                if DOUBLE_FAIL_TRIGGERS_COOLDOWN and consecutive_failures >= 2:
                    print(
                        f"  WARNING [{description}] second consecutive failure ({label}). "
                        f"Escalating to cooldown."
                    )
                    _trigger_cooldown(description)
                    consecutive_failures = 0
                    continue
            wait = min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_MAX_SECONDS)
            print(
                f"  WARNING [{description}] attempt {attempt}/{MAX_RETRIES} "
                f"failed ({label}). Waiting {wait}s ..."
            )
            time.sleep(wait)
        except Exception as exc:  # noqa: BLE001
            exc_str = str(exc).lower()
            if "429" in exc_str or "rate limit" in exc_str or "too many requests" in exc_str:
                rate_limit_hits += 1
                if rate_limit_hits > MAX_RATE_LIMIT_RETRIES:
                    print(
                        f"  ERROR [{description}] too many 429 rate limits "
                        f"({rate_limit_hits}). Giving up."
                    )
                    return None
                attempt -= 1  # 429 does not count against MAX_RETRIES
                wait = min(BACKOFF_BASE_SECONDS * (2 ** rate_limit_hits), BACKOFF_MAX_SECONDS)
                print(
                    f"  WARNING [{description}] HTTP 429 rate limited "
                    f"(hit #{rate_limit_hits}). Waiting {wait}s ..."
                )
                time.sleep(wait)
            else:
                print(f"  ERROR [{description}] unexpected error: {exc}")
                return None
    print(f"  ERROR [{description}] all {MAX_RETRIES} retries exhausted. Skipping.")
    _trigger_cooldown(description)
    return None


# ── Minute parsing ──────────────────────────────────────────────────────────────

def _safe_float(v) -> Optional[float]:
    """Coerce a value to float, returning None for NaN/None/non-numeric."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    return f


def fetch_player_track(game_id: str, backfill_mode: bool = False) -> Optional[list[dict]]:
    """
    Fetch BoxScorePlayerTrackV3 for one game and return per-player rows.

    DO NOT re-add time_of_possession / front_court_touches / paint_touches.
    These fields existed in V2 but are NOT in V3, and V2 now returns invalid
    JSON for many recent games (coverage is unreliable). Decision logged
    2026-05-03: touches is the sole opportunity signal — passes correlates
    with playmaking role rather than scoring opportunity, and a separate
    TOP endpoint isn't worth the complexity given V2's data-reliability
    problem. The schema columns are kept (always NULL) so historical V2
    data, if ever sourced, can be backfilled without a migration.
    """
    try:
        from nba_api.stats.endpoints import boxscoreplayertrackv3
    except ImportError as exc:
        print(f"  ERROR: nba_api missing boxscoreplayertrackv3: {exc}")
        return None

    def _call():
        return boxscoreplayertrackv3.BoxScorePlayerTrackV3(game_id=game_id, timeout=30)

    resp = api_call_with_retry(_call, f"PlayerTrackV3 game_id={game_id}", backfill_mode=backfill_mode)
    if resp is None:
        return None

    try:
        df = resp.get_data_frames()[0]
    except Exception as exc:
        print(f"  WARNING: PlayerTrackV3 parse error for {game_id}: {exc}")
        return None

    rows = []
    for _, r in df.iterrows():
        pid_raw = r.get("personId", r.get("PERSON_ID"))
        if pid_raw is None:
            continue
        try:
            pid = int(pid_raw)
        except (TypeError, ValueError):
            continue
        rows.append({
            "player_ext_id":       str(pid),
            "touches":             _safe_float(r.get("touches", r.get("TOUCHES"))),
            "front_court_touches": None,  # not exposed by V3
            "time_of_possession":  None,  # not exposed by V3
            "paint_touches":       None,  # not exposed by V3
            "avg_speed":           _safe_float(r.get("speed", r.get("SPEED"))),
        })
    return rows


def _parse_minutes(raw) -> int:
    """
    Parse NBA API minutes field to integer minutes.
    Handles "MM:SS" strings, float values, None, and empty strings.
    """
    if raw is None or raw == "":
        return MINUTES_DEFAULT
    if isinstance(raw, (int, float)):
        return int(raw)
    if isinstance(raw, str) and ":" in raw:
        parts = raw.split(":")
        try:
            return int(parts[0])
        except ValueError:
            return MINUTES_DEFAULT
    try:
        return int(float(raw))
    except (ValueError, TypeError):
        return MINUTES_DEFAULT


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


# ── 1.5 NBA-NATIVE EXT_ID HEALING ───────────────────────────────────────────────

_NBA_NATIVE_EXT_ID_RE = re.compile(r"^00\d{8}$")


def resolve_nba_ext_ids() -> None:
    """Heal provisional ESPN ext_ids on NBA `games` rows to nba-native ids.

    The ESPN-backed slate/discovery paths (nightly.get_slate,
    nightly.backfill_completed_games) insert new games with ext_id = ESPN
    event id because ESPN does not expose the NBA-native game id (verified
    live 2026-07-31). The advanced-stats fetches below key on the native id
    ("0022500123"-style — also what the game_type generated column reads), so
    this resolves it with ONE ScoreboardV3 call per affected date, matching
    games by (home_team, away_team). It is the only schedule-shaped nba_api
    call left, and it exists purely as plumbing for the advanced path.

    Never touches rows that already look nba-native; a date that cannot be
    resolved warns loudly and is retried on the next run.
    """
    pending = _fetch_all(
        "games",
        "id,ext_id,espn_id,game_date,home_team_id,away_team_id",
        [("eq", "league_id", NBA_LEAGUE_ID), ("not_.like", "ext_id", "00%")],
    )
    pending = [g for g in pending if not _NBA_NATIVE_EXT_ID_RE.match(g["ext_id"] or "")]
    if not pending:
        return

    try:
        from nba_api.stats.endpoints.scoreboardv3 import ScoreboardV3
    except ImportError as exc:
        print(f"  WARNING: nba_api unavailable ({exc}); "
              f"{len(pending)} game(s) keep provisional ESPN ext_ids.")
        return

    team_rows = _fetch_all("teams", "id,ext_id", [("eq", "league_id", NBA_LEAGUE_ID)])
    team_by_nba_ext = {r["ext_id"]: r["id"] for r in team_rows}
    native_taken = {
        g["ext_id"] for g in _fetch_all(
            "games", "ext_id", [("eq", "league_id", NBA_LEAGUE_ID),
                                ("like", "ext_id", "00%")])
    }

    by_date: dict[str, list[dict]] = {}
    for g in pending:
        by_date.setdefault(g["game_date"], []).append(g)
    print(f"[resolve_nba_ext_ids] {len(pending)} game(s) across "
          f"{len(by_date)} date(s) need nba-native ext_ids.")

    healed = 0
    for date_str, games in sorted(by_date.items()):
        def _sb3(ds=date_str):
            return ScoreboardV3(game_date=ds, league_id="00")

        result = api_call_with_retry(_sb3, f"ScoreboardV3 {date_str}")
        if result is None:
            print(f"  WARNING: ScoreboardV3 failed for {date_str}; "
                  f"{len(games)} game(s) stay provisional.")
            continue
        try:
            sb_games = result.get_dict().get("scoreboard", {}).get("games", [])
        except Exception as exc:
            print(f"  WARNING: ScoreboardV3 parse error for {date_str}: {exc}")
            continue

        native_by_pair: dict[tuple, str] = {}
        for g in sb_games:
            gid = str(g.get("gameId", "")).strip().zfill(10)
            h = team_by_nba_ext.get(str(g.get("homeTeam", {}).get("teamId", "")))
            a = team_by_nba_ext.get(str(g.get("awayTeam", {}).get("teamId", "")))
            if gid and h and a:
                native_by_pair[(h, a)] = gid

        for game in games:
            native = native_by_pair.get((game["home_team_id"], game["away_team_id"]))
            if not native:
                print(f"  WARNING: no ScoreboardV3 match for game id={game['id']} "
                      f"({date_str}, espn {game.get('espn_id')}).")
                continue
            if native in native_taken:
                print(f"  ERROR: native ext_id {native} already exists — game "
                      f"id={game['id']} is a duplicate row; resolve manually.")
                continue
            supabase.table("games").update({"ext_id": native}) \
                .eq("id", game["id"]).execute()
            native_taken.add(native)
            healed += 1
    print(f"[resolve_nba_ext_ids] healed {healed}/{len(pending)} game(s).")


# ── 2. GAME ENRICHMENT ──────────────────────────────────────────────────────────

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


def _load_player_stats_index(player_map: dict) -> dict[int, list[str]]:
    """
    Load all game_date values from nba_player_stats for each player_id.
    Returns {player_db_id: [sorted list of date strings]}.
    Used for days_rest calculation.
    """
    print("Loading nba_player_stats date index ...")
    rows = _fetch_all("nba_player_stats", "player_id,game_date")
    index: dict[int, list[str]] = {}
    for r in rows:
        pid = r["player_id"]
        gd = r["game_date"]
        if gd:
            index.setdefault(pid, []).append(gd)
    for pid in index:
        index[pid].sort()
    print(f"  Stat rows indexed for {len(index)} players.")
    return index


def _days_rest(player_db_id: int, current_date_str: str, stats_index: dict) -> int:
    """
    Compute days of rest before current_date_str for a player.
    Returns DAYS_REST_DEFAULT if no prior game exists in the index.
    """
    dates = stats_index.get(player_db_id, [])
    if not dates:
        return DAYS_REST_DEFAULT
    # Find the most recent date strictly before current_date_str
    prior = [d for d in dates if d < current_date_str]
    if not prior:
        return DAYS_REST_DEFAULT
    last = prior[-1]
    try:
        d1 = datetime.strptime(current_date_str, "%Y-%m-%d").date()
        d2 = datetime.strptime(last, "%Y-%m-%d").date()
        return (d1 - d2).days
    except ValueError:
        return DAYS_REST_DEFAULT


def _load_already_enriched() -> set[str]:
    """
    Return a set of game ext_ids that already have rows in player_game_conditions.
    Used by --resume to skip completed games.
    """
    rows = _fetch_all("player_game_conditions", "game_id")
    # We need to reverse-map game_id -> ext_id — load games for that
    enriched_game_ids = {r["game_id"] for r in rows}
    if not enriched_game_ids:
        return set()

    game_rows = _fetch_all("games", "id,ext_id", [("eq", "league_id", NBA_LEAGUE_ID)])
    return {r["ext_id"] for r in game_rows if r["id"] in enriched_game_ids}


def _upsert_batch(table: str, rows: list[dict], on_conflict: str) -> None:
    """
    Upsert rows in BATCH_SIZE chunks with on_conflict resolution.
    Retries up to 3 times on transient errors so a network blip doesn't
    crash a long-running backfill. Logs and skips a chunk after 3 failures.

    Deduplicates rows by on_conflict key (keeping the last value) before
    sending. Postgres rejects a single upsert containing two rows with the
    same conflict target with "ON CONFLICT DO UPDATE command cannot affect
    row a second time".
    """
    conflict_keys = [k.strip() for k in on_conflict.split(",")]
    deduped: dict[tuple, dict] = {}
    for row in rows:
        key = tuple(row.get(k) for k in conflict_keys)
        deduped[key] = row
    rows = list(deduped.values())

    for i in range(0, len(rows), BATCH_SIZE):
        chunk = rows[i : i + BATCH_SIZE]
        for attempt in range(1, 4):
            try:
                supabase.table(table).upsert(chunk, on_conflict=on_conflict).execute()
                break
            except Exception as exc:
                if attempt < 3:
                    wait = 5 * attempt
                    print(
                        f"\n  WARNING: upsert to {table} failed (attempt {attempt}/3): {exc}. "
                        f"Retrying in {wait}s ..."
                    )
                    time.sleep(wait)
                else:
                    print(
                        f"\n  ERROR: upsert to {table} failed after 3 attempts. "
                        f"Skipping {len(chunk)} rows — re-run with --resume to fill gaps."
                    )


def enrich_games(
    season_filter: Optional[int] = None,
    test_mode: bool = False,
    resume: bool = False,
    yes: bool = False,
) -> None:
    """
    Enrich games with advanced stats (BoxScoreAdvancedV3) and inactive player
    info (BoxScoreSummaryV2). Writes to:
      - player_game_conditions
      - team_game_stats
      - player_availability

    Args:
        season_filter: If set, only process games for that season int (2022/2023/2024).
        test_mode:     Process only TEST_GAME_LIMIT games (no confirmation prompt).
        resume:        Skip games that already have rows in player_game_conditions.
    """
    try:
        from nba_api.stats.endpoints import BoxScoreAdvancedV3, BoxScoreSummaryV2
    except ImportError as exc:
        print(f"ERROR: nba_api not installed: {exc}")
        sys.exit(1)

    # ESPN-discovered games carry provisional ESPN ext_ids until healed —
    # the advanced fetches below need nba-native ids.
    resolve_nba_ext_ids()

    team_map, player_map, game_map = _load_id_maps()
    stats_index = _load_player_stats_index(player_map)

    # Build ordered list of games to process
    # Only regular season (002) and playoffs (004/005) have advanced box score data.
    # Preseason (001) and All-Star (003) return empty responses.
    games_to_process = [
        (ext_id, info)
        for ext_id, info in game_map.items()
        if ext_id[:3] in ("002", "004", "005")
    ]

    if season_filter is not None:
        games_to_process = [
            (ext_id, info)
            for ext_id, info in games_to_process
            if info["season"] == season_filter
        ]
        print(f"Filtered to season {season_filter}: {len(games_to_process)} games")

    # Sort by game_date for deterministic order and correct days_rest calculation
    games_to_process.sort(key=lambda x: x[1]["game_date"] or "")

    if resume:
        already_done = _load_already_enriched()
        before = len(games_to_process)
        games_to_process = [
            (ext_id, info)
            for ext_id, info in games_to_process
            if ext_id not in already_done
        ]
        print(f"Resume mode: skipped {before - len(games_to_process)} already-enriched games.")

    if test_mode:
        games_to_process = games_to_process[:TEST_GAME_LIMIT]
        print(f"Test mode: processing {len(games_to_process)} games.")
    else:
        total_games = len(games_to_process)
        # Estimate: ~2 API calls per game * API_DELAY_SECONDS + breaks
        breaks = total_games // BREAK_EVERY_N_GAMES
        estimated_seconds = (
            total_games * 2 * API_DELAY_SECONDS
            + breaks * BREAK_DURATION_SECONDS
        )
        estimated_minutes = math.ceil(estimated_seconds / 60)
        print(
            f"\nAbout to enrich {total_games} games "
            f"(~{estimated_minutes} min estimated)."
        )
        if yes:
            print("Auto-confirmed via --yes.")
        else:
            confirm = input("Proceed? [y/N] ").strip().lower()
            if confirm != "y":
                print("Aborted.")
                return

    total = len(games_to_process)
    pgc_rows: list[dict] = []
    tgs_rows: list[dict] = []
    pa_rows: list[dict] = []

    for game_num, (ext_id, game_info) in enumerate(games_to_process, start=1):
        game_db_id = game_info["id"]
        game_date_str = game_info["game_date"]  # "YYYY-MM-DD"
        home_team_db_id = game_info["home_team_id"]
        away_team_db_id = game_info["away_team_id"]

        print(f"[{game_num}/{total}] Game {ext_id} ({game_date_str})", end=" ... ", flush=True)

        # Per-game pgc accumulator — lets us merge PlayerTrackV3 fields by p_ext_id
        # before extending the cross-game pgc_rows buffer.
        game_pgc_rows: list[dict] = []

        # ── BoxScoreAdvancedV3 ──────────────────────────────────────────
        # V2 was deprecated by stats.nba.com and returns empty responses.
        # V3 uses camelCase column names.
        def _adv(gid=ext_id):
            return BoxScoreAdvancedV3(game_id=gid)

        adv_result = api_call_with_retry(_adv, f"BoxScoreAdvancedV3 {ext_id}")

        if adv_result is not None:
            try:
                adv_frames = adv_result.get_data_frames()
                player_adv_df = adv_frames[0]  # PlayerStats
                team_adv_df = adv_frames[1]    # TeamStats

                # --- player_game_conditions rows ---
                for _, row in player_adv_df.iterrows():
                    p_ext_id = str(row.get("personId", "")).strip()
                    p_db_id = player_map.get(p_ext_id)
                    if not p_db_id:
                        continue  # player not in our DB

                    # Determine team membership from the advanced row
                    t_ext_id = str(row.get("teamId", "")).strip()
                    t_db_id = team_map.get(t_ext_id)

                    home_away = "home" if t_db_id == home_team_db_id else "away"
                    opponent_db_id = (
                        away_team_db_id if t_db_id == home_team_db_id else home_team_db_id
                    )

                    rest = _days_rest(p_db_id, game_date_str, stats_index)

                    mins = _parse_minutes(row.get("minutes"))
                    if not mins or mins <= 0:
                        continue  # skip DNPs — pace/usg meaningless without playing time
                    game_pgc_rows.append(
                        {
                            "player_id": p_db_id,
                            "_p_ext_id": p_ext_id,  # stripped before upsert; used to merge track data
                            "game_id": game_db_id,
                            "game_date": game_date_str,
                            "usg_pct": _safe_float(row.get("usagePercentage")),
                            "pace": _safe_float(row.get("pace")),
                            "off_rating": _safe_float(row.get("offensiveRating")),
                            "def_rating": _safe_float(row.get("defensiveRating")),
                            "home_away": home_away,
                            "days_rest": rest,
                            "opponent_team_id": opponent_db_id,
                            "minutes_played": mins,
                        }
                    )

                # --- team_game_stats rows ---
                for _, row in team_adv_df.iterrows():
                    t_ext_id = str(row.get("teamId", "")).strip()
                    t_db_id = team_map.get(t_ext_id)
                    if not t_db_id:
                        continue

                    tgs_rows.append(
                        {
                            "team_id": t_db_id,
                            "game_id": game_db_id,
                            "game_date": game_date_str,
                            "pace": _safe_float(row.get("pace")),
                            "off_rating": _safe_float(row.get("offensiveRating")),
                            "def_rating": _safe_float(row.get("defensiveRating")),
                        }
                    )

            except Exception as exc:
                print(f"\n  WARNING: could not parse BoxScoreAdvancedV3 for {ext_id}: {exc}")

        # ── BoxScorePlayerTrackV3 (touches/TOP/etc) ─────────────────────
        # Merges into the per-player pgc rows already built for this game.
        if game_pgc_rows:
            track_rows = fetch_player_track(ext_id)
            if track_rows is None:
                print(f"\n  WARNING: PlayerTrackV3 unavailable for {ext_id} — skipping touches/TOP")
            else:
                track_by_pext = {tr["player_ext_id"]: tr for tr in track_rows}
                for row in game_pgc_rows:
                    tr = track_by_pext.get(row["_p_ext_id"])
                    if tr:
                        row["touches"]             = tr["touches"]
                        row["front_court_touches"] = tr["front_court_touches"]
                        row["time_of_possession"]  = tr["time_of_possession"]
                        row["paint_touches"]       = tr["paint_touches"]
                        row["avg_speed"]           = tr["avg_speed"]

        # Strip the temporary merge key and flush into the cross-game buffer
        for row in game_pgc_rows:
            row.pop("_p_ext_id", None)
        pgc_rows.extend(game_pgc_rows)

        # ── BoxScoreSummaryV2 (inactive players) ────────────────────────
        def _summ(gid=ext_id):
            return BoxScoreSummaryV2(game_id=gid)

        summ_result = api_call_with_retry(_summ, f"BoxScoreSummaryV2 {ext_id}")

        if summ_result is not None:
            try:
                summ_frames = summ_result.get_data_frames()
                # InactivePlayers is dataset index 3 in BoxScoreSummaryV2
                # (0=GameSummary, 1=OtherStats, 2=Officials, 3=InactivePlayers)
                inactive_df = summ_frames[3]

                for _, row in inactive_df.iterrows():
                    p_ext_id = str(row.get("PLAYER_ID", "")).strip()
                    p_db_id = player_map.get(p_ext_id)
                    if not p_db_id:
                        continue
                    pa_rows.append(
                        {
                            "player_id": p_db_id,
                            "game_id": game_db_id,
                            "status": "inactive",
                        }
                    )
            except Exception as exc:
                print(f"\n  WARNING: could not parse BoxScoreSummaryV2 for {ext_id}: {exc}")

        print("OK")

        # Flush batches when they grow large enough
        if len(pgc_rows) >= BATCH_SIZE:
            _upsert_batch("player_game_conditions", pgc_rows, "player_id,game_id")
            pgc_rows = []
        if len(tgs_rows) >= BATCH_SIZE:
            _upsert_batch("team_game_stats", tgs_rows, "team_id,game_id")
            tgs_rows = []
        if len(pa_rows) >= BATCH_SIZE:
            _upsert_batch("player_availability", pa_rows, "player_id,game_id")
            pa_rows = []

        # Periodic break for rate limiting
        if game_num % BREAK_EVERY_N_GAMES == 0 and game_num < total:
            print(
                f"  -- Processed {game_num}/{total} games. "
                f"Pausing {BREAK_DURATION_SECONDS}s ..."
            )
            time.sleep(BREAK_DURATION_SECONDS)

    # Final flush of remaining rows
    if pgc_rows:
        _upsert_batch("player_game_conditions", pgc_rows, "player_id,game_id")
    if tgs_rows:
        _upsert_batch("team_game_stats", tgs_rows, "team_id,game_id")
    if pa_rows:
        _upsert_batch("player_availability", pa_rows, "player_id,game_id")

    print(f"\nGame enrichment complete. Processed {total} games.")


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


# ── 4. PLAYER TRACK BACKFILL ────────────────────────────────────────────────────

def backfill_track(seasons: list[str], limit: Optional[int] = None) -> None:
    """
    Backfill BoxScorePlayerTrackV3 for completed games in the given seasons.
    Skips games whose player_game_conditions rows already have touches set.

    Args:
        seasons: list of season strings, e.g. ["2023-24","2024-25","2025-26"]
        limit:   optional cap on games processed (per smoke-test runs)
    """
    from analytics.db.connection import season_str_to_int

    print(f"[backfill_track] seasons={seasons} limit={limit}")

    # Heal any ESPN-provisional ext_ids first — track fetches key on native ids.
    resolve_nba_ext_ids()

    # Map ext_id (NBA player id, str) -> db_id, for selective row updates
    player_rows = _fetch_all("players", "id,ext_id", [("eq", "league", "nba")])
    player_map = {r["ext_id"]: r["id"] for r in player_rows}
    print(f"  players loaded: {len(player_map)}")

    season_ints = [season_str_to_int(s) for s in seasons]

    # Load completed games for the target seasons. "Completed" = home_score IS NOT NULL.
    # _fetch_all paginates past PostgREST's default 1000-row cap.
    all_games: list[dict] = []
    for season_int in season_ints:
        season_games = _fetch_all(
            "games",
            "id,ext_id,game_date,season,home_score",
            [
                ("eq", "season", season_int),
                ("eq", "league_id", NBA_LEAGUE_ID),
            ],
        )
        season_games = [g for g in season_games if g.get("home_score") is not None]
        season_games.sort(key=lambda g: g["game_date"] or "")
        print(f"  season {season_int_to_str(season_int)}: {len(season_games)} completed games")
        all_games.extend(season_games)

    # Filter out preseason / All-Star (only 002/004/005 have track data)
    all_games = [g for g in all_games if g["ext_id"][:3] in ("002", "004", "005")]
    print(f"  regular+playoff games: {len(all_games)}")

    if limit:
        all_games = all_games[:limit]
        print(f"  limit applied: {len(all_games)} games")

    processed = 0
    updated = 0
    skipped = 0

    for i, game in enumerate(all_games, start=1):
        ext_id = game["ext_id"]
        game_db_id = game["id"]

        # Skip if any condition row for this game already has touches populated
        existing = (
            supabase.table("player_game_conditions")
            .select("id", count="exact")
            .eq("game_id", game_db_id)
            .not_.is_("touches", "null")
            .limit(1)
            .execute()
        )
        if (existing.count or 0) > 0:
            skipped += 1
            if i % 100 == 0:
                print(f"  [{i}/{len(all_games)}] skipped {ext_id} (already has touches)")
            continue

        track_rows = fetch_player_track(ext_id, backfill_mode=True)
        if track_rows is None:
            print(f"  [{i}/{len(all_games)}] {ext_id}: PlayerTrackV3 unavailable")
            continue

        # Update only the existing pgc rows for this game (do not insert new rows
        # — pgc rows come from BoxScoreAdvancedV3 enrichment which has stricter
        # column requirements like usg_pct/pace).
        game_updated = 0
        for tr in track_rows:
            p_db_id = player_map.get(tr["player_ext_id"])
            if not p_db_id:
                continue
            if all(tr[k] is None for k in ("touches", "front_court_touches", "time_of_possession", "paint_touches", "avg_speed")):
                continue
            try:
                res = (
                    supabase.table("player_game_conditions")
                    .update({
                        "touches":             tr["touches"],
                        "front_court_touches": tr["front_court_touches"],
                        "time_of_possession":  tr["time_of_possession"],
                        "paint_touches":       tr["paint_touches"],
                        "avg_speed":           tr["avg_speed"],
                    })
                    .eq("player_id", p_db_id)
                    .eq("game_id", game_db_id)
                    .execute()
                )
                if res.data:
                    game_updated += len(res.data)
            except Exception as exc:
                print(f"    WARNING: update failed for player={p_db_id} game={game_db_id}: {exc}")

        processed += 1
        updated += game_updated

        if i % 50 == 0 or i == len(all_games):
            print(
                f"  [{i}/{len(all_games)}] processed={processed} skipped={skipped} "
                f"row_updates={updated}"
            )

    print(f"[backfill_track] complete. processed={processed} skipped={skipped} row_updates={updated}")


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
        description="StatTrak game enrichment pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m analytics.data.enrich_games --positions
  python -m analytics.data.enrich_games --basic-stats
  python -m analytics.data.enrich_games --opp-defense
  python -m analytics.data.enrich_games --test
  python -m analytics.data.enrich_games --season 2024
  python -m analytics.data.enrich_games --resume
  python -m analytics.data.enrich_games
        """,
    )
    parser.add_argument(
        "--positions",
        action="store_true",
        help="Run position backfill only (CommonTeamRoster)",
    )
    parser.add_argument(
        "--basic-stats",
        action="store_true",
        dest="basic_stats",
        help="Run basic stats gap fill only (ESPN summaries, any season with gaps)",
    )
    parser.add_argument(
        "--opp-defense",
        action="store_true",
        dest="opp_defense",
        help="Compute opponent-position-defense rankings (populates opponent_position_defense table)",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help=f"Process only {TEST_GAME_LIMIT} games (no confirmation prompt)",
    )
    parser.add_argument(
        "--season",
        type=int,
        choices=SEASON_INTS,
        metavar="{" + ",".join(str(s) for s in SEASON_INTS) + "}",
        help="Filter to a single season (e.g. 2024)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip games that have already been enriched",
    )
    parser.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Skip confirmation prompt (useful for unattended runs)",
    )
    parser.add_argument(
        "--backfill-track",
        action="store_true",
        dest="backfill_track",
        help="Backfill BoxScorePlayerTrackV3 only (touches/TOP/etc) across the season window. "
             "Uses speed-tuned retry: fast retry first, full cooldown on second consecutive fail.",
    )
    parser.add_argument(
        "--seasons",
        type=str,
        default=None,
        help="Comma-separated list of seasons (e.g. '2023-24,2024-25,2025-26'). "
             "Required with --backfill-track.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap on games processed (smoke-tests; works with --backfill-track).",
    )

    args = parser.parse_args()

    if args.positions:
        backfill_positions()
        return 0

    if args.basic_stats:
        backfill_basic_stats(
            season_filter=args.season,
            test_mode=args.test,
            resume=args.resume,
            yes=args.yes,
        )
        return 0

    if args.opp_defense:
        backfill_opp_defense()
        return 0

    if args.backfill_track:
        if not args.seasons:
            print("ERROR: --backfill-track requires --seasons (e.g. --seasons 2023-24,2024-25)")
            return 1
        seasons = [s.strip() for s in args.seasons.split(",") if s.strip()]
        backfill_track(seasons, limit=args.limit)
        return 0

    # Default: full game enrichment
    enrich_games(
        season_filter=args.season,
        test_mode=args.test,
        resume=args.resume,
        yes=args.yes,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
