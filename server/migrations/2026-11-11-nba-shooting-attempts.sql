-- NBA shooting volume: FGM/FGA/3PA (three_points_made already exists). NULL = not yet backfilled.
ALTER TABLE nba_player_stats ADD COLUMN IF NOT EXISTS field_goals_made integer;
ALTER TABLE nba_player_stats ADD COLUMN IF NOT EXISTS field_goals_attempted integer;
ALTER TABLE nba_player_stats ADD COLUMN IF NOT EXISTS three_points_attempted integer;
