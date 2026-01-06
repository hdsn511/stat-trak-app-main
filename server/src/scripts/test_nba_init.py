"""
Simple test runner for NBA data initialization
"""
import sys
import os

# Add parent directory to path so we can import from etl
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from nba_init import fetch_nba_data

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
        sys.exit(1)