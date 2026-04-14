"""
Backfill player positions from commonteamroster endpoint.
Runs for the current season only (30 API calls, ~1 min).
"""
import os
import time
from dotenv import load_dotenv
from supabase import create_client
from nba_api.stats.endpoints import commonteamroster

load_dotenv()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

CURRENT_SEASON = '2024-25'

def main():
    print("Loading teams from DB...")
    teams_resp = supabase.table('teams').select('id, abbreviation, ext_id').execute()
    teams = teams_resp.data
    print(f"Found {len(teams)} teams")

    print("Loading player ext_id map from DB...")
    players_resp = supabase.table('players').select('id, ext_id').eq('league', 'nba').execute()
    player_ext_to_db = {p['ext_id']: p['id'] for p in players_resp.data}
    print(f"Found {len(player_ext_to_db)} NBA players")

    updated = 0
    skipped = 0

    for i, team in enumerate(teams, 1):
        print(f"  [{i}/{len(teams)}] {team['abbreviation']}...", end=' ', flush=True)
        try:
            time.sleep(0.6)
            roster = commonteamroster.CommonTeamRoster(
                team_id=team['ext_id'],
                season=CURRENT_SEASON
            )
            df = roster.get_data_frames()[0]

            if df.empty:
                print("no data")
                continue

            for _, row in df.iterrows():
                player_ext_id = str(row['PLAYER_ID'])
                position = str(row.get('POSITION', '') or '').strip()

                if not position or player_ext_id not in player_ext_to_db:
                    skipped += 1
                    continue

                player_db_id = player_ext_to_db[player_ext_id]
                supabase.table('players').update({
                    'position': position,
                    'team': team['abbreviation'],
                }).eq('id', player_db_id).execute()
                updated += 1

            print(f"{len(df)} players")

        except Exception as e:
            print(f"ERROR: {e}")
            continue

    print(f"\nDone. Updated {updated} players, skipped {skipped}.")

if __name__ == '__main__':
    main()
