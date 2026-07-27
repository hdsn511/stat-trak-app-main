"""
analytics/batch/mlb_nightly.py

Nightly batch for MLB — the MLB analog of analytics/batch/nightly.py.

Steps (same shape as the NBA pipeline):
  0.   reconcile_picks(yesterday)     -- fill actual_result / did_hit on MLB pick_results
  0.5  backfill_completed_games(up_to)-- fetch missed dates' box scores -> mlb_player_stats
  1.   get_slate(target_date)         -- schedule -> games (league_id=2) + probable starters
  2+3. compute_daily_conditions()     -- rolling stats + matchup conditions -> mlb_daily_conditions

Because statsapi.mlb.com is not IP-blocked, this runs cleanly on GitHub-hosted
runners with no proxy / cooldown ladder.

CLI:
    python -m analytics.batch.mlb_nightly --date 2026-06-11
    python -m analytics.batch.mlb_nightly --today
    python -m analytics.batch.mlb_nightly --reconcile-only --date 2026-06-11
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timedelta
from typing import Optional

from analytics.db.connection import (
    BATCH_SIZE,
    MLB_LEAGUE_ID,
    MLB_STAT_COLUMN_MAP,
    mlb_season_for_date,
    mlb_value_cols,
    supabase,
)
from analytics.data.mlb import client as mlb

ROLLING_WINDOW = 5
BATTING_ORDER_SLOT_LOOKBACK = 10  # games used to project today's lineup slot
REFETCH_WINDOW_DAYS = 3  # trailing days of box scores to re-fetch (complete partials)
MIN_TEAM_BOX_ROWS = 9    # a complete team box score has >= a full batting lineup


# ── Helpers ────────────────────────────────────────────────────────────────────

def _date_str(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def _safe_avg(values: list) -> Optional[float]:
    clean = [v for v in values if v is not None]
    return (sum(clean) / len(clean)) if clean else None


def _si(val, default=None):
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _team_maps() -> tuple[dict[str, int], dict[int, str], dict[int, str]]:
    """ext_id->db_id, db_id->abbr, abbr->db_id (all MLB)."""
    rows = (supabase.table("teams").select("id,ext_id,abbreviation")
            .eq("league_id", MLB_LEAGUE_ID).execute()).data or []
    ext_to_id = {r["ext_id"]: r["id"] for r in rows}
    id_to_abbr = {r["id"]: r["abbreviation"] for r in rows}
    abbr_to_id = {r["abbreviation"]: r["id"] for r in rows}
    return ext_to_id, id_to_abbr, abbr_to_id


def _all_mlb_players(cols: str) -> list[dict]:
    """Every MLB players row for the given columns, paginated. PostgREST caps a
    single response at 1000 rows; the MLB players table is ~2k, so an unpaginated
    fetch silently dropped ~half — which made box-score ingestion skip the players
    not in the (truncated) map. Always paginate full-table player lookups."""
    out: list[dict] = []
    page = 0
    while True:
        batch = (supabase.table("players").select(cols)
                 .eq("league_id", MLB_LEAGUE_ID)
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        out.extend(batch)
        if len(batch) < 1000:
            break
        page += 1
    return out


def _player_map() -> dict[str, int]:
    """MLB player ext_id -> db_id."""
    return {r["ext_id"]: r["id"] for r in _all_mlb_players("id,ext_id")}


def _player_throw_hand() -> dict[int, Optional[str]]:
    return {r["id"]: r.get("throw_hand") for r in _all_mlb_players("id,throw_hand")}


# ── Box score ingestion ────────────────────────────────────────────────────────

def _parse_box_player(p: dict) -> Optional[dict]:
    """Extract the batting + pitching line for one boxscore player entry."""
    bat = (p.get("stats", {}) or {}).get("batting", {}) or {}
    pit = (p.get("stats", {}) or {}).get("pitching", {}) or {}
    played_bat = bat.get("plateAppearances") not in (None, 0) or bat.get("atBats") not in (None, 0)
    pitched = (pit.get("battersFaced") or 0) > 0 or (pit.get("outs") or 0) > 0
    if not played_bat and not pitched:
        return None
    return {
        "person_id": p["person"]["id"],
        "slot": mlb.batting_order_slot(p.get("battingOrder")),
        # batting
        "at_bats": _si(bat.get("atBats"), 0), "hits": _si(bat.get("hits"), 0),
        "doubles": _si(bat.get("doubles"), 0), "triples": _si(bat.get("triples"), 0),
        "home_runs": _si(bat.get("homeRuns"), 0), "rbi": _si(bat.get("rbi"), 0),
        "runs": _si(bat.get("runs"), 0), "walks": _si(bat.get("baseOnBalls"), 0),
        "strikeouts": _si(bat.get("strikeOuts"), 0),
        "stolen_bases": _si(bat.get("stolenBases"), 0),
        "total_bases": _si(bat.get("totalBases"), 0),
        "hit_by_pitch": _si(bat.get("hitByPitch"), 0),
        "plate_appearances": _si(bat.get("plateAppearances"), 0),
        # pitching
        "outs_pitched": _si(pit.get("outs")), "earned_runs": _si(pit.get("earnedRuns")),
        "strikeouts_pitched": _si(pit.get("strikeOuts")),
        "walks_allowed": _si(pit.get("baseOnBalls")), "hits_allowed": _si(pit.get("hits")),
        "home_runs_allowed": _si(pit.get("homeRuns")),
        "batters_faced": _si(pit.get("battersFaced")),
        "games_started": _si(pit.get("gamesStarted"), 0) or 0,
    }


def _self_heal_players(person_ids: set[int], team_by_person: dict[int, int],
                       player_map: dict[str, int], throw_hand: dict[int, Optional[str]]) -> None:
    """Insert any boxscore person ids not already in players (historical players
    not on a current active roster). Marked is_active=False with handedness, so
    backfill of past seasons captures retired/traded players. Updates the maps
    in place."""
    unknown = [pid for pid in person_ids if str(pid) not in player_map]
    if not unknown:
        return
    # team abbr lookup for the players.team column
    _, id_to_abbr, _ = _team_maps()
    rows: list[dict] = []
    for i in range(0, len(unknown), 100):
        chunk = unknown[i:i + 100]
        for p in mlb.get_people(chunk):
            pid = p["id"]
            rows.append({
                "league_id": MLB_LEAGUE_ID, "league": "mlb", "ext_id": str(pid),
                "name": p.get("fullName", f"Player {pid}"),
                "team": id_to_abbr.get(team_by_person.get(pid)),
                "position": (p.get("primaryPosition", {}) or {}).get("abbreviation"),
                "is_active": False,
                "bat_hand": (p.get("batSide", {}) or {}).get("code"),
                "throw_hand": (p.get("pitchHand", {}) or {}).get("code"),
            })
    if rows:
        for i in range(0, len(rows), BATCH_SIZE):
            supabase.table("players").upsert(rows[i:i + BATCH_SIZE], on_conflict="league_id,ext_id").execute()
        # refresh maps so the just-inserted players resolve below
        fresh = _player_map()
        player_map.update(fresh)
        throw_hand.update(_player_throw_hand())
        print(f"  Self-healed {len(rows)} historical player(s).")


def _fetch_and_insert_box_scores(game_rows: list[dict]) -> int:
    """For each {id, ext_id, game_date, home_team_id, away_team_id} game, fetch
    the boxscore and upsert mlb_player_stats + mlb_player_game_conditions.

    Returns the number of stat rows written."""
    if not game_rows:
        return 0
    player_map = _player_map()
    _, _, _ = _team_maps()
    throw_hand = _player_throw_hand()

    stat_buffer: list[dict] = []
    cond_buffer: list[dict] = []
    score_updates: dict[int, dict] = {}

    # ── Pass 1: fetch + parse all boxscores, collect (person -> team) for self-heal
    game_data: list[dict] = []
    all_person_ids: set[int] = set()
    team_by_person: dict[int, int] = {}
    for g in game_rows:
        game_pk = g["ext_id"]
        game_db_id = g["id"]
        date_str = g["game_date"]
        home_db, away_db = g["home_team_id"], g["away_team_id"]

        teams = mlb.get_boxscore(int(game_pk))
        if not teams:
            print(f"  WARNING: no boxscore for gamePk {game_pk}")
            continue

        side_meta: dict[str, dict] = {}
        for side in ("home", "away"):
            t = teams.get(side, {})
            team_db = home_db if side == "home" else away_db
            opp_db = away_db if side == "home" else home_db
            parsed = [pp for pp in (_parse_box_player(p) for p in t.get("players", {}).values()) if pp]
            starter = next((pp["person_id"] for pp in parsed
                            if pp["games_started"] == 1 and pp["batters_faced"]), None)
            for pp in parsed:
                all_person_ids.add(pp["person_id"])
                team_by_person.setdefault(pp["person_id"], team_db)
            side_meta[side] = {
                "team_db": team_db, "opp_db": opp_db, "parsed": parsed,
                "home_away": side, "starter_ext": starter,
                "runs": sum(pp["runs"] for pp in parsed),
            }
        game_data.append({"game_db_id": game_db_id, "date_str": date_str, "side_meta": side_meta})
        # Only record a score when the game was actually played (has box-score
        # players). Scheduled/unplayed games would otherwise be written 0-0,
        # making them look complete.
        if side_meta["home"]["parsed"] or side_meta["away"]["parsed"]:
            upd = {
                "home_score": side_meta["home"]["runs"],
                "away_score": side_meta["away"]["runs"],
            }
            # A played, past-dated game is final — flip status so logic keyed on
            # status=2 (health, slate eligibility) sees it. get_slate only sets
            # status at schedule time (often still 'scheduled'/'live'); re-fetched
            # past games never got corrected. Guard on date to avoid marking an
            # in-progress game final.
            if date_str < _date_str(date.today()):
                upd["status"] = 2
            score_updates[game_db_id] = upd

    # ── Self-heal any historical players not on a current roster
    _self_heal_players(all_person_ids, team_by_person, player_map, throw_hand)

    # ── Pass 2: build buffers (all players now resolvable)
    for gd in game_data:
        game_db_id = gd["game_db_id"]
        date_str = gd["date_str"]
        side_meta = gd["side_meta"]
        for side, meta in side_meta.items():
            opp_starter_ext = side_meta["away" if side == "home" else "home"]["starter_ext"]
            opp_starter_db = player_map.get(str(opp_starter_ext)) if opp_starter_ext else None
            opp_starter_hand = throw_hand.get(opp_starter_db) if opp_starter_db else None
            for pp in meta["parsed"]:
                p_db = player_map.get(str(pp["person_id"]))
                if not p_db:
                    continue  # unseen player; nightly self-heal could add later
                stat_buffer.append({
                    "game_id": game_db_id, "player_id": p_db, "team_id": meta["team_db"],
                    "game_date": date_str,
                    "at_bats": pp["at_bats"], "hits": pp["hits"], "doubles": pp["doubles"],
                    "triples": pp["triples"], "home_runs": pp["home_runs"], "rbi": pp["rbi"],
                    "runs": pp["runs"], "walks": pp["walks"], "strikeouts": pp["strikeouts"],
                    "stolen_bases": pp["stolen_bases"], "total_bases": pp["total_bases"],
                    "hit_by_pitch": pp["hit_by_pitch"], "plate_appearances": pp["plate_appearances"],
                    "outs_pitched": pp["outs_pitched"], "earned_runs": pp["earned_runs"],
                    "strikeouts_pitched": pp["strikeouts_pitched"], "walks_allowed": pp["walks_allowed"],
                    "hits_allowed": pp["hits_allowed"], "home_runs_allowed": pp["home_runs_allowed"],
                    "batters_faced": pp["batters_faced"],
                })
                cond_buffer.append({
                    "player_id": p_db, "game_id": game_db_id, "game_date": date_str,
                    "home_away": meta["home_away"], "opponent_team_id": meta["opp_db"],
                    "batting_order_slot": pp["slot"], "plate_appearances": pp["plate_appearances"],
                    "opp_starter_id": opp_starter_db, "opp_starter_hand": opp_starter_hand,
                })

    if stat_buffer:
        for i in range(0, len(stat_buffer), BATCH_SIZE):
            supabase.table("mlb_player_stats").upsert(
                stat_buffer[i:i + BATCH_SIZE], on_conflict="game_id,player_id").execute()
    if cond_buffer:
        for i in range(0, len(cond_buffer), BATCH_SIZE):
            supabase.table("mlb_player_game_conditions").upsert(
                cond_buffer[i:i + BATCH_SIZE], on_conflict="player_id,game_id").execute()
    for gid, scores in score_updates.items():
        supabase.table("games").update(scores).eq("id", gid).execute()

    print(f"  Inserted {len(stat_buffer)} stat rows, {len(cond_buffer)} condition rows "
          f"across {len(game_rows)} game(s).")
    return len(stat_buffer)


# ── Step 1: slate ──────────────────────────────────────────────────────────────

def get_slate(target_date: date) -> tuple[list[dict], dict[int, dict]]:
    """Return (games, probables). games = rows from the `games` table for the
    date (league_id=2). probables = {game_db_id: {'home': starter_ext, 'away': ...}}."""
    date_str = _date_str(target_date)
    ext_to_id, _, _ = _team_maps()
    season = mlb_season_for_date(date_str)

    sched = mlb.get_schedule(date_str)
    print(f"[Step 1] schedule {date_str}: {len(sched)} game(s)")

    games_to_insert: list[dict] = []
    probable_by_pk: dict[str, dict] = {}
    for g in sched:
        gtype = mlb.GAME_TYPE_MAP.get(g.get("gameType", "R"), "regular")
        if gtype in ("spring", "exhibition", "allstar"):
            continue
        pk = str(g["gamePk"])
        home = g["teams"]["home"]["team"]
        away = g["teams"]["away"]["team"]
        home_db = ext_to_id.get(str(home["id"]))
        away_db = ext_to_id.get(str(away["id"]))
        if not home_db or not away_db:
            print(f"  WARNING: unknown team ext home={home['id']} away={away['id']}")
            continue
        status_state = g.get("status", {}).get("abstractGameState", "")
        status_code = 2 if status_state == "Final" else (1 if status_state == "Live" else 0)
        # game_type is a generated column (league-aware) — do not insert it.
        # gameDate is the ISO-8601 UTC first-pitch time; pick generation uses it
        # to skip games that have already started (see generate_mlb live gate).
        games_to_insert.append({
            "ext_id": pk, "league_id": MLB_LEAGUE_ID,
            "game_date": g.get("_official_date", date_str),
            "home_team_id": home_db, "away_team_id": away_db,
            "season": season, "status": status_code,
            "game_time": g.get("gameDate"),
        })
        probable_by_pk[pk] = {
            "home": (g["teams"]["home"].get("probablePitcher") or {}).get("id"),
            "away": (g["teams"]["away"].get("probablePitcher") or {}).get("id"),
        }

    if games_to_insert:
        for i in range(0, len(games_to_insert), BATCH_SIZE):
            supabase.table("games").upsert(
                games_to_insert[i:i + BATCH_SIZE], on_conflict="league_id,ext_id").execute()

    db_games = (supabase.table("games")
                .select("id,ext_id,home_team_id,away_team_id,game_date")
                .eq("game_date", date_str).eq("league_id", MLB_LEAGUE_ID).execute()).data or []
    probables = {row["id"]: probable_by_pk.get(row["ext_id"], {}) for row in db_games}
    print(f"  Slate: {len(db_games)} game(s) in DB for {date_str}")
    return db_games, probables


# ── Step 0.5: backfill ─────────────────────────────────────────────────────────

def backfill_completed_games(up_to: date, start_override: Optional[date] = None) -> None:
    """Fetch box scores for every date from the last stored stat date+1 (or
    start_override) up to up_to (exclusive). Box-score only — no daily_conditions,
    so this is fast (~one schedule + N boxscore calls per date) and is the
    initial-history seed path when start_override is given."""
    if start_override is not None:
        start = start_override
    else:
        latest = (supabase.table("mlb_player_stats").select("game_date")
                  .lt("game_date", _date_str(up_to))
                  .order("game_date", desc=True).limit(1).execute()).data
        if not latest:
            print("[Step 0.5] No prior MLB stats. Skipping backfill (seed history separately).")
            return
        start = datetime.strptime(latest[0]["game_date"], "%Y-%m-%d").date() + timedelta(days=1)
    if start >= up_to:
        print(f"[Step 0.5] MLB stats current through {latest[0]['game_date']}.")
        return
    print(f"[Step 0.5] Backfilling {_date_str(start)}..{_date_str(up_to - timedelta(days=1))}")
    cur = start
    while cur < up_to:
        # Per-date resilience: a transient Supabase/API timeout on one date must
        # not abort the whole multi-season run. Retry once, then skip the date.
        for attempt in (1, 2):
            try:
                games, _ = get_slate(cur)
                if games:
                    _fetch_and_insert_box_scores(games)
                break
            except Exception as exc:
                print(f"  WARN: {_date_str(cur)} failed (attempt {attempt}/2): {exc}")
                time.sleep(5)
        cur += timedelta(days=1)


# ── Steps 2+3: daily conditions ────────────────────────────────────────────────

def compute_daily_conditions(games: list[dict], probables: dict[int, dict],
                             target_date: date) -> None:
    if not games:
        print("[Steps 2+3] No games; skipping daily_conditions.")
        return
    date_str = _date_str(target_date)
    _, id_to_abbr, abbr_to_id = _team_maps()
    player_map = _player_map()
    throw_hand = _player_throw_hand()

    # team -> game + opponent + home/away
    team_game: dict[int, dict] = {}
    for g in games:
        team_game[g["home_team_id"]] = {"game_id": g["id"], "opp": g["away_team_id"], "home_away": "home"}
        team_game[g["away_team_id"]] = {"game_id": g["id"], "opp": g["home_team_id"], "home_away": "away"}
    playing_abbrs = {id_to_abbr[t] for t in team_game if t in id_to_abbr}

    # probable starter (ext id) per team for today
    starter_ext_by_team: dict[int, Optional[int]] = {}
    for g in games:
        pr = probables.get(g["id"], {})
        starter_ext_by_team[g["home_team_id"]] = pr.get("home")
        starter_ext_by_team[g["away_team_id"]] = pr.get("away")

    players = (supabase.table("players").select("id,name,team,position")
               .eq("league_id", MLB_LEAGUE_ID).eq("is_active", True)
               .in_("team", list(playing_abbrs)).execute()).data or []
    print(f"[Steps 2+3] {len(players)} players on today's teams")

    rows: list[dict] = []
    for pl in players:
        p_db = pl["id"]
        team_db = abbr_to_id.get(pl.get("team") or "")
        if not team_db or team_db not in team_game:
            continue
        tg = team_game[team_db]
        opp_db = tg["opp"]

        # rolling batting + pitching over last N games before today
        recent = (supabase.table("mlb_player_stats")
                  .select("game_date,hits,total_bases,rbi,runs,home_runs,plate_appearances,"
                          "strikeouts_pitched,outs_pitched")
                  .eq("player_id", p_db).lt("game_date", date_str)
                  .order("game_date", desc=True).limit(ROLLING_WINDOW).execute()).data or []
        # season averages
        season_start = f"{mlb_season_for_date(date_str)}-01-01"
        season = (supabase.table("mlb_player_stats")
                  .select("hits,total_bases,rbi,runs,home_runs,plate_appearances,strikeouts_pitched")
                  .eq("player_id", p_db).gte("game_date", season_start)
                  .lt("game_date", date_str).execute()).data or []

        days_rest = None
        if recent:
            try:
                last = datetime.strptime(recent[0]["game_date"], "%Y-%m-%d").date()
                days_rest = (target_date - last).days
            except ValueError:
                pass

        # projected batting-order slot: most recent known slot
        slot_rows = (supabase.table("mlb_player_game_conditions")
                     .select("batting_order_slot,game_date")
                     .eq("player_id", p_db).lt("game_date", date_str)
                     .not_.is_("batting_order_slot", "null")
                     .order("game_date", desc=True).limit(BATTING_ORDER_SLOT_LOOKBACK).execute()).data or []
        slot = _si(slot_rows[0]["batting_order_slot"]) if slot_rows else None

        opp_starter_ext = starter_ext_by_team.get(opp_db)
        opp_starter_db = player_map.get(str(opp_starter_ext)) if opp_starter_ext else None
        opp_starter_hand = throw_hand.get(opp_starter_db) if opp_starter_db else None

        park = (supabase.table("mlb_park_factors").select("factor_runs,factor_hr")
                .eq("team_id", games[0]["home_team_id"]).limit(1).execute()).data
        park_factor = park[0]["factor_runs"] if park else None
        # use this game's home park
        home_team_for_game = next((g["home_team_id"] for g in games if g["id"] == tg["game_id"]), None)
        if home_team_for_game is not None:
            pk = (supabase.table("mlb_park_factors").select("factor_runs")
                  .eq("team_id", home_team_for_game).limit(1).execute()).data
            park_factor = pk[0]["factor_runs"] if pk else None

        rows.append({
            "player_id": p_db, "game_id": tg["game_id"], "game_date": date_str,
            "home_away": tg["home_away"], "days_rest": days_rest,
            "opponent_team_id": opp_db, "batting_order_slot": slot,
            "rolling_hits_5g": _safe_avg([r.get("hits") for r in recent]),
            "rolling_tb_5g": _safe_avg([r.get("total_bases") for r in recent]),
            "rolling_rbi_5g": _safe_avg([r.get("rbi") for r in recent]),
            "rolling_runs_5g": _safe_avg([r.get("runs") for r in recent]),
            "rolling_hr_5g": _safe_avg([r.get("home_runs") for r in recent]),
            "rolling_pa_5g": _safe_avg([r.get("plate_appearances") for r in recent]),
            "rolling_k_pitched_5g": _safe_avg([r.get("strikeouts_pitched") for r in recent]),
            "rolling_outs_5g": _safe_avg([r.get("outs_pitched") for r in recent]),
            "season_avg_hits": _safe_avg([r.get("hits") for r in season]),
            "season_avg_tb": _safe_avg([r.get("total_bases") for r in season]),
            "season_avg_rbi": _safe_avg([r.get("rbi") for r in season]),
            "season_avg_runs": _safe_avg([r.get("runs") for r in season]),
            "season_avg_hr": _safe_avg([r.get("home_runs") for r in season]),
            "season_avg_pa": _safe_avg([r.get("plate_appearances") for r in season]),
            "season_avg_k_pitched": _safe_avg([r.get("strikeouts_pitched") for r in season]),
            "opp_starter_id": opp_starter_db, "opp_starter_hand": opp_starter_hand,
            "park_factor": park_factor,
        })

    if rows:
        for i in range(0, len(rows), BATCH_SIZE):
            supabase.table("mlb_daily_conditions").upsert(
                rows[i:i + BATCH_SIZE], on_conflict="player_id,game_date").execute()
    print(f"  Upserted {len(rows)} mlb_daily_conditions rows.")


# ── Step 0: reconcile ──────────────────────────────────────────────────────────

def reconcile_picks(through_date: date) -> None:
    """Settle every unresolved MLB player pick whose game is already final
    (game_date on or before `through_date`, and strictly before today).

    Self-healing: this sweeps ALL unresolved past player picks, not just one
    date, so a box score that lands late still settles on a later run.

    Auto-voiding: a pick on a past (final) game with no stat line means the
    player never appeared — a scratched probable starter (K props) or a DNP.
    The market voids those, and they can never be graded, so we remove them so
    they don't sit "pending" forever. Mirrors how injury_check invalidates
    picks. Game props (spread/total/winner) have no stat key and are settled
    elsewhere, so they're skipped here.
    """
    # Never grade today's games (some may still be in progress); cap at yesterday.
    cutoff = _date_str(min(through_date, date.today() - timedelta(days=1)))
    picks = (supabase.table("pick_results")
             .select("id,entity_id,stat,game_date,recommended_line")
             .eq("league_id", MLB_LEAGUE_ID)
             .is_("actual_result", "null")
             .lte("game_date", cutoff)
             .execute()).data or []
    # Only player props carry a stat column we can grade.
    gradeable = [p for p in picks if mlb_value_cols((p.get("stat") or "").lower())]
    if not gradeable:
        print(f"[Step 0] No unresolved MLB player picks through {cutoff}.")
        return

    # ── Box-score completeness map. We only void a pick (player has no stat line)
    #    when that player's TEAM box score for the day is complete — i.e. a real
    #    DNP/scratch. If the team box score is missing/partial (an ingestion gap),
    #    we DEFER instead of deleting, so the next box-score refetch can fill it.
    entity_ids = list({p["entity_id"] for p in gradeable})
    _, _, abbr_to_id = _team_maps()
    pteam = (supabase.table("players").select("id,team").in_("id", entity_ids).execute()).data or []
    player_team = {r["id"]: abbr_to_id.get((r.get("team") or "").upper()) for r in pteam}
    min_date = min(p["game_date"] for p in gradeable)
    team_day_rows: dict[tuple[str, int], int] = {}
    page = 0
    while True:
        batch = (supabase.table("mlb_player_stats").select("team_id,game_date")
                 .gte("game_date", min_date).lte("game_date", cutoff)
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        for s in batch:
            k = (s["game_date"], s["team_id"])
            team_day_rows[k] = team_day_rows.get(k, 0) + 1
        if len(batch) < 1000:
            break
        page += 1

    print(f"[Step 0] Reconciling {len(gradeable)} unresolved MLB player pick(s) through {cutoff}")
    resolved = voided = deferred = 0
    for pick in gradeable:
        cols = mlb_value_cols((pick["stat"]).lower())
        srow = (supabase.table("mlb_player_stats").select(",".join(cols))
                .eq("player_id", pick["entity_id"]).eq("game_date", pick["game_date"])
                .limit(1).execute()).data
        if srow and all(srow[0].get(c) is not None for c in cols):
            actual = float(sum(srow[0][c] for c in cols))
            line = pick.get("recommended_line")
            did_hit = (actual > float(line)) if line is not None else None
            supabase.table("pick_results").update(
                {"actual_result": actual, "did_hit": did_hit}).eq("id", pick["id"]).execute()
            resolved += 1
            continue
        # No stat line for this player.
        tid = player_team.get(pick["entity_id"])
        box_complete = tid is not None and team_day_rows.get((pick["game_date"], tid), 0) >= MIN_TEAM_BOX_ROWS
        if box_complete:
            # Complete box score, player absent → genuine DNP/scratch (market voids).
            supabase.table("pick_results").delete().eq("id", pick["id"]).execute()
            voided += 1
        else:
            # Missing/partial box score → ingestion gap; keep pending for the refetch.
            deferred += 1
    print(f"  Resolved {resolved}, voided {voided}, deferred {deferred} (incomplete box score) "
          f"of {len(gradeable)}.")


def reconcile_game_picks(through_date: date) -> None:
    """Settle MLB game-prop picks (winner / spread / total) from final scores.
    entity_id is the game id; modifiers.team_abbr is the bet side for ML/spread.
    Player props are graded by reconcile_picks; this is the game-prop analog the
    MLB pipeline was missing."""
    cutoff = _date_str(min(through_date, date.today() - timedelta(days=1)))
    picks = (supabase.table("pick_results")
             .select("id,entity_id,prop_type,recommended_line,modifiers,game_date")
             .eq("league_id", MLB_LEAGUE_ID).is_("actual_result", "null")
             .in_("prop_type", ["winner", "spread", "total"])
             .lte("game_date", cutoff).execute()).data or []
    if not picks:
        print("[Step 0b] No unresolved MLB game picks.")
        return
    gids = list({p["entity_id"] for p in picks})
    games: dict[int, dict] = {}
    for i in range(0, len(gids), 100):
        for g in (supabase.table("games")
                  .select("id,home_team_id,away_team_id,home_score,away_score")
                  .in_("id", gids[i:i + 100]).execute()).data or []:
            games[g["id"]] = g
    _, _, abbr_to_id = _team_maps()
    resolved = 0
    for p in picks:
        g = games.get(p["entity_id"])
        if not g or g.get("home_score") is None or g.get("away_score") is None:
            continue  # game not final yet
        h, a = g["home_score"], g["away_score"]
        pt = p["prop_type"]
        line = p.get("recommended_line")
        if pt == "total":
            actual = float(h + a)
            did = actual > line if line is not None else None
        else:
            tid = abbr_to_id.get(((p.get("modifiers") or {}).get("team_abbr") or "").upper())
            is_home = (tid == g["home_team_id"])
            margin = (h - a) if is_home else (a - h)
            actual = float(margin)
            did = (margin > 0) if pt == "winner" else (margin > line if line is not None else None)
        supabase.table("pick_results").update(
            {"actual_result": actual, "did_hit": did}).eq("id", p["id"]).execute()
        resolved += 1
    print(f"[Step 0b] Resolved {resolved}/{len(picks)} game picks.")


# ── Trailing box-score refresh ───────────────────────────────────────────────────

def refetch_recent_boxscores(target_date: date, days: int = REFETCH_WINDOW_DAYS) -> None:
    """Re-fetch + upsert box scores for the trailing `days` of games (now final).

    Games are first ingested while still in progress, leaving a PARTIAL player set
    that backfill_completed_games never revisits (it only fills dates with zero
    rows). This idempotently completes them so reconciliation grades against full
    box scores and the auto-void doesn't delete gradeable picks. Today is excluded
    (handled by the live fetch)."""
    start = _date_str(target_date - timedelta(days=days))
    end = _date_str(target_date)
    games = (supabase.table("games")
             .select("id, ext_id, game_date, home_team_id, away_team_id")
             .eq("league_id", MLB_LEAGUE_ID)
             .gte("game_date", start).lt("game_date", end)
             .execute()).data or []
    if not games:
        print(f"[Refetch] No games {start}..{end} to refresh.")
        return
    print(f"[Refetch] Completing box scores for {len(games)} game(s) {start}..{end}")
    _fetch_and_insert_box_scores(games)


# ── Orchestrator ───────────────────────────────────────────────────────────────

def run(target_date: date, reconcile_only: bool = False, slate_only: bool = False) -> None:
    yesterday = target_date - timedelta(days=1)
    print("=" * 60)
    print(f"MLB Nightly  |  target {_date_str(target_date)}")
    print("=" * 60)

    if not slate_only:
        # Complete any partial recent box scores BEFORE grading picks against them.
        try:
            refetch_recent_boxscores(target_date)
        except Exception as exc:
            print(f"  ERROR refetch box scores: {exc}")
        try:
            reconcile_picks(yesterday)
        except Exception as exc:
            print(f"  ERROR reconcile_picks: {exc}")
        try:
            reconcile_game_picks(yesterday)
        except Exception as exc:
            print(f"  ERROR reconcile_game_picks: {exc}")
    if reconcile_only:
        print("Reconcile-only complete.")
        return

    if not slate_only:
        try:
            backfill_completed_games(up_to=target_date)
        except Exception as exc:
            print(f"  ERROR backfill: {exc}")

    games, probables = get_slate(target_date)

    # fetch box scores for any of today's games already final
    try:
        _fetch_and_insert_box_scores(games)
    except Exception as exc:
        print(f"  ERROR box scores: {exc}")

    try:
        compute_daily_conditions(games, probables, target_date)
    except Exception as exc:
        print(f"  ERROR daily_conditions: {exc}")

    print("=" * 60)
    print("MLB nightly complete.")


def main() -> int:
    parser = argparse.ArgumentParser(description="MLB nightly batch")
    parser.add_argument("--date", type=str, default=None)
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--reconcile-only", action="store_true", dest="reconcile_only")
    parser.add_argument("--slate-only", action="store_true", dest="slate_only")
    parser.add_argument("--backfill-from", type=str, default=None, dest="backfill_from",
                        help="Seed history: fetch box scores for every date from "
                             "this date up to --date (exclusive). Box-score only.")
    args = parser.parse_args()

    if args.date:
        target = datetime.strptime(args.date, "%Y-%m-%d").date()
    elif args.today:
        target = date.today()
    else:
        target = date.today()
        print(f"  NOTE: no --date; defaulting to today ({_date_str(target)}).")

    if args.backfill_from:
        start = datetime.strptime(args.backfill_from, "%Y-%m-%d").date()
        print(f"Seeding MLB history {args.backfill_from} .. {_date_str(target)} (box scores only)")
        backfill_completed_games(up_to=target, start_override=start)
        print("History seed complete.")
        return 0

    run(target, reconcile_only=args.reconcile_only, slate_only=args.slate_only)
    return 0


if __name__ == "__main__":
    sys.exit(main())
