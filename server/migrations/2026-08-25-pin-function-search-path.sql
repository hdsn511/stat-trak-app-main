-- parse_kalshi_date had a mutable search_path (Supabase security linter WARN):
-- without an explicit one, an unqualified identifier's resolution depends on
-- the caller's search_path, which a malicious caller could manipulate to
-- shadow a built-in. The function only calls built-ins (make_date, substring),
-- so pinning to empty is safe — no public-schema object needs to resolve.
--
-- Already applied to the hosted project; kept here so a fresh database can be
-- built from server/migrations alone.

ALTER FUNCTION public.parse_kalshi_date(text) SET search_path = '';
