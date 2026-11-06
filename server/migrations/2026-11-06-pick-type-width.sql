-- pick_type was varchar(8), so the card snapshots ('sugg_trending', 'sugg_streak')
-- were rejected on insert and Trending / Streak Watch never got a record.
ALTER TABLE pick_results ALTER COLUMN pick_type TYPE varchar(24);
