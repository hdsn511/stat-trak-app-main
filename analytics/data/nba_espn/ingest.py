"""
analytics/data/nba_espn/ingest.py

ESPN-backed NBA ingestion (Phase 8 hybrid). Everything BASIC comes from ESPN's
hidden site API via the shared analytics/data/espn/client.py:
  scoreboard(date)  -> games rows (slate + completed-game discovery + scores)
  summary(event)    -> per-player basic box score -> nba_player_stats
  teams()/roster()  -> team/player espn_id mapping + position refresh

Advanced stats (BoxScoreAdvancedV3 / PlayerTrackV3 / BoxScoreSummaryV2) stay on
nba_api in analytics/data/enrich_games.py — untouched here.

Identity model:
  - teams.ext_id / players.ext_id / games.ext_id remain nba_api-native.
  - teams.espn_id / players.espn_id carry ESPN ids, populated by
    analytics/batch/map_espn_ids.py (never silent name-guessing at ingest).
  - games.espn_id is stamped as ESPN events are matched to DB games by
    (game_date, home_team, away_team). ESPN-discovered games that don't exist
    yet are inserted with ext_id = ESPN event id as a PROVISIONAL value; the
    advanced-stats path heals ext_id to the NBA-native id (it needs it anyway
    to call stats.nba.com) — see enrich_games.resolve_nba_ext_ids().
  - Boxscore athletes resolve through players.espn_id ONLY. An unmapped
    athlete triggers a loud warning plus one self-heal attempt via the same
    normalized-name rule the mapper uses; if still ambiguous the row is
    skipped — a player row is never fabricated.

Boxscore quirk (validated live 2026-07-31): ESPN NBA summaries carry ONE
unnamed stat group per team (name=None) — unlike NFL/NHL's named groups — so
parsing is keyed on the group's `keys` array, never on the group name.

CLI (parity/validation):
    python -m analytics.data.nba_espn.ingest --compare --date 2026-02-11
    python -m analytics.data.nba_espn.ingest --ingest  --date 2026-02-11 --dry-run
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from typing import Optional

from analytics.data.espn import client as espn
from analytics.db.connection import BATCH_SIZE, NBA_LEAGUE_ID, supabase

SPORT, LEAGUE = "basketball", "nba"

# ESPN boxscore `keys` this pipeline consumes. Everything maps onto the
# EXISTING nba_player_stats basic columns — advanced columns are not touched.
_KEY_MINUTES = "minutes"
_KEY_POINTS = "points"
_KEY_REBOUNDS = "rebounds"
_KEY_ASSISTS = "assists"
_KEY_FOULS = "fouls"
_KEY_THREES = "threePointFieldGoalsMade-threePointFieldGoalsAttempted"
REQUIRED_KEYS = {
    _KEY_MINUTES, _KEY_POINTS, _KEY_REBOUNDS,
    _KEY_ASSISTS, _KEY_FOULS, _KEY_THREES,
}

# Suffix tokens dropped during name normalization (both sides).
_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


# ── Name normalization (shared with analytics/batch/map_espn_ids.py) ──────────

def normalize_name(name: str) -> str:
    """Normalize a player name for cross-source matching.

    Lowercases, strips diacritics (DB names are nba_api-native and keep them:
    'Dončić'; ESPN uses ASCII: 'Doncic'), converts punctuation
    (periods/apostrophes/hyphens) to spaces, drops generational suffixes
    (Jr./Sr./II–V), and collapses whitespace.
    """
    ascii_name = (
        unicodedata.normalize("NFKD", name or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    ascii_name = re.sub(r"[.'’-]", " ", ascii_name)
    tokens = [t for t in ascii_name.split() if t not in _NAME_SUFFIXES]
    return " ".join(tokens)


# ── Small parsers ──────────────────────────────────────────────────────────────

def _int0(raw) -> int:
    """'33' -> 33; ''/'--'/None -> 0 (basic box columns are zero-defaulted,
    matching the nba_api path's _safe_int behavior)."""
    if raw in (None, "", "--"):
        return 0
    try:
        return int(float(str(raw).replace("+", "")))
    except (ValueError, TypeError):
        return 0


def _made_from_pair(raw) -> int:
    """'3-5' -> 3 (made). Junk -> 0."""
    if raw in (None, "", "--"):
        return 0
    return _int0(str(raw).split("-", 1)[0])


# ── DB map loaders ─────────────────────────────────────────────────────────────

def load_team_maps() -> tuple[dict[str, int], dict[str, str]]:
    """Return ({team espn_id -> db_id}, {team espn_id -> abbreviation}) for NBA.
    Hard-fails if the espn_id mapping hasn't been run — ingestion without it
    would silently drop every row."""
    rows = (supabase.table("teams").select("id,abbreviation,espn_id")
            .eq("league_id", NBA_LEAGUE_ID).execute()).data or []
    mapped = [r for r in rows if r.get("espn_id")]
    if len(mapped) < len(rows):
        raise RuntimeError(
            f"Only {len(mapped)}/{len(rows)} NBA teams have espn_id. "
            "Run: python -m analytics.batch.map_espn_ids --teams"
        )
    return ({r["espn_id"]: r["id"] for r in mapped},
            {r["espn_id"]: r["abbreviation"] for r in mapped})


def load_player_espn_map() -> dict[str, int]:
    """{player espn_id -> db_id} for NBA, paginated past PostgREST's 1000 cap."""
    out: dict[str, int] = {}
    page = 0
    while True:
        batch = (supabase.table("players").select("id,espn_id")
                 .eq("league", "nba").not_.is_("espn_id", "null")
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        out.update({r["espn_id"]: r["id"] for r in batch})
        if len(batch) < 1000:
            break
        page += 1
    return out


def _load_all_nba_players() -> list[dict]:
    """All NBA player rows (id, name, team, espn_id), paginated."""
    out: list[dict] = []
    page = 0
    while True:
        batch = (supabase.table("players").select("id,name,team,espn_id")
                 .eq("league", "nba")
                 .range(page * 1000, page * 1000 + 999).execute()).data or []
        out.extend(batch)
        if len(batch) < 1000:
            break
        page += 1
    return out


# ── Scoreboard -> events / games matching ──────────────────────────────────────

def _event_sides(event: dict) -> tuple[dict, dict]:
    """(home_competitor, away_competitor) for an ESPN event."""
    comp = (event.get("competitions") or [{}])[0]
    sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
    return sides.get("home", {}), sides.get("away", {})


def _event_is_final(event: dict) -> bool:
    status = (event.get("competitions") or [{}])[0].get("status", {}).get("type", {})
    return bool(status.get("completed")) and status.get("name") == "STATUS_FINAL"


def get_events(date_str: str) -> list[dict]:
    """ESPN scoreboard events for a YYYY-MM-DD date."""
    return espn.get_scoreboard(SPORT, LEAGUE, date_str.replace("-", ""))


def match_events_to_games(
    date_str: str,
    events: list[dict],
    team_espn_map: dict[str, int],
    stamp: bool = True,
) -> dict[str, dict]:
    """Match ESPN events to DB `games` rows for one date.

    Matching is by (home_team_db_id, away_team_db_id) — never by game ext_id,
    which is nba_api-native. Returns {espn_event_id: game_row}. With stamp=True
    (default) each matched game's games.espn_id is persisted if missing, so
    later runs and other jobs can join directly. Unmatched events (All-Star,
    exhibitions, teams missing espn_id) warn loudly and are excluded.
    """
    db_games = (supabase.table("games")
                .select("id,ext_id,espn_id,home_team_id,away_team_id,game_date")
                .eq("league_id", NBA_LEAGUE_ID).eq("game_date", date_str)
                .execute()).data or []
    by_pair = {(g["home_team_id"], g["away_team_id"]): g for g in db_games}
    by_espn = {g["espn_id"]: g for g in db_games if g.get("espn_id")}

    out: dict[str, dict] = {}
    for ev in events:
        ev_id = str(ev.get("id", ""))
        if ev_id in by_espn:  # already stamped on a prior run
            out[ev_id] = by_espn[ev_id]
            continue
        home, away = _event_sides(ev)
        home_db = team_espn_map.get(str(home.get("team", {}).get("id")))
        away_db = team_espn_map.get(str(away.get("team", {}).get("id")))
        if not home_db or not away_db:
            print(f"  WARNING [nba-espn {date_str}] event {ev_id} "
                  f"({ev.get('name')}) has unmapped team(s); skipped.")
            continue
        game = by_pair.get((home_db, away_db))
        if not game:
            print(f"  note [nba-espn {date_str}] event {ev_id} "
                  f"({ev.get('name')}) has no games row on this date.")
            continue
        out[ev_id] = game
        if stamp and not game.get("espn_id"):
            supabase.table("games").update({"espn_id": ev_id}) \
                .eq("id", game["id"]).execute()
            game["espn_id"] = ev_id
    return out


def build_game_rows_from_events(
    date_str: str,
    events: list[dict],
    team_espn_map: dict[str, int],
) -> list[dict]:
    """Build `games` upsert rows from ESPN events NOT already in the DB.

    ext_id is set to the ESPN event id as a PROVISIONAL value (ESPN does not
    expose the NBA-native game id — verified live); games.espn_id carries the
    same id durably. The advanced-stats path heals ext_id to nba-native later.
    Final events get status=2 + scores; scheduled events keep status default.
    """
    season_yr = (int(date_str[:4]) if int(date_str[5:7]) >= 10
                 else int(date_str[:4]) - 1)
    rows: list[dict] = []
    for ev in events:
        ev_id = str(ev.get("id", ""))
        home, away = _event_sides(ev)
        home_db = team_espn_map.get(str(home.get("team", {}).get("id")))
        away_db = team_espn_map.get(str(away.get("team", {}).get("id")))
        if not ev_id or not home_db or not away_db:
            print(f"  WARNING [nba-espn {date_str}] event {ev_id or '?'} "
                  f"({ev.get('name')}) unmappable teams; not inserted.")
            continue
        # ESPN season.year labels the END year of an NBA season (2026 for
        # 2025-26); our season int is the START year.
        espn_year = (ev.get("season") or {}).get("year")
        row = {
            "league_id": NBA_LEAGUE_ID,
            "ext_id": ev_id,          # provisional — healed by advanced path
            "espn_id": ev_id,
            "game_date": date_str,
            "home_team_id": home_db,
            "away_team_id": away_db,
            "season": (espn_year - 1) if espn_year else season_yr,
            "game_time": ev.get("date"),
        }
        if _event_is_final(ev):
            row["status"] = 2
            row["home_score"] = _int0(home.get("score"))
            row["away_score"] = _int0(away.get("score"))
        rows.append(row)
    return rows


# ── Summary boxscore parsing ───────────────────────────────────────────────────

def parse_summary_boxscore(summary: dict, event_id: str) -> list[dict]:
    """Flatten one ESPN NBA summary into per-player basic stat rows.

    Returns dicts with `player_espn_id`, `player_name`, `player_position`,
    `team_espn_id` plus the nba_player_stats basic columns (points, rebounds,
    assists, three_points_made, fouls, minutes_played). DNP athletes (empty
    stats array) are emitted with zeros — mirroring the nba_api path, which
    stored 0-minute rows for dressed non-participants.

    ESPN NBA groups are UNNAMED (name=None, one group per team) so resolution
    uses the `keys` array exclusively; missing required keys warn loudly.
    """
    box_teams = ((summary or {}).get("boxscore", {}) or {}).get("players", [])
    if not box_teams:
        print(f"  WARNING [nba-espn {event_id}] summary has no "
              f"boxscore.players; no stat rows parsed.")
        return []

    rows: list[dict] = []
    for team_block in box_teams:
        team_ext = str(team_block.get("team", {}).get("id", ""))
        for group in team_block.get("statistics", []):
            keys = group.get("keys") or []
            if not keys:
                print(f"  WARNING [nba-espn {event_id}] team {team_ext} stat "
                      f"group has no keys array; group skipped.")
                continue
            missing = REQUIRED_KEYS - set(keys)
            if missing:
                print(f"  WARNING [nba-espn {event_id}] team {team_ext} keys "
                      f"missing {sorted(missing)}; those columns default to 0.")
            idx = {k: i for i, k in enumerate(keys)}

            for entry in group.get("athletes", []):
                athlete = entry.get("athlete", {}) or {}
                ext_id = str(athlete.get("id", ""))
                if not ext_id:
                    print(f"  WARNING [nba-espn {event_id}] athlete without id "
                          f"on team {team_ext}; skipped.")
                    continue
                stats = entry.get("stats") or []

                def val(key: str):
                    i = idx.get(key)
                    return stats[i] if i is not None and i < len(stats) else None

                rows.append({
                    "player_espn_id": ext_id,
                    "player_name": athlete.get("displayName", f"Player {ext_id}"),
                    "player_position": (athlete.get("position") or {}).get("abbreviation"),
                    "team_espn_id": team_ext,
                    # DNP (stats == []) -> all zeros via _int0(None).
                    "points": _int0(val(_KEY_POINTS)),
                    "rebounds": _int0(val(_KEY_REBOUNDS)),
                    "assists": _int0(val(_KEY_ASSISTS)),
                    "three_points_made": _made_from_pair(val(_KEY_THREES)),
                    "fouls": _int0(val(_KEY_FOULS)),
                    "minutes_played": _int0(val(_KEY_MINUTES)),
                })
    return rows


# ── Player resolution (espn_id-only, with loud self-heal) ─────────────────────

def resolve_players(
    parsed_rows: list[dict],
    player_espn_map: dict[str, int],
    team_abbr_by_espn: dict[str, str],
    allow_self_heal: bool = True,
) -> tuple[dict[str, int], list[dict]]:
    """Resolve parsed boxscore rows to player db ids via players.espn_id.

    Unmapped athletes get ONE self-heal attempt: normalized-name match against
    NBA player rows without an espn_id, preferring same-team candidates. A
    unique candidate is persisted (players.espn_id updated) and used; zero or
    ambiguous candidates are warned and left unresolved — never guessed.

    Returns (resolved {espn_id -> db_id} covering only this call's rows,
    unresolved_rows).
    """
    resolved: dict[str, int] = {}
    unresolved: list[dict] = []
    healable = [r for r in parsed_rows
                if r["player_espn_id"] not in player_espn_map]
    heal_pool: Optional[dict[str, list[dict]]] = None

    if healable and allow_self_heal:
        pool: dict[str, list[dict]] = {}
        for p in _load_all_nba_players():
            if p.get("espn_id"):
                continue  # already mapped to some other athlete
            pool.setdefault(normalize_name(p["name"]), []).append(p)
        heal_pool = pool

    seen_heal: set[str] = set()
    for row in parsed_rows:
        eid = row["player_espn_id"]
        if eid in player_espn_map:
            resolved[eid] = player_espn_map[eid]
            continue
        if eid in seen_heal:
            if eid in player_espn_map:
                resolved[eid] = player_espn_map[eid]
            else:
                unresolved.append(row)
            continue
        seen_heal.add(eid)

        if heal_pool is None:
            print(f"  WARNING [nba-espn] no espn_id mapping for "
                  f"{row['player_name']} ({eid}); row skipped (self-heal off).")
            unresolved.append(row)
            continue

        candidates = heal_pool.get(normalize_name(row["player_name"]), [])
        team_abbr = team_abbr_by_espn.get(row["team_espn_id"])
        if len(candidates) > 1 and team_abbr:
            same_team = [c for c in candidates if c.get("team") == team_abbr]
            if len(same_team) == 1:
                candidates = same_team
        if len(candidates) == 1:
            db_row = candidates[0]
            supabase.table("players").update({"espn_id": eid}) \
                .eq("id", db_row["id"]).execute()
            player_espn_map[eid] = db_row["id"]
            resolved[eid] = db_row["id"]
            db_row["espn_id"] = eid
            print(f"  self-heal [nba-espn] mapped {row['player_name']} "
                  f"(espn {eid}) -> players.id={db_row['id']}.")
        else:
            why = "ambiguous" if len(candidates) > 1 else "no name match"
            print(f"  WARNING [nba-espn] cannot resolve {row['player_name']} "
                  f"(espn {eid}, team {team_abbr or row['team_espn_id']}): "
                  f"{why}; row skipped. Run map_espn_ids for a full report.")
            unresolved.append(row)
    return resolved, unresolved


# ── Date-level ingestion (games + basic box scores) ────────────────────────────

def ingest_boxscores_for_date(
    date_str: str,
    only_game_ext_ids: Optional[list[str]] = None,
    dry_run: bool = False,
) -> tuple[int, int]:
    """Fetch ESPN box scores for every FINAL event on date_str and upsert
    nba_player_stats basic rows (+ games scores/status). Games must already
    exist in the DB (use build_game_rows_from_events/get_slate for discovery).

    only_game_ext_ids: optional games.ext_id filter (backward-compat with the
    old per-game fetch interface). dry_run parses and reports without writing.
    Returns (games_processed, stat_rows_written).
    """
    team_espn_map, team_abbr_by_espn = load_team_maps()
    player_espn_map = load_player_espn_map()

    events = [e for e in get_events(date_str) if _event_is_final(e)]
    if not events:
        print(f"  [nba-espn {date_str}] no final events on scoreboard.")
        return 0, 0
    matched = match_events_to_games(date_str, events, team_espn_map,
                                    stamp=not dry_run)
    if only_game_ext_ids is not None:
        wanted = set(only_game_ext_ids)
        matched = {ev_id: g for ev_id, g in matched.items()
                   if g["ext_id"] in wanted}

    events_by_id = {str(e["id"]): e for e in events}
    stat_buffer: list[dict] = []
    score_updates: dict[int, dict] = {}
    games_done = 0

    for ev_id, game in matched.items():
        summary = espn.get_summary(SPORT, LEAGUE, ev_id)
        if not summary:
            print(f"  ERROR [nba-espn {date_str}] no summary for event {ev_id} "
                  f"(game ext_id={game['ext_id']}); stats skipped.")
            continue
        parsed = parse_summary_boxscore(summary, ev_id)
        if not parsed:
            print(f"  WARNING [nba-espn {date_str}] event {ev_id} parsed to "
                  f"zero stat rows.")
            continue
        resolved, unresolved = resolve_players(
            parsed, player_espn_map, team_abbr_by_espn,
            allow_self_heal=not dry_run)
        if unresolved:
            print(f"  WARNING [nba-espn {date_str}] event {ev_id}: "
                  f"{len(unresolved)} athlete(s) dropped (no espn_id mapping).")
        for r in parsed:
            p_db = resolved.get(r["player_espn_id"])
            t_db = team_espn_map.get(r["team_espn_id"])
            if not p_db or not t_db:
                continue
            stat_buffer.append({
                "game_id": game["id"],
                "player_id": p_db,
                "team_id": t_db,
                "game_date": date_str,
                "points": r["points"],
                "rebounds": r["rebounds"],
                "assists": r["assists"],
                "three_points_made": r["three_points_made"],
                "fouls": r["fouls"],
                "minutes_played": r["minutes_played"],
            })
        ev = events_by_id.get(ev_id, {})
        home, away = _event_sides(ev)
        score_updates[game["id"]] = {
            "home_score": _int0(home.get("score")),
            "away_score": _int0(away.get("score")),
            "status": 2,
        }
        games_done += 1
        print(f"    {date_str} event {ev_id} (game {game['ext_id']}): "
              f"{len(parsed)} player rows.")

    if dry_run:
        print(f"  [nba-espn {date_str}] DRY RUN — would upsert "
              f"{len(stat_buffer)} stat rows across {games_done} game(s).")
        return games_done, len(stat_buffer)

    for i in range(0, len(stat_buffer), BATCH_SIZE):
        supabase.table("nba_player_stats").upsert(
            stat_buffer[i:i + BATCH_SIZE],
            on_conflict="game_id,player_id").execute()
    for gid, scores in score_updates.items():
        supabase.table("games").update(scores).eq("id", gid).execute()
    if stat_buffer:
        print(f"  [nba-espn {date_str}] upserted {len(stat_buffer)} "
              f"nba_player_stats rows; scores set on {len(score_updates)} game(s).")
    return games_done, len(stat_buffer)


# ── Parity compare mode ────────────────────────────────────────────────────────

_COMPARE_COLS = ("points", "rebounds", "assists", "three_points_made",
                 "fouls", "minutes_played")


def compare_date(date_str: str, heal_ids: bool = True) -> dict:
    """Diff ESPN-derived basic stats against existing nba_player_stats rows
    for one date. Prints every mismatch; returns summary counts.

    Stats are strictly read-only. With heal_ids=True (default) unmapped
    boxscore athletes still get the standard espn_id self-heal (players table
    identity data only, same unique-name-or-skip rule) — historical boxscores
    are the best source for players no longer on a current roster.

    MIN caveat: the nba_api path truncated 'MM:SS' to MM while ESPN reports a
    whole number that may round up — ±1 minute diffs are reported separately
    from hard stat mismatches.
    """
    team_espn_map, team_abbr_by_espn = load_team_maps()
    player_espn_map = load_player_espn_map()

    events = [e for e in get_events(date_str) if _event_is_final(e)]
    matched = match_events_to_games(date_str, events, team_espn_map, stamp=False)
    print(f"[compare {date_str}] {len(events)} final event(s), "
          f"{len(matched)} matched to DB games.")

    game_ids = [g["id"] for g in matched.values()]
    db_rows: list[dict] = []
    for i in range(0, len(game_ids), 50):
        chunk = game_ids[i:i + 50]
        page = 0
        while True:
            batch = (supabase.table("nba_player_stats")
                     .select("game_id,player_id," + ",".join(_COMPARE_COLS))
                     .in_("game_id", chunk)
                     .range(page * 1000, page * 1000 + 999).execute()).data or []
            db_rows.extend(batch)
            if len(batch) < 1000:
                break
            page += 1
    db_by_key = {(r["game_id"], r["player_id"]): r for r in db_rows}

    id_to_name = {p["id"]: p["name"] for p in _load_all_nba_players()}

    compared = exact = 0
    min_only_diffs: list[str] = []
    mismatches: list[str] = []
    espn_only: list[str] = []
    unmapped: list[str] = []

    for ev_id, game in matched.items():
        summary = espn.get_summary(SPORT, LEAGUE, ev_id)
        if not summary:
            print(f"  ERROR [compare {date_str}] no summary for event {ev_id}.")
            continue
        parsed = parse_summary_boxscore(summary, ev_id)
        resolved, _ = resolve_players(parsed, player_espn_map,
                                      team_abbr_by_espn,
                                      allow_self_heal=heal_ids)
        for r in parsed:
            p_db = resolved.get(r["player_espn_id"])
            if not p_db:
                unmapped.append(f"{r['player_name']} (espn {r['player_espn_id']})")
                continue
            db = db_by_key.pop((game["id"], p_db), None)
            if db is None:
                if r["minutes_played"] > 0:  # DNP-only misses aren't parity
                    espn_only.append(f"{r['player_name']} game {game['ext_id']}")
                continue
            compared += 1
            diffs = {c: (db.get(c), r[c]) for c in _COMPARE_COLS
                     if (db.get(c) or 0) != r[c]}
            if not diffs:
                exact += 1
            elif set(diffs) == {"minutes_played"} and \
                    abs((db.get("minutes_played") or 0) - r["minutes_played"]) <= 1:
                min_only_diffs.append(
                    f"{id_to_name.get(p_db, p_db)} game {game['ext_id']}: "
                    f"MIN db={db.get('minutes_played')} espn={r['minutes_played']}")
                exact += 1  # counted as match — rounding, not a stat error
            else:
                mismatches.append(
                    f"{id_to_name.get(p_db, p_db)} game {game['ext_id']}: " +
                    ", ".join(f"{c} db={a} espn={b}"
                              for c, (a, b) in diffs.items()))

    db_leftover = [k for k in db_by_key]
    print(f"\n[compare {date_str}] players compared: {compared}")
    print(f"  exact match (incl. ±1 MIN rounding): {exact} "
          f"({(exact / compared * 100):.1f}%)" if compared else "  none compared")
    print(f"  ±1 MIN rounding diffs: {len(min_only_diffs)}")
    for line in min_only_diffs:
        print(f"    MIN± {line}")
    print(f"  HARD mismatches: {len(mismatches)}")
    for line in mismatches:
        print(f"    MISMATCH {line}")
    print(f"  espn-only players (played, no DB row): {len(espn_only)}")
    for line in espn_only:
        print(f"    ESPN-ONLY {line}")
    print(f"  db-only rows (no ESPN counterpart): {len(db_leftover)}")
    print(f"  unmapped athletes (no espn_id): {len(unmapped)}")
    for line in unmapped:
        print(f"    UNMAPPED {line}")
    return {
        "compared": compared, "exact": exact,
        "min_rounding": len(min_only_diffs), "mismatches": len(mismatches),
        "espn_only": len(espn_only), "db_only": len(db_leftover),
        "unmapped": len(unmapped),
    }


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="ESPN NBA basic-stats ingestion / parity compare")
    parser.add_argument("--date", type=str, required=True, help="YYYY-MM-DD")
    parser.add_argument("--compare", action="store_true",
                        help="diff ESPN values against existing DB rows (read-only)")
    parser.add_argument("--ingest", action="store_true",
                        help="ingest box scores for the date")
    parser.add_argument("--dry-run", action="store_true", dest="dry_run",
                        help="with --ingest: parse + report, no writes")
    parser.add_argument("--no-heal", action="store_true", dest="no_heal",
                        help="with --compare: skip espn_id self-healing "
                             "(fully read-only)")
    args = parser.parse_args()

    if args.compare:
        compare_date(args.date, heal_ids=not args.no_heal)
        return 0
    if args.ingest:
        ingest_boxscores_for_date(args.date, dry_run=args.dry_run)
        return 0
    parser.error("choose --compare or --ingest")
    return 1


if __name__ == "__main__":
    sys.exit(main())
