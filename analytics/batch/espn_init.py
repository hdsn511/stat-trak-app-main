"""
analytics/batch/espn_init.py

Shared engine for the ESPN-backed league init/backfill pipelines (NFL, NHL).
The thin CLI entry points — analytics/batch/nfl_init.py and nhl_init.py —
declare a LeagueSpec and delegate here.

Pipeline shape mirrors the MLB init/backfill path:
  seed_teams   -> upsert into shared `teams`   (league_id + ESPN native ext_id)
  seed_players -> upsert into shared `players` (current rosters, is_active=True)
  ingest_date_range -> per date: scoreboard -> upsert `games` (finals only)
                       -> summary per game -> upsert {league}_player_stats
                       (self-healing unknown players, idempotent upserts,
                        per-date resilience, --resume checkpoint by date)

Only STATUS_FINAL games are ingested; preseason (ESPN season.type 1) is
skipped. `games.game_type` is a generated column keyed to NBA/MLB conventions
and yields 'other' for ESPN NFL/NHL event ids — season phase can be derived
from game_date when needed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Callable, Optional

from analytics.db.connection import BATCH_SIZE, supabase
from analytics.data.espn import client as espn

# ESPN season.type codes worth ingesting (1=preseason, 2=regular, 3=postseason).
INGEST_SEASON_TYPES = {2, 3}
STAT_ROW_META_KEYS = {"player_ext_id", "player_name", "player_position", "team_ext_id"}


@dataclass(frozen=True)
class LeagueSpec:
    """Everything league-specific the shared engine needs."""
    code: str                                  # 'nfl' / 'nhl' (players.league value)
    sport: str                                 # ESPN sport path segment
    league: str                                # ESPN league path segment
    league_id: int                             # leagues.id in the local DB
    stats_table: str                           # 'nfl_player_stats' / 'nhl_player_stats'
    parse_summary: Callable[[dict, str], list[dict]]
    season_ranges: dict[int, tuple[str, str]]  # season int -> (start, end) YYYY-MM-DD
    season_from_espn_year: Callable[[int], int]  # ESPN season.year -> our season int


def _chunked(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _date_str(d: date) -> str:
    return d.strftime("%Y-%m-%d")


# ── Teams ──────────────────────────────────────────────────────────────────────

def seed_teams(spec: LeagueSpec) -> dict[str, int]:
    """Upsert all league teams. Returns ext_id -> db_id map."""
    teams = espn.get_teams(spec.sport, spec.league)
    print(f"[teams] fetched {len(teams)} {spec.code.upper()} teams")
    if not teams:
        print(f"  ERROR [teams] ESPN returned no {spec.code.upper()} teams; aborting seed.")
        return {}
    rows = [{
        "league_id": spec.league_id,
        "ext_id": str(t["id"]),
        "name": t.get("displayName") or t.get("name", ""),
        "abbreviation": t.get("abbreviation", "").upper(),
        "city": t.get("location"),
    } for t in teams]

    for chunk in _chunked(rows, BATCH_SIZE):
        supabase.table("teams").upsert(chunk, on_conflict="league_id,ext_id").execute()
    print(f"[teams] upserted {len(rows)} rows")
    return _team_map(spec)


def _team_map(spec: LeagueSpec) -> dict[str, int]:
    db = (supabase.table("teams").select("id,ext_id")
          .eq("league_id", spec.league_id).execute())
    return {r["ext_id"]: r["id"] for r in (db.data or [])}


def _team_abbr_map(spec: LeagueSpec) -> dict[str, str]:
    db = (supabase.table("teams").select("ext_id,abbreviation")
          .eq("league_id", spec.league_id).execute())
    return {r["ext_id"]: r["abbreviation"] for r in (db.data or [])}


# ── Players ────────────────────────────────────────────────────────────────────

def seed_players(spec: LeagueSpec) -> int:
    """Upsert current-roster players for every team (ESPN rosters are
    current-state only). Seeds teams first if none are in the DB yet."""
    abbr_by_ext = _team_abbr_map(spec)
    if not abbr_by_ext:
        print(f"[players] no {spec.code.upper()} teams in DB; seeding teams first.")
        seed_teams(spec)
        abbr_by_ext = _team_abbr_map(spec)

    rows: list[dict] = []
    for ext_id, abbr in sorted(abbr_by_ext.items()):
        roster = espn.get_roster(spec.sport, spec.league, ext_id)
        if not roster:
            print(f"  WARNING [players] empty roster for team {abbr} ({ext_id})")
            continue
        for p in roster:
            pid = p.get("id")
            if not pid:
                print(f"  WARNING [players] roster entry without id on {abbr}; skipped.")
                continue
            rows.append({
                "league_id": spec.league_id,
                "league": spec.code,
                "ext_id": str(pid),
                "name": p.get("fullName") or p.get("displayName", f"Player {pid}"),
                "team": abbr,
                "position": (p.get("position", {}) or {}).get("abbreviation"),
                "is_active": True,
            })
    print(f"[players] collected {len(rows)} roster entries "
          f"across {len(abbr_by_ext)} teams")

    # Dedupe by ext_id — a recently traded player can appear on two rosters
    # (last occurrence wins), and Postgres upsert rejects in-batch duplicates.
    deduped = {r["ext_id"]: r for r in rows}
    if len(deduped) < len(rows):
        print(f"[players] deduped {len(rows) - len(deduped)} duplicate roster "
              f"entr(ies) across teams.")
    rows = list(deduped.values())

    for chunk in _chunked(rows, BATCH_SIZE):
        supabase.table("players").upsert(chunk, on_conflict="league_id,ext_id").execute()
    print(f"[players] upserted {len(rows)} rows")
    return len(rows)


def _player_map(spec: LeagueSpec) -> dict[str, int]:
    """League player ext_id -> db_id, paginated (PostgREST caps at 1000 rows)."""
    out: dict[str, int] = {}
    page = 0
    while True:
        batch = (supabase.table("players").select("id,ext_id")
                 .eq("league_id", spec.league_id)
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        out.update({r["ext_id"]: r["id"] for r in batch})
        if len(batch) < 1000:
            break
        page += 1
    return out


def _self_heal_players(spec: LeagueSpec, stat_rows: list[dict],
                       player_map: dict[str, int],
                       abbr_by_ext: dict[str, str]) -> None:
    """Insert boxscore players missing from `players` (traded/retired/practice
    squad — anyone not on a current roster). Marked is_active=False. Updates
    player_map in place."""
    unknown = {r["player_ext_id"]: r for r in stat_rows
               if r["player_ext_id"] not in player_map}
    if not unknown:
        return
    rows = [{
        "league_id": spec.league_id,
        "league": spec.code,
        "ext_id": ext_id,
        "name": r["player_name"],
        "team": abbr_by_ext.get(r["team_ext_id"]),
        "position": r.get("player_position"),
        "is_active": False,
    } for ext_id, r in unknown.items()]
    for chunk in _chunked(rows, BATCH_SIZE):
        supabase.table("players").upsert(chunk, on_conflict="league_id,ext_id").execute()
    player_map.update(_player_map(spec))
    print(f"  Self-healed {len(rows)} boxscore player(s) not on a current roster.")


# ── Games + stats ingestion ────────────────────────────────────────────────────

def _ingest_date(spec: LeagueSpec, day: date, team_map: dict[str, int],
                 abbr_by_ext: dict[str, str], player_map: dict[str, int]) -> tuple[int, int]:
    """Ingest all final games for one date. Returns (games, stat_rows) written."""
    date_str = _date_str(day)
    events = espn.get_scoreboard(spec.sport, spec.league, day.strftime("%Y%m%d"))
    finals: list[dict] = []
    for ev in events:
        comp = (ev.get("competitions") or [{}])[0]
        status = comp.get("status", {}).get("type", {})
        season_type = (ev.get("season") or {}).get("type")
        if season_type not in INGEST_SEASON_TYPES:
            print(f"  note [{spec.code} {date_str}] event {ev.get('id')} "
                  f"season.type={season_type} (pre/other); skipped.")
            continue
        if not status.get("completed") or status.get("name") != "STATUS_FINAL":
            print(f"  note [{spec.code} {date_str}] event {ev.get('id')} "
                  f"status={status.get('name')}; not final, skipped.")
            continue
        finals.append(ev)
    if not finals:
        return 0, 0

    # ── Upsert games
    game_rows: list[dict] = []
    for ev in finals:
        comp = ev["competitions"][0]
        sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
        home, away = sides.get("home", {}), sides.get("away", {})
        home_db = team_map.get(str(home.get("team", {}).get("id")))
        away_db = team_map.get(str(away.get("team", {}).get("id")))
        if not home_db or not away_db:
            print(f"  WARNING [{spec.code} {date_str}] event {ev['id']} has "
                  f"unknown team(s) (all-star/exhibition?); skipped.")
            continue
        espn_year = (ev.get("season") or {}).get("year")
        game_rows.append({
            "league_id": spec.league_id,
            "ext_id": str(ev["id"]),
            "game_date": date_str,
            "home_team_id": home_db,
            "away_team_id": away_db,
            "season": spec.season_from_espn_year(espn_year) if espn_year else day.year,
            "status": 2,  # final
            "home_score": int(home.get("score", 0)),
            "away_score": int(away.get("score", 0)),
            "game_time": ev.get("date"),
        })
    if not game_rows:
        return 0, 0
    for chunk in _chunked(game_rows, BATCH_SIZE):
        supabase.table("games").upsert(chunk, on_conflict="league_id,ext_id").execute()
    db_games = (supabase.table("games").select("id,ext_id")
                .eq("league_id", spec.league_id).eq("game_date", date_str)
                .execute()).data or []
    game_db_id = {g["ext_id"]: g["id"] for g in db_games}

    # ── Fetch + parse each summary
    stat_buffer: list[dict] = []
    for g in game_rows:
        ext_id = g["ext_id"]
        summary = espn.get_summary(spec.sport, spec.league, ext_id)
        if not summary:
            print(f"  ERROR [{spec.code} {date_str}] no summary for event "
                  f"{ext_id}; stats skipped for this game.")
            continue
        parsed = spec.parse_summary(summary, ext_id)
        if not parsed:
            print(f"  WARNING [{spec.code} {date_str}] event {ext_id} parsed "
                  f"to zero stat rows.")
            continue
        _self_heal_players(spec, parsed, player_map, abbr_by_ext)
        for r in parsed:
            p_db = player_map.get(r["player_ext_id"])
            if not p_db:
                print(f"  WARNING [{spec.code} {date_str}] player "
                      f"{r['player_name']} ({r['player_ext_id']}) unresolvable "
                      f"after self-heal; row dropped.")
                continue
            row = {k: v for k, v in r.items() if k not in STAT_ROW_META_KEYS}
            row.update({
                "game_id": game_db_id[ext_id],
                "player_id": p_db,
                "team_id": team_map.get(r["team_ext_id"]),
                "game_date": date_str,
            })
            stat_buffer.append(row)

    for chunk in _chunked(stat_buffer, BATCH_SIZE):
        supabase.table(spec.stats_table).upsert(
            chunk, on_conflict="game_id,player_id").execute()
    print(f"  {date_str}: {len(game_rows)} final game(s), "
          f"{len(stat_buffer)} stat rows.")
    return len(game_rows), len(stat_buffer)


def ingest_date_range(spec: LeagueSpec, start: date, end: date,
                      resume: bool = False) -> None:
    """Ingest every date in [start, end]. With resume=True, restart from the
    latest game_date already in the stats table within the window (that date
    is re-fetched — upserts make it idempotent)."""
    if resume:
        latest = (supabase.table(spec.stats_table).select("game_date")
                  .gte("game_date", _date_str(start)).lte("game_date", _date_str(end))
                  .order("game_date", desc=True).limit(1).execute()).data
        if latest:
            start = datetime.strptime(latest[0]["game_date"], "%Y-%m-%d").date()
            print(f"[resume] stats present through {latest[0]['game_date']}; "
                  f"restarting from that date (idempotent re-fetch).")

    team_map = _team_map(spec)
    if not team_map:
        print(f"  ERROR [{spec.code}] no teams in DB — run --teams first.")
        return
    abbr_by_ext = _team_abbr_map(spec)
    player_map = _player_map(spec)  # kept fresh in place by _self_heal_players

    print(f"[ingest] {spec.code.upper()} {_date_str(start)} .. {_date_str(end)}")
    total_games = total_stats = 0
    cur = start
    while cur <= end:
        # Per-date resilience: one bad date must not abort a season run.
        for attempt in (1, 2):
            try:
                n_g, n_s = _ingest_date(spec, cur, team_map, abbr_by_ext, player_map)
                total_games += n_g
                total_stats += n_s
                break
            except Exception as exc:
                print(f"  WARN: {_date_str(cur)} failed (attempt {attempt}/2): {exc}")
                if attempt == 2:
                    print(f"  ERROR: giving up on {_date_str(cur)}; continuing.")
        cur += timedelta(days=1)
    print(f"[ingest] done: {total_games} game(s), {total_stats} stat row(s).")


# ── CLI runner shared by nfl_init / nhl_init ───────────────────────────────────

def run_cli(spec: LeagueSpec, args, default_season: int) -> int:
    """Execute the standard init CLI (--teams / --rosters / date-range ingest).

    Ingestion runs when a date range is implied: explicit --season,
    --start-date/--end-date, --resume, or no seeding flags at all.
    `--teams`/`--rosters` alone only seed."""
    season = args.season if args.season is not None else default_season
    print("=" * 60)
    print(f"{spec.code.upper()} Init (ESPN)  |  season {season}")
    print("=" * 60)

    if args.teams:
        seed_teams(spec)
    if args.rosters:
        seed_players(spec)

    start_s, end_s = spec.season_ranges.get(season, (None, None))
    if args.start_date:
        start_s = args.start_date
    if args.end_date:
        end_s = args.end_date

    wants_ingest = bool(args.start_date or args.end_date or args.resume
                        or args.season is not None
                        or not (args.teams or args.rosters))
    if wants_ingest:
        if not start_s or not end_s:
            print(f"ERROR: no date range — season {season} has no known "
                  f"range and no --start-date/--end-date given.")
            return 1
        ingest_date_range(
            spec,
            datetime.strptime(start_s, "%Y-%m-%d").date(),
            datetime.strptime(end_s, "%Y-%m-%d").date(),
            resume=args.resume,
        )

    print("=" * 60)
    print("Done.")
    return 0


def build_arg_parser(description: str, default_season: int):
    import argparse
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--teams", action="store_true", help="seed teams")
    parser.add_argument("--rosters", action="store_true",
                        help="seed players from current rosters")
    parser.add_argument("--season", type=int, default=None,
                        help=f"season start year, resolves the date range "
                             f"(default {default_season})")
    parser.add_argument("--start-date", type=str, default=None, dest="start_date")
    parser.add_argument("--end-date", type=str, default=None, dest="end_date")
    parser.add_argument("--resume", action="store_true",
                        help="restart from the latest ingested stats date")
    return parser
