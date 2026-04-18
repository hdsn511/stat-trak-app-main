-- SportQuery schema: read-only role, flattened matchup view, session storage
-- Apply via Supabase SQL editor or mcp apply_migration.

-- 1. Read-only role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportquery_reader') THEN
    CREATE ROLE sportquery_reader NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sportquery_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sportquery_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO sportquery_reader;

-- 2. Flattened home/away matchup view
CREATE OR REPLACE VIEW game_matchups AS
SELECT
  g.id           AS game_id,
  g.ext_id       AS game_ext_id,
  g.game_date,
  g.season,
  g.home_team_id AS team_id,
  g.away_team_id AS opponent_team_id,
  TRUE           AS is_home
FROM games g
UNION ALL
SELECT
  g.id, g.ext_id, g.game_date, g.season,
  g.away_team_id, g.home_team_id, FALSE
FROM games g;

GRANT SELECT ON game_matchups TO sportquery_reader;

-- 3. Session storage
CREATE TABLE IF NOT EXISTS sportquery_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'local',
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sportquery_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sportquery_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sql_executed TEXT,
  result_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sportquery_messages_session
  ON sportquery_messages(session_id, created_at);
