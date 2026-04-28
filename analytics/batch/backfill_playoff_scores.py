"""
One-time backfill: write home_score / away_score for completed playoff and
play-in games. Safe to re-run — overwrites any previously written scores.
Skips today's in-progress games (box score not final yet).

Run via:
    python -m analytics.batch.backfill_playoff_scores
"""
import time
from datetime import date

from analytics.db.connection import NBA_LEAGUE_ID, API_DELAY_SECONDS, supabase
from analytics.data.enrich_games import api_call_with_retry


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

    # Build team ext_id → db_id map and reverse
    team_rows = supabase.table("teams").select("id,ext_id").eq("league_id", NBA_LEAGUE_ID).execute()
    team_map = {r["ext_id"]: r["id"] for r in (team_rows.data or [])}
    team_db_to_ext = {v: k for k, v in team_map.items()}

    try:
        from nba_api.stats.endpoints import BoxScoreTraditionalV3
    except ImportError as exc:
        print(f"  ERROR: nba_api not installed: {exc}")
        return

    updated = 0
    failed = 0

    for game in games:
        ext_id = game["ext_id"]
        game_db_id = game["id"]
        home_db_t = game["home_team_id"]
        away_db_t = game["away_team_id"]

        def _trad(gid=ext_id):
            return BoxScoreTraditionalV3(game_id=gid)

        result = api_call_with_retry(_trad, f"BoxScoreTraditionalV3 {ext_id}")
        if result is None:
            print(f"  WARN: no box score for {ext_id} ({game['game_date']}). Skipping.")
            failed += 1
            time.sleep(API_DELAY_SECONDS)
            continue

        try:
            player_df = result.get_data_frames()[0]

            # Sum player points per team — V3 has no reliable separate team-totals
            # frame; get_data_frames()[1] does not return final team scores.
            team_pts: dict[str, int] = {}
            for _, pr in player_df.iterrows():
                t_ext = str(int(pr["teamId"]))
                team_pts[t_ext] = team_pts.get(t_ext, 0) + int(pr.get("points") or 0)

            home_ext = team_db_to_ext.get(home_db_t)
            away_ext = team_db_to_ext.get(away_db_t)
            hs = team_pts.get(home_ext) if home_ext else None
            aws = team_pts.get(away_ext) if away_ext else None

            if hs is None or aws is None:
                print(f"  WARN: could not resolve scores for {ext_id}. team_pts={team_pts}")
                failed += 1
            else:
                supabase.table("games").update({"home_score": hs, "away_score": aws}).eq("id", game_db_id).execute()
                print(f"  {ext_id} ({game['game_date']}): home={hs} away={aws}")
                updated += 1
        except Exception as exc:
            print(f"  ERROR: {ext_id}: {exc}")
            failed += 1

        time.sleep(API_DELAY_SECONDS)

    print(f"\n[backfill_playoff_scores] Done. Updated={updated} Failed={failed}")


if __name__ == "__main__":
    backfill_playoff_scores()
