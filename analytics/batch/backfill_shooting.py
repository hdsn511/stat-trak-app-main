"""Fill field_goals_made/attempted + three_points_attempted on existing nba_player_stats rows.
Usage: python -m analytics.batch.backfill_shooting --since 2024-10-01 [--until YYYY-MM-DD]"""
import argparse
from datetime import date, timedelta

from analytics.data.nba_espn.ingest import ingest_boxscores_for_date

ap = argparse.ArgumentParser()
ap.add_argument("--since", required=True)
ap.add_argument("--until", default=date.today().isoformat())
a = ap.parse_args()
d, end = date.fromisoformat(a.since), date.fromisoformat(a.until)
while d <= end:
    try:
        ingest_boxscores_for_date(d.isoformat(), new_cols_only=True)
    except Exception as e:  # keep going; rerun is idempotent
        print(f"ERROR {d}: {e}")
    d += timedelta(days=1)
