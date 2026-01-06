"""
Full runner for NBA data initialization
"""
import sys
import os

# Add parent directory to path so we can import from etl
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from nba_init import fetch_nba_data

if __name__ == "__main__":
    print("\n🏀 Running FULL NBA data fetch...")
    print("⚠️  WARNING: This will take 4-6 hours!\n")
    
    response = input("Continue? (yes/no): ")
    if response.lower() not in ['yes', 'y']:
        print("Cancelled.")
        sys.exit(0)
    
    print("\n" + "="*70 + "\n")
    
    try:
        fetch_nba_data(test_mode=False)
        print("\n✅ Full ETL completed successfully!")
    except Exception as e:
        print(f"\n❌ ETL failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)