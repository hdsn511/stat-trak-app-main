-- Garbage-time tracking (NFL + NBA). One row per scanned game, flagged or not,
-- so the nightly pass can skip games it already evaluated. Player rows are
-- sparse: only players with a non-zero stat inside a flagged window.
--
-- Rule (see analytics/data/garbage_time.py): 4th-quarter plays where the team
-- that ultimately WINS leads by >= threshold (NFL 17, NBA 20; NBA also needs a
-- final margin >= 15). A blown lead is never garbage time.

CREATE TABLE IF NOT EXISTS public.game_garbage_time (
  game_id        bigint PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  league_id      bigint NOT NULL,
  is_garbage     boolean NOT NULL,
  leader_team_id bigint REFERENCES public.teams(id),
  threshold      smallint,
  start_period   smallint,
  start_clock    text,
  lead_at_start  smallint,
  final_margin   smallint,
  n_plays        integer,
  computed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.player_garbage_stats (
  game_id    bigint NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id  bigint NOT NULL REFERENCES public.players(id),
  league_id  bigint NOT NULL,
  stats      jsonb NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS player_garbage_stats_player_idx
  ON public.player_garbage_stats (player_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_garbage_time','player_garbage_stats'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY sportquery_reader_select ON public.%I FOR SELECT TO sportquery_reader USING (true)', t);
  END LOOP;
END
$$;
