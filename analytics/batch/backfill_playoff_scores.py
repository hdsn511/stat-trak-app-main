"""
Backfill home_score / away_score for completed playoff and play-in games from
the ESPN scoreboard (Phase 8 hybrid — replaces per-game BoxScoreTraditionalV3
score summation). Safe to re-run — overwrites any previously written scores.
Skips today's in-progress games (only STATUS_FINAL events are used).

Games are grouped by date (one ESPN scoreboard call per date) and matched to
DB rows by (game_date, home_team, away_team) via teams.espn_id; games.espn_id
is stamped as a side effect for future direct joins.

Run via:
    python -m analytics.batch.backfill_playoff_scores
"""
import sys
from datetime import date

from analytics.data.nba_espn.ingest import (
    _event_is_final,
    _event_sides,
    _int0,
    get_events,
    load_team_maps,
    match_events_to_games,
)
from analytics.db.connection import NBA_LEAGUE_ID, supabase


def backfill_playoff_scores() -> None:
    today = date.today().isoformat()
    print(f"[backfill_playoff_scores] Fetching playoff/playin games before {today}...")

    # Process all completed playoff/playin games (not just null — corrects wrong values too).
    # Exclude today since box scores may not be final yet.
    result = (
        supabase.table("games")
        .select("id,ext_id,home_team_id,away_team_id,game_date,game_type")
        .eq("league_id", NBA_LEAGUE_ID)
        .in_("game_type", ["playoff", "playin"])
        .lt("game_date", today)
        .execute()
    )
    games = result.data or []
    if not games:
        print("  No completed playoff/playin games found.")
        return

    print(f"  Found {len(games)} game(s) to process.")

    try:
        team_espn_map, _abbrs = load_team_maps()
    except RuntimeError as exc:
        print(f"  ERROR: {exc}")
        return

    by_date: dict[str, list[dict]] = {}
    for g in games:
        by_date.setdefault(g["game_date"], []).append(g)

    updated = 0
    failed = 0

    for date_str in sorted(by_date):
        target_ids = {g["id"] for g in by_date[date_str]}
        finals = [e for e in get_events(date_str) if _event_is_final(e)]
        matched = match_events_to_games(date_str, finals, team_espn_map)
        matched_game_ids = set()

        for ev_id, game in matched.items():
            if game["id"] not in target_ids:
                continue  # a non-playoff game sharing the date
            events = [e for e in finals if str(e.get("id")) == ev_id]
            home, away = _event_sides(events[0]) if events else ({}, {})
            hs, aws = home.get("score"), away.get("score")
            if hs is None or aws is None:
                print(f"  WARN: event {ev_id} ({date_str}) final but has no "
                      f"scores. Skipping.")
                failed += 1
                continue
            supabase.table("games").update(
                {"home_score": _int0(hs), "away_score": _int0(aws), "status": 2}
            ).eq("id", game["id"]).execute()
            print(f"  {game['ext_id']} ({date_str}): home={_int0(hs)} away={_int0(aws)}")
            matched_game_ids.add(game["id"])
            updated += 1

        for g in by_date[date_str]:
            if g["id"] not in matched_game_ids:
                print(f"  WARN: no final ESPN event matched game "
                      f"{g['ext_id']} ({date_str}). Skipping.")
                failed += 1

    print(f"\n[backfill_playoff_scores] Done. Updated={updated} Failed={failed}")


if __name__ == "__main__":
    backfill_playoff_scores()
    sys.exit(0)
