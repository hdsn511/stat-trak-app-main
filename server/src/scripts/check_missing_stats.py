"""
Check which players are missing stats
"""
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("\n📊 Checking for missing player stats...\n")

# Get all players
players = supabase.table('players')\
    .select('id, name')\
    .eq('league_id', 1)\
    .execute()

players_with_stats = []
players_without_stats = []
players_low_stats = []

for player in players.data:
    stats = supabase.table('nba_player_stats')\
        .select('game_id', count='exact')\
        .eq('player_id', player['id'])\
        .execute()
    
    count = stats.count if stats.count else 0
    
    if count == 0:
        players_without_stats.append(player['name'])
    elif count < 50:
        players_low_stats.append((player['name'], count))
    else:
        players_with_stats.append((player['name'], count))

print(f"✅ Players with good data (50+ games): {len(players_with_stats)}")
print(f"⚠️  Players with low data (<50 games): {len(players_low_stats)}")
print(f"❌ Players with NO data: {len(players_without_stats)}")

if players_without_stats:
    print(f"\n❌ Players with NO stats ({len(players_without_stats)}):")
    for name in players_without_stats[:20]:  # Show first 20
        print(f"  - {name}")
    if len(players_without_stats) > 20:
        print(f"  ... and {len(players_without_stats) - 20} more")

if players_low_stats:
    print(f"\n⚠️  Players with LOW stats (<50 games):")
    for name, count in sorted(players_low_stats, key=lambda x: x[1])[:20]:
        print(f"  - {name}: {count} games")
    if len(players_low_stats) > 20:
        print(f"  ... and {len(players_low_stats) - 20} more")

print(f"\n📈 Data completeness: {len(players_with_stats)}/{len(players.data)} players ({len(players_with_stats)/len(players.data)*100:.1f}%)")