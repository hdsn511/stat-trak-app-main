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
        -- Player tracking signals from BoxScorePlayerTrackV3 (added in picks v2)
        touches FLOAT, front_court_touches FLOAT, time_of_possession FLOAT,
        paint_touches FLOAT, avg_speed FLOAT,
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
        fg3m_allowed_pg REAL,
        league_rank INTEGER, reb_rank INTEGER, ast_rank INTEGER, fg3m_rank INTEGER,
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
        opp_def_rank_position INTEGER, opp_reb_rank_position INTEGER,
        opp_ast_rank_position INTEGER, opp_fg3m_rank_position INTEGER,
        position_group VARCHAR(1),
        -- Picks v2: rolling/season touches & TOP, key teammates out, opp recent form
        rolling_touches_5g FLOAT, rolling_top_5g FLOAT,
        season_avg_touches FLOAT, season_avg_top FLOAT,
        key_teammates_out INT[] DEFAULT '{}',
        positional_sub_for INT,
        recent_opp_pts_form FLOAT, recent_opp_reb_form FLOAT,
        recent_opp_ast_form FLOAT, recent_opp_fg3m_form FLOAT,
        UNIQUE(player_id, game_date)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_lines (
        id BIGSERIAL PRIMARY KEY, game_date DATE NOT NULL,
        prop_type VARCHAR(16), entity_id BIGINT,
        stat VARCHAR(16), line REAL, kalshi_price REAL, implied_prob REAL,
        market_ticker VARCHAR(128), is_first_half BOOLEAN DEFAULT FALSE,
        -- Multi-sport: league_id distinguishes NBA (1) vs MLB (2) lines.
        league_id BIGINT,
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
        -- Picks v2: per-pick modifier breakdown (b2b, recent_opp_form, etc.)
        modifiers JSONB DEFAULT '{}'::JSONB,
        actual_result REAL, did_hit BOOLEAN,
        -- Multi-sport: league_id distinguishes NBA (1) vs MLB (2) picks.
        league_id BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
]

# ── MLB tables (multi-sport build-out) ─────────────────────────────────────────
# Parallel to the NBA tables above; the analytics engine reuses the same
# condition->backtest->score method with MLB-specific stats and conditions.
# Applied via Supabase migration `mlb_schema_phase1`.
CREATE_TABLES_MLB = [
    """
    CREATE TABLE IF NOT EXISTS mlb_player_stats (
        game_id BIGINT REFERENCES games(id),
        player_id BIGINT REFERENCES players(id),
        team_id BIGINT REFERENCES teams(id), game_date DATE NOT NULL,
        -- batting
        at_bats SMALLINT, hits SMALLINT, doubles SMALLINT, triples SMALLINT,
        home_runs SMALLINT, rbi SMALLINT, runs SMALLINT, walks SMALLINT,
        strikeouts SMALLINT, stolen_bases SMALLINT, total_bases SMALLINT,
        hit_by_pitch SMALLINT, plate_appearances SMALLINT,
        -- pitching (NULL for non-pitchers); outs_pitched avoids IP .1/.2 fractions
        outs_pitched SMALLINT, earned_runs SMALLINT, strikeouts_pitched SMALLINT,
        walks_allowed SMALLINT, hits_allowed SMALLINT, home_runs_allowed SMALLINT,
        batters_faced SMALLINT,
        PRIMARY KEY (game_id, player_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS mlb_player_game_conditions (
        id BIGSERIAL PRIMARY KEY,
        player_id BIGINT REFERENCES players(id),
        game_id BIGINT REFERENCES games(id), game_date DATE NOT NULL,
        home_away VARCHAR(4), days_rest INTEGER,
        opponent_team_id BIGINT REFERENCES teams(id),
        batting_order_slot SMALLINT, plate_appearances SMALLINT,
        opp_starter_id BIGINT REFERENCES players(id), opp_starter_hand VARCHAR(1),
        opp_starter_quality REAL, park_factor REAL,
        UNIQUE(player_id, game_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS mlb_daily_conditions (
        id BIGSERIAL PRIMARY KEY,
        player_id BIGINT REFERENCES players(id),
        game_id BIGINT REFERENCES games(id), game_date DATE NOT NULL,
        home_away VARCHAR(4), days_rest INTEGER,
        opponent_team_id BIGINT REFERENCES teams(id), batting_order_slot SMALLINT,
        rolling_hits_5g REAL, rolling_tb_5g REAL, rolling_rbi_5g REAL,
        rolling_runs_5g REAL, rolling_hr_5g REAL, rolling_pa_5g REAL,
        rolling_k_pitched_5g REAL, rolling_outs_5g REAL,
        season_avg_hits REAL, season_avg_tb REAL, season_avg_rbi REAL,
        season_avg_runs REAL, season_avg_hr REAL, season_avg_pa REAL,
        season_avg_k_pitched REAL,
        opp_starter_id BIGINT REFERENCES players(id), opp_starter_hand VARCHAR(1),
        opp_starter_quality_rank INTEGER, opp_bullpen_quality_rank INTEGER,
        park_factor REAL, vs_lhp_avg REAL, vs_rhp_avg REAL,
        recent_opp_k_form REAL, recent_opp_runs_form REAL, recent_opp_hits_form REAL,
        UNIQUE(player_id, game_date)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS mlb_trends (
        player_id BIGINT REFERENCES players(id),
        stat SMALLINT, window_size SMALLINT,
        trend_val REAL, rolling_avg REAL, season_avg REAL, season_std REAL,
        computed_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (player_id, stat, window_size)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS mlb_park_factors (
        team_id BIGINT REFERENCES teams(id), season SMALLINT NOT NULL,
        factor_runs REAL, factor_hr REAL,
        PRIMARY KEY (team_id, season)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS mlb_pitcher_quality (
        id BIGSERIAL PRIMARY KEY,
        player_id BIGINT REFERENCES players(id),
        team_id BIGINT REFERENCES teams(id), snapshot_date DATE NOT NULL,
        role VARCHAR(8), era REAL, fip REAL, k_per9 REAL, whip REAL,
        quality_rank INTEGER,
        UNIQUE(player_id, snapshot_date)
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
    # MLB
    "CREATE INDEX IF NOT EXISTS idx_mlb_player_stats_player_id ON mlb_player_stats(player_id);",
    "CREATE INDEX IF NOT EXISTS idx_mlb_player_stats_game_date ON mlb_player_stats(game_date);",
    "CREATE INDEX IF NOT EXISTS idx_mlb_pgc_player_id ON mlb_player_game_conditions(player_id);",
    "CREATE INDEX IF NOT EXISTS idx_mlb_pgc_game_date ON mlb_player_game_conditions(game_date);",
    "CREATE INDEX IF NOT EXISTS idx_mlb_daily_conditions_player_id ON mlb_daily_conditions(player_id);",
    "CREATE INDEX IF NOT EXISTS idx_mlb_daily_conditions_game_date ON mlb_daily_conditions(game_date);",
    "CREATE INDEX IF NOT EXISTS idx_mlb_pitcher_quality_team ON mlb_pitcher_quality(team_id);",
    "CREATE INDEX IF NOT EXISTS idx_daily_lines_league ON daily_lines(league_id);",
    "CREATE INDEX IF NOT EXISTS idx_pick_results_league ON pick_results(league_id);",
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
    # MLB
    "mlb_player_stats",
    "mlb_player_game_conditions",
    "mlb_daily_conditions",
    "mlb_trends",
    "mlb_park_factors",
    "mlb_pitcher_quality",
]


def print_sql():
    """Print all SQL statements for reference."""
    print("=" * 80)
    print("CREATE TABLE STATEMENTS")
    print("=" * 80)
    for sql in CREATE_TABLES + CREATE_TABLES_MLB:
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
