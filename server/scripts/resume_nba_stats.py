"""
Resume NBA player stats from a specific player index
"""
import os
import time
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client
from nba_api.stats.static import players as nba_players_static
from nba_api.stats.endpoints import playergamelog
from requests.exceptions import ReadTimeout, ConnectionError

# Load environment variables
load_dotenv()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

SEASONS = ['2022-23', '2023-24', '2024-25', '2025-26']

def fetch_player_game_log_with_retry(player_ext_id: str, season: str, max_retries: int = 5):
    """
    Fetch game log with exponential backoff retry and longer delays
    """
    for attempt in range(max_retries):
        try:
            # LONGER delay to avoid rate limiting
            time.sleep(2.0)
            
            gamelog = playergamelog.PlayerGameLog(
                player_id=player_ext_id,
                season=season,
                season_type_all_star='Regular Season',
                timeout=60  # Increase timeout to 60 seconds
            )
            return gamelog.get_data_frames()[0]
        
        except (ReadTimeout, ConnectionError) as e:
            wait_time = min(2 ** attempt * 5, 120)  # 5s, 10s, 20s, 40s, 80s, max 120s
            if attempt < max_retries - 1:
                print(f"      ⏳ Timeout attempt {attempt + 1}/{max_retries}, waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"      ❌ Failed after {max_retries} attempts, skipping")
                return pd.DataFrame()

        except Exception as e:
            exc_str = str(e).lower()
            if "429" in exc_str or "rate limit" in exc_str or "too many requests" in exc_str:
                if attempt < max_retries - 1:
                    wait_time = min(2 ** (attempt + 2) * 5, 120)  # longer backoff for rate limits
                    print(f"      ⏳ Rate limited attempt {attempt + 1}/{max_retries}, waiting {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    print(f"      ❌ Rate limited, failed after {max_retries} attempts")
                    return pd.DataFrame()
            else:
                print(f"      ❌ Error: {str(e)[:100]}")
                return pd.DataFrame()
    
    return pd.DataFrame()

def resume_player_stats(start_index: int = 171):
    """
    Resume fetching player stats from a specific index
    
    Args:
        start_index: Player index to start from (1-based, e.g., 171)
    """
    print("\n" + "="*70)
    print(f"🔄 RESUMING NBA PLAYER STATS FROM PLAYER #{start_index}")
    print("="*70)
    
    try:
        # Get team and game mappings
        print("\n📥 Loading mappings...")

        # Get NBA league_id dynamically
        league_response = supabase.table('leagues').select('id').eq('name', 'NBA').execute()
        if not league_response.data:
            raise ValueError("NBA league not found in DB. Run nba_init.py first.")
        league_id = league_response.data[0]['id']

        teams = supabase.table('teams')\
            .select('id, abbreviation')\
            .eq('league_id', league_id)\
            .execute()
        team_abbr_map = {team['abbreviation']: team['id'] for team in teams.data}

        games = supabase.table('games')\
            .select('id, ext_id')\
            .eq('league_id', league_id)\
            .execute()
        game_id_map = {game['ext_id']: game['id'] for game in games.data}
        
        players_response = supabase.table('players')\
            .select('id, ext_id')\
            .eq('league_id', league_id)\
            .execute()
        player_id_map = {player['ext_id']: player['id'] for player in players_response.data}
        
        print("✅ Mappings loaded")
        
        # Get active players
        active_players = nba_players_static.get_active_players()
        total_players = len(active_players)
        
        # Start from specified index (convert to 0-based)
        players_to_process = active_players[start_index - 1:]
        
        print(f"\n📊 Processing {len(players_to_process)} players (#{start_index} to #{total_players})")
        print(f"⏱️  Estimated time: {len(players_to_process) * 2 / 60:.1f} hours with slower rate\n")
        
        all_stats = []
        stats_inserted = 0
        failed_players = []
        
        for idx, player in enumerate(players_to_process, start_index):
            player_ext_id = str(player['id'])
            player_name = player['full_name']
            
            if player_ext_id not in player_id_map:
                print(f"  [{idx}/{total_players}] Skipping {player_name} (not in DB)")
                continue
            
            player_db_id = player_id_map[player_ext_id]
            
            print(f"\n  [{idx}/{total_players}] {player_name}")
            
            player_had_error = False
            
            for season in SEASONS:
                df = fetch_player_game_log_with_retry(player_ext_id, season)
                
                if df.empty:
                    print(f"    → {season}: No data")
                    continue
                
                print(f"    → {season}: {len(df)} games")
                
                for _, row in df.iterrows():
                    game_ext_id = str(row['Game_ID'])
                    
                    if game_ext_id not in game_id_map:
                        continue
                    
                    game_db_id = game_id_map[game_ext_id]
                    
                    # Parse team from MATCHUP
                    matchup = row.get('MATCHUP', '')
                    team_abbr = None
                    
                    if ' vs. ' in matchup or ' @ ' in matchup:
                        team_abbr = matchup.split()[0]
                    
                    if not team_abbr:
                        team_abbr = row.get('TEAM_ABBREVIATION', '')
                    
                    team_db_id = team_abbr_map.get(team_abbr)
                    
                    # Parse minutes
                    minutes_played = 0
                    if pd.notna(row.get('MIN')):
                        try:
                            min_str = str(row['MIN'])
                            if ':' in min_str:
                                mins, secs = min_str.split(':')
                                minutes_played = int(mins)
                            else:
                                minutes_played = int(float(min_str))
                        except:
                            minutes_played = 0

                    game_date_raw = row.get('GAME_DATE', None)
                    game_date = None
                    if pd.notna(game_date_raw):
                        try:
                            game_date = str(pd.to_datetime(game_date_raw).date())
                        except Exception:
                            game_date = None

                    stat_record = {
                        'game_id': game_db_id,
                        'player_id': player_db_id,
                        'team_id': team_db_id,
                        'points': int(row.get('PTS', 0) or 0),
                        'rebounds': int(row.get('REB', 0) or 0),
                        'assists': int(row.get('AST', 0) or 0),
                        'three_points_made': int(row.get('FG3M', 0) or 0),
                        'fouls': int(row.get('PF', 0) or 0),
                        'minutes_played': minutes_played,
                        'game_date': game_date,
                    }
                    all_stats.append(stat_record)
            
            # Insert in batches of 500
            if len(all_stats) >= 500:
                print(f"\n    💾 Inserting batch of {len(all_stats)} stats...")
                try:
                    supabase.table('nba_player_stats').upsert(
                        all_stats,
                        on_conflict='game_id,player_id'
                    ).execute()
                    stats_inserted += len(all_stats)
                    all_stats = []
                except Exception as e:
                    print(f"    ❌ Error inserting batch: {e}")
            
            # Take a break every 20 players
            if (idx - start_index + 1) % 20 == 0:
                print(f"\n  😴 Taking a 60-second break... (Progress: {idx}/{total_players})")
                time.sleep(60)
        
        # Insert remaining stats
        if all_stats:
            print(f"\n  💾 Inserting final batch of {len(all_stats)} stats...")
            try:
                supabase.table('nba_player_stats').upsert(
                    all_stats,
                    on_conflict='game_id,player_id'
                ).execute()
                stats_inserted += len(all_stats)
            except Exception as e:
                print(f"  ❌ Error inserting final batch: {e}")
        
        print("\n" + "="*70)
        print(f"✅ RESUME COMPLETE!")
        print(f"📊 Inserted {stats_inserted} total stats")
        if failed_players:
            print(f"⚠️  {len(failed_players)} players had errors")
        print("="*70)
    
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    import sys
    
    # Default to player 171, or pass as argument
    start_idx = 171
    if len(sys.argv) > 1:
        start_idx = int(sys.argv[1])
    
    print(f"\n🎯 Starting from player #{start_idx}")
    print("💡 To start from a different player, run: python scripts/resume_nba_stats.py <player_number>")
    
    response = input(f"\nContinue from player #{start_idx}? (yes/no): ")
    if response.lower() not in ['yes', 'y']:
        print("Cancelled.")
        exit()
    
    resume_player_stats(start_index=start_idx)