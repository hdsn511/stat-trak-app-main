-- Applied 2026-10-28.
--
-- sportquery_reader executes LLM-written SQL. It had SELECT (and an RLS policy
-- USING true) on the chat tables via the blanket GRANT in
-- 2026-04-17-sportquery-schema.sql, so any SQL that reached them — e.g. through
-- query_to_xml('select ... from sportquery_messages'), which the validator's
-- table allowlist cannot see inside a string — could read every visitor's
-- conversation. The app reads/writes these tables with the service role, never
-- through this role, so the grant served nothing.
--
-- NOTE: the schema migration's ALTER DEFAULT PRIVILEGES still grants SELECT on
-- every NEW public table to sportquery_reader. Any future table holding
-- per-user data needs the same REVOKE.

REVOKE ALL ON public.sportquery_messages, public.sportquery_sessions FROM sportquery_reader;
DROP POLICY IF EXISTS sportquery_reader_select ON public.sportquery_messages;
DROP POLICY IF EXISTS sportquery_reader_select ON public.sportquery_sessions;
