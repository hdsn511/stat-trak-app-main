"""
NBA data scraper using official nba_api package
https://github.com/swar/nba_api
Fetches data for last 3 seasons and populates database schema
"""
import os
from dotenv import load_dotenv
from supabase import create_client
from nba_api.stats.static import players as nba_players_static
from nba_api.stats.static import teams as nba_teams_static
from nba_api.stats.endpoints import (
    playergamelog,
    leaguegamefinder,
    commonteamroster
)
import pandas as pd
import time
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Supabase client directly
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env file")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# NBA seasons to fetch (last 3 seasons)
SEASONS = ['2022-23', '2023-24', '2024-25']
NBA_SPORT_CODE = 1  # As per your schema: 1 = NBA

# ... rest of your functions stay the same ...

def get_or_create_league() -> int:
    """
    Ensure NBA league exists in leagues table
    Returns the league_id
    """
    print("\n🏀 Setting up NBA league...")
    
    try:
        # Check if NBA league exists
        response = supabase.table('leagues').select('id').eq('name', 'NBA').execute()
        
        if response.data and len(response.data) > 0:
            league_id = response.data[0]['id']
            print(f"  ✅ NBA league already exists (id: {league_id})")
            return league_id
        
        # Create NBA league
        league_data = {
            'name': 'NBA',
            'sport': NBA_SPORT_CODE
        }
        response = supabase.table('leagues').insert(league_data).execute()
        league_id = response.data[0]['id']
        print(f"  ✅ Created NBA league (id: {league_id})")
        return league_id
    
    except Exception as e:
        print(f"  ❌ Error setting up league: {e}")
        raise

def fetch_and_insert_teams(league_id: int) -> dict:
    """
    Fetch all NBA teams using nba_api.stats.static.teams
    Returns mapping of ext_id -> db_id
    """
    print("\n🏀 Fetching NBA teams...")
    
    try:
        # Use nba_api static teams
        all_teams = nba_teams_static.get_teams()
        
        team_data = []
        for team in all_teams:
            team_record = {
                'league_id': league_id,
                'ext_id': str(team['id']),
                'name': team['full_name'],
                'abbreviation': team['abbreviation'],
                'city': team['city']
            }
            team_data.append(team_record)
        
        print(f"  📥 Found {len(team_data)} NBA teams")
        
        # Upsert teams
        supabase.table('teams').upsert(team_data, on_conflict='league_id, ext_id').execute()
        
        # Fetch back to get DB IDs
        response = supabase.table('teams')\
            .select('id, ext_id, abbreviation')\
            .eq('league_id', league_id)\
            .execute()
        
        team_id_map = {team['ext_id']: team['id'] for team in response.data}
        team_abbr_map = {team['abbreviation']: team['id'] for team in response.data}
        
        print(f"  ✅ Upserted {len(team_data)} teams")
        return team_id_map, team_abbr_map
    
    except Exception as e:
        print(f"  ❌ Error fetching teams: {e}")
        raise

def fetch_and_insert_players(league_id: int) -> dict:
    """
    Fetch all NBA players using nba_api.stats.static.players
    Returns mapping of ext_id -> db_id
    """
    print("\n🏀 Fetching NBA players...")
    
    try:
        # Use nba_api static players (gets all players, active and inactive)
        all_players = nba_players_static.get_active_players()
        
        player_data = []
        for player in all_players:
            player_record = {
                'league_id': league_id,
                'ext_id': str(player['id']),
                'name': player['full_name'],
                'league': 'nba',
                'is_active': True,
            }
            player_data.append(player_record)
        
        print(f"  📥 Found {len(player_data)} NBA players")
        
        # Insert in batches (500 at a time)
        batch_size = 500
        for i in range(0, len(player_data), batch_size):
            batch = player_data[i:i + batch_size]
            supabase.table('players').upsert(batch, on_conflict='league_id, ext_id').execute()
            print(f"    → Inserted {min(i + batch_size, len(player_data))}/{len(player_data)}")
        
        # Fetch back to get DB IDs
        response = supabase.table('players')\
            .select('id, ext_id, name')\
            .eq('league_id', league_id)\
            .execute()
        
        player_id_map = {player['ext_id']: player['id'] for player in response.data}
        
        print(f"  ✅ Processed {len(player_data)} players")
        return player_id_map
    
    except Exception as e:
        print(f"  ❌ Error fetching players: {e}")
        raise

def fetch_and_insert_rosters(
    league_id: int,
    team_id_map: dict,
    player_id_map: dict,
    team_abbr_map: dict
):
    """
    Fetch team rosters for each season using commonteamroster endpoint
    """
    print("\n🏀 Fetching NBA rosters for last 3 seasons...")
    
    try:
        all_rosters = []
        
        for season in SEASONS:
            season_year = int(season.split('-')[0])
            print(f"\n  📅 Season {season} (year: {season_year})")
            
            for team_ext_id, team_db_id in team_id_map.items():
                try:
                    # Rate limiting
                    time.sleep(0.6)
                    
                    # Use commonteamroster endpoint
                    roster = commonteamroster.CommonTeamRoster(
                        team_id=team_ext_id,
                        season=season
                    )
                    df = roster.get_data_frames()[0]
                    
                    if df.empty:
                        continue
                    
                    # Get team abbreviation for logging
                    team_abbr = [k for k, v in team_id_map.items() if v == team_db_id]
                    print(f"    → Team {team_ext_id}: {len(df)} players")
                    
                    for _, row in df.iterrows():
                        player_ext_id = str(row['PLAYER_ID'])
                        
                        if player_ext_id in player_id_map:
                            roster_record = {
                                'season': season_year,
                                'team_id': team_db_id,
                                'player_id': player_id_map[player_ext_id]
                            }
                            all_rosters.append(roster_record)

                            # Back-fill position and team on player row
                            position = str(row.get('POSITION', '') or '').strip()
                            team_abbr = next(
                                (abbr for abbr, tid in team_abbr_map.items() if tid == team_db_id),
                                None
                            )
                            if position or team_abbr:
                                update_payload = {}
                                if position:
                                    update_payload['position'] = position
                                if team_abbr:
                                    update_payload['team'] = team_abbr
                                supabase.table('players').update(update_payload).eq(
                                    'id', player_id_map[player_ext_id]
                                ).execute()

                except Exception as e:
                    print(f"    ⚠️  Error fetching roster for team {team_ext_id}: {e}")
                    continue
        
        # Insert all rosters
        if all_rosters:
            print(f"\n  💾 Inserting {len(all_rosters)} roster entries...")
            batch_size = 500
            for i in range(0, len(all_rosters), batch_size):
                batch = all_rosters[i:i + batch_size]
                supabase.table('rosters').upsert(batch, on_conflict='season, team_id, player_id').execute()
                print(f"    → Inserted {min(i + batch_size, len(all_rosters))}/{len(all_rosters)}")
        
        print(f"  ✅ Processed {len(all_rosters)} roster entries")
    
    except Exception as e:
        print(f"  ❌ Error fetching rosters: {e}")
        raise

def fetch_and_insert_games(
    league_id: int,
    team_abbr_map: dict
) -> dict:
    """
    Fetch all games using leaguegamefinder endpoint
    Returns mapping of game ext_id -> db_id
    """
    print("\n🏀 Fetching NBA games for last 3 seasons...")
    
    try:
        all_games = []
        
        for season in SEASONS:
            season_year = int(season.split('-')[0])
            print(f"\n  📅 Fetching games for season {season}...")
            
            # Rate limiting
            time.sleep(0.6)
            
            # Use leaguegamefinder endpoint
            gamefinder = leaguegamefinder.LeagueGameFinder(
                season_nullable=season,
                league_id_nullable='00'  # NBA league ID
            )
            games_df = gamefinder.get_data_frames()[0]
            
            # Each game appears twice (once per team), so deduplicate
            unique_games = games_df.drop_duplicates(subset=['GAME_ID'])
            
            print(f"    → Found {len(unique_games)} unique games")
            
            for _, game in unique_games.iterrows():
                game_ext_id = str(game['GAME_ID'])
                game_date = pd.to_datetime(game['GAME_DATE']).date()
                matchup = game['MATCHUP']
                
                # Parse matchup: "TEAM @ OPPONENT" or "TEAM vs. OPPONENT"
                if ' @ ' in matchup:
                    # Away game
                    away_abbr = matchup.split(' @ ')[0]
                    home_abbr = matchup.split(' @ ')[1]
                elif ' vs. ' in matchup:
                    # Home game
                    home_abbr = matchup.split(' vs. ')[0]
                    away_abbr = matchup.split(' vs. ')[1]
                else:
                    print(f"    ⚠️  Could not parse matchup: {matchup}")
                    continue
                
                # Get team IDs from abbreviation map
                home_team_id = team_abbr_map.get(home_abbr)
                away_team_id = team_abbr_map.get(away_abbr)
                
                if not home_team_id or not away_team_id:
                    print(f"    ⚠️  Could not find teams: {home_abbr} vs {away_abbr}")
                    continue
                
                # Get scores from both team entries
                game_data = games_df[games_df['GAME_ID'] == game_ext_id]
                home_score = None
                away_score = None
                
                for _, team_game in game_data.iterrows():
                    pts = team_game['PTS']
                    wl = team_game['WL']
                    team_abbr = team_game['TEAM_ABBREVIATION']
                    
                    if team_abbr == home_abbr:
                        home_score = int(pts) if pd.notna(pts) else None
                    elif team_abbr == away_abbr:
                        away_score = int(pts) if pd.notna(pts) else None
                
                game_record = {
                    'league_id': league_id,
                    'season': season_year,
                    'game_date': str(game_date),
                    'home_team_id': home_team_id,
                    'away_team_id': away_team_id,
                    'home_score': home_score,
                    'away_score': away_score,
                    'status': 1 if home_score is not None else 0,
                    'ext_id': game_ext_id
                }
                all_games.append(game_record)
        
        # Insert games
        if all_games:
            print(f"\n  💾 Inserting {len(all_games)} games...")
            batch_size = 500
            for i in range(0, len(all_games), batch_size):
                batch = all_games[i:i + batch_size]
                supabase.table('games').upsert(batch, on_conflict='league_id, ext_id').execute()
                print(f"    → Inserted {min(i + batch_size, len(all_games))}/{len(all_games)}")
        
        # Fetch back to get DB IDs
        response = supabase.table('games')\
            .select('id, ext_id')\
            .eq('league_id', league_id)\
            .execute()
        
        game_id_map = {game['ext_id']: game['id'] for game in response.data}
        
        print(f"  ✅ Processed {len(all_games)} games")
        return game_id_map
    
    except Exception as e:
        print(f"  ❌ Error fetching games: {e}")
        raise

def fetch_and_insert_player_stats(
    league_id: int,
    player_id_map: dict,
    team_abbr_map: dict,
    game_id_map: dict,
    test_mode: bool = False
):
    """
    Fetch player game stats using playergamelog endpoint
    """
    print("\n🏀 Fetching NBA player game stats...")
    
    try:
        # Get active players for recent seasons
        active_players = nba_players_static.get_active_players()
        
        if test_mode:
            active_players = active_players[:10]
            print(f"  🧪 TEST MODE: Processing only {len(active_players)} players")
        
        total_players = len(active_players)
        all_stats = []
        stats_inserted = 0
        
        for idx, player in enumerate(active_players, 1):
            player_ext_id = str(player['id'])
            player_name = player['full_name']
            
            if player_ext_id not in player_id_map:
                print(f"  [{idx}/{total_players}] Skipping {player_name} (not in DB)")
                continue
            
            player_db_id = player_id_map[player_ext_id]
            
            print(f"\n  [{idx}/{total_players}] {player_name}")
            
            for season in SEASONS:
                try:
                    # Rate limiting
                    time.sleep(0.6)
                    
                    # Use playergamelog endpoint
                    gamelog = playergamelog.PlayerGameLog(
                        player_id=player_ext_id,
                        season=season,
                        season_type_all_star='Regular Season'
                    )
                    df = gamelog.get_data_frames()[0]
                    
                    if df.empty:
                        print(f"    → {season}: No data")
                        continue
                    
                    print(f"    → {season}: {len(df)} games")
                    
                    for _, row in df.iterrows():
                        game_ext_id = str(row['Game_ID'])
                        
                        if game_ext_id not in game_id_map:
                            continue
                        
                        game_db_id = game_id_map[game_ext_id]
                        
                        # CHANGED: Parse team from MATCHUP instead of TEAM_ABBREVIATION
                        matchup = row.get('MATCHUP', '')
                        team_abbr = None
    
                        # Format: "LAL vs. BOS" or "LAL @ BOS"
                        if ' vs. ' in matchup or ' @ ' in matchup:
                            team_abbr = matchup.split()[0]  # First part is always the team
    
                        # Fallback to TEAM_ABBREVIATION if available
                        if not team_abbr:
                            team_abbr = row.get('TEAM_ABBREVIATION', '')


                        team_db_id = team_abbr_map.get(team_abbr)
                        
                        # Parse minutes (format: "MM:SS" or sometimes just a number)
                        minutes_played = 0
                        if pd.notna(row.get('MIN')):
                            try:
                                min_str = str(row['MIN'])
                                if ':' in min_str:
                                    mins, secs = min_str.split(':')
                                    minutes_played = int(mins)
                                else:
                                    # Sometimes it's just a float
                                    minutes_played = int(float(min_str))
                            except:
                                minutes_played = 0
                        
                        stat_record = {
                            'game_id': game_db_id,
                            'player_id': player_db_id,
                            'team_id': team_db_id,
                            'points': int(row.get('PTS', 0) or 0),
                            'rebounds': int(row.get('REB', 0) or 0),
                            'assists': int(row.get('AST', 0) or 0),
                            'three_points_made': int(row.get('FG3M', 0) or 0),
                            'fouls': int(row.get('PF', 0) or 0),
                            'minutes': minutes_played
                        }
                        all_stats.append(stat_record)
                    
                except Exception as e:
                    print(f"    ⚠️  Error fetching {season}: {e}")
                    continue
            
            # Insert in batches of 1000
            if len(all_stats) >= 1000:
                print(f"\n    💾 Inserting batch of {len(all_stats)} stats...")
                supabase.table('nba_player_stats').upsert(all_stats, on_conflict='game_id, player_id').execute()
                stats_inserted += len(all_stats)
                all_stats = []
        
        # Insert remaining stats
        if all_stats:
            print(f"\n  💾 Inserting final batch of {len(all_stats)} stats...")
            supabase.table('nba_player_stats').upsert(all_stats, on_conflict='game_id, player_id').execute()
            stats_inserted += len(all_stats)
        
        print(f"\n  ✅ Inserted {stats_inserted} total player game stats")
    
    except Exception as e:
        print(f"  ❌ Error fetching player stats: {e}")
        raise

def fetch_nba_data(test_mode: bool = False):
    """
    Main orchestration function for NBA data fetch
    """
    print("\n" + "="*70)
    print("🏀 NBA DATA FETCH STARTED")
    print("="*70)
    
    try:
        # Step 1: Setup league
        league_id = get_or_create_league()
        
        # Step 2: Fetch and insert teams
        team_id_map, team_abbr_map = fetch_and_insert_teams(league_id)
        
        # Step 3: Fetch and insert players
        player_id_map = fetch_and_insert_players(league_id)
        
        # Step 4: Fetch and insert rosters
        fetch_and_insert_rosters(league_id, team_id_map, player_id_map, team_abbr_map)
        
        # Step 5: Fetch and insert games
        game_id_map = fetch_and_insert_games(league_id, team_abbr_map)
        
        # Step 6: Fetch and insert player stats
        fetch_and_insert_player_stats(
            league_id,
            player_id_map,
            team_abbr_map,
            game_id_map,
            test_mode=test_mode
        )
        
        print("\n" + "="*70)
        print("✅ NBA DATA FETCH COMPLETE!")
        print("="*70)
    
    except Exception as e:
        print(f"\n❌ NBA data fetch failed: {e}")
        import traceback
        traceback.print_exc()
        raise

# For standalone testing
if __name__ == "__main__":
    print("\n🧪 Running NBA data fetch in TEST MODE (10 players only)...")
    print("="*70 + "\n")
    
    try:
        fetch_nba_data(test_mode=True)
        print("\n✅ Test completed successfully!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()