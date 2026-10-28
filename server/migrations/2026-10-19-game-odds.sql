-- One consensus pre-game line per game from ESPN's core odds API
-- (analytics/batch/odds_ingest.py). spread_home < 0 means the home team is
-- favored. Preferred book: DraftKings > ESPN BET > Caesars > any other
-- non-live book; median_spread_home is the median across all books.
-- Already applied to the hosted project.
CREATE TABLE IF NOT EXISTS public.game_odds (
  game_id          bigint PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  league_id        bigint NOT NULL,
  provider         text NOT NULL,
  n_books          smallint NOT NULL,
  spread_home      real,
  open_spread_home real,
  total            real,
  home_ml          integer,
  away_ml          integer,
  median_spread_home real,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_odds_league_idx ON public.game_odds (league_id);
ALTER TABLE public.game_odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY sportquery_reader_select ON public.game_odds FOR SELECT TO sportquery_reader USING (true);
