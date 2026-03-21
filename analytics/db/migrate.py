#!/usr/bin/env python3
"""
Migration reference script for analytics database tables.

This script documents all table schemas and provides utilities to:
1. Print SQL statements for manual execution
2. Verify that all tables exist in the database
3. Serve as documentation of the analytics data model

Note: Actual migrations have been applied via Supabase MCP.
This file is for reference, verification, and documentation only.

Usage:
    python migrate.py                # Print SQL statements
    python migrate.py --print-sql    # Print SQL statements
    python migrate.py --verify       # Verify all tables exist
"""

import sys
from analytics.db.connection import supabase


# All CREATE TABLE statements (exactly as specified)
CREATE_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS player_game_conditions (
        id BIGSERIAL PRIMARY KEY, player_id BIGINT REFERENCES players(id),
        game_id BIGINT REFERENCES games(id), game_date DATE NOT NULL,
        usg_pct REAL, pace REAL, off_rating REAL, def_rating REAL,
        home_away VARCHAR(4), days_rest INTEGER,
        opponent_team_id BIGINT REFERENCES teams(id), minutes_played INTEGER,
        UNIQUE(player_id, game_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS team_game_stats (
        id BIGSERIAL PRIMARY KEY, team_id BIGINT REFERENCES teams(id),
        game_id BIGINT REFERENCES games(id), game_date DATE NOT NULL,
        pace REAL, off_rating REAL, def_rating REAL,
        UNIQUE(team_id, game_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS opponent_position_defense (
        id BIGSERIAL PRIMARY KEY, team_id BIGINT REFERENCES teams(id),
        position_group VARCHAR(1), snapshot_date DATE NOT NULL,
        pts_allowed_pg REAL, reb_allowed_pg REAL, ast_allowed_pg REAL,
        league_rank INTEGER,
        UNIQUE(team_id, position_group, snapshot_date)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS player_availability (
        id BIGSERIAL PRIMARY KEY, player_id BIGINT REFERENCES players(id),
        game_id BIGINT REFERENCES games(id), status VARCHAR(8),
        UNIQUE(player_id, game_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_conditions (
        id BIGSERIAL PRIMARY KEY, player_id BIGINT REFERENCES players(id),
        game_id BIGINT REFERENCES games(id), game_date DATE NOT NULL,
        rolling_usg_5g REAL, rolling_pts_5g REAL, rolling_reb_5g REAL,
        rolling_ast_5g REAL, rolling_fg3m_5g REAL, rolling_min_5g REAL,
        rolling_pace_5g REAL, season_avg_usg REAL, days_rest INTEGER,
        home_away VARCHAR(4), opponent_team_id BIGINT REFERENCES teams(id),
        opp_def_rank_position INTEGER, position_group VARCHAR(1),
        UNIQUE(player_id, game_date)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_lines (
        id BIGSERIAL PRIMARY KEY, game_date DATE NOT NULL,
        prop_type VARCHAR(16), entity_id BIGINT,
        stat VARCHAR(16), line REAL, kalshi_price REAL, implied_prob REAL,
        market_ticker VARCHAR(128), is_first_half BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS pick_results (
        id BIGSERIAL PRIMARY KEY, game_date DATE NOT NULL,
        prop_type VARCHAR(16), entity_id BIGINT, stat VARCHAR(16),
        pick_type VARCHAR(8), recommended_line REAL, hit_rate REAL,
        sample_size INTEGER, confidence_score REAL, implied_prob REAL,
        edge REAL, conditions_matched INTEGER, total_conditions INTEGER,
        key_conditions JSONB, alt_lines_tested JSONB,
        actual_result REAL, did_hit BOOLEAN,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
]

# All CREATE INDEX statements
CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_player_game_conditions_player_id ON player_game_conditions(player_id);",
    "CREATE INDEX IF NOT EXISTS idx_player_game_conditions_game_date ON player_game_conditions(game_date);",
    "CREATE INDEX IF NOT EXISTS idx_team_game_stats_team_id ON team_game_stats(team_id);",
    "CREATE INDEX IF NOT EXISTS idx_team_game_stats_game_date ON team_game_stats(game_date);",
    "CREATE INDEX IF NOT EXISTS idx_opponent_position_defense_team_id ON opponent_position_defense(team_id);",
    "CREATE INDEX IF NOT EXISTS idx_daily_conditions_player_id ON daily_conditions(player_id);",
    "CREATE INDEX IF NOT EXISTS idx_daily_conditions_game_date ON daily_conditions(game_date);",
    "CREATE INDEX IF NOT EXISTS idx_daily_lines_game_date ON daily_lines(game_date);",
    "CREATE INDEX IF NOT EXISTS idx_pick_results_game_date ON pick_results(game_date);",
]

# Table names for verification
TABLE_NAMES = [
    "player_game_conditions",
    "team_game_stats",
    "opponent_position_defense",
    "player_availability",
    "daily_conditions",
    "daily_lines",
    "pick_results",
]


def print_sql():
    """Print all SQL statements for reference."""
    print("=" * 80)
    print("CREATE TABLE STATEMENTS")
    print("=" * 80)
    for sql in CREATE_TABLES:
        print(sql.strip())
        print()

    print("=" * 80)
    print("CREATE INDEX STATEMENTS")
    print("=" * 80)
    for sql in CREATE_INDEXES:
        print(sql)
    print()


def verify_tables():
    """Verify that all required tables exist in the database."""
    print("Verifying database tables...")
    print()

    all_exist = True
    for table_name in TABLE_NAMES:
        try:
            # Try to query the table metadata
            result = supabase.table(table_name).select("*").limit(0).execute()
            print(f"  OK  {table_name:<35} exists")
        except Exception as e:
            print(f"  MISSING  {table_name:<35} - {str(e)}")
            all_exist = False

    print()
    if all_exist:
        print("All tables verified successfully!")
        return 0
    else:
        print("Some tables are missing. Please run migrations.")
        return 1


def main():
    """Main entry point."""
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg == "--print-sql":
            print_sql()
        elif arg == "--verify":
            return verify_tables()
        else:
            print(f"Unknown option: {arg}")
            print("Usage: python migrate.py [--print-sql] [--verify]")
            return 1
    else:
        # Default: print SQL
        print_sql()
        return 0


if __name__ == "__main__":
    sys.exit(main())
