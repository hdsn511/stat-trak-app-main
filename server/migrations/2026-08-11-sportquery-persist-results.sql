-- Persist an assistant turn's result set alongside its narrative, so reopening
-- a SportQuery session rehydrates its result cards instead of showing bare
-- prose. Additive and idempotent.
--
-- Already applied to the hosted project as migration
-- `sportquery_messages_persist_results`; kept here so a fresh database can be
-- built from server/migrations alone.

ALTER TABLE public.sportquery_messages
  ADD COLUMN IF NOT EXISTS result_rows JSONB,
  ADD COLUMN IF NOT EXISTS result_shape TEXT;

COMMENT ON COLUMN public.sportquery_messages.result_rows IS
  'Enriched rows returned for this assistant turn. Null for turns that ran no SQL.';
COMMENT ON COLUMN public.sportquery_messages.result_shape IS
  'Shape detected for result_rows: player_trends | player_games | picks | lines | generic.';
