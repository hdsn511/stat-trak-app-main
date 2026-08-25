-- Enables Row Level Security on every public table and grants sportquery_reader
-- (the read-only role SportQuery's generated SQL runs as) an equivalent SELECT
-- policy, so RLS doesn't silently zero out the assistant's results. anon and
-- authenticated get no policy at all — that's the actual fix, since neither the
-- client nor the server ever authenticates as either; only service_role
-- (bypasses RLS by default) and sportquery_reader touch this database.
--
-- Already applied to the hosted project; kept here so a fresh database can be
-- built from server/migrations alone.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'leagues','teams','players','rosters','games',
    'nba_player_stats','nba_trends','player_game_conditions','team_game_stats',
    'opponent_position_defense','player_availability','daily_conditions','daily_lines',
    'pick_results','sportquery_sessions','sportquery_messages','game_narratives',
    'mlb_player_stats','mlb_player_game_conditions','mlb_daily_conditions','mlb_trends',
    'mlb_park_factors','mlb_pitcher_quality','nfl_player_stats','nhl_player_stats',
    'nfl_trends','nhl_trends','team_standings'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'sportquery_reader_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY sportquery_reader_select ON public.%I FOR SELECT TO sportquery_reader USING (true)',
        t
      );
    END IF;
  END LOOP;
END
$$;

-- game_matchups is SECURITY DEFINER by default (runs as the view's creator,
-- not the querying role). With RLS now on `games`, the view must run as the
-- caller so sportquery_reader's new policy on `games` actually applies.
ALTER VIEW public.game_matchups SET (security_invoker = on);
