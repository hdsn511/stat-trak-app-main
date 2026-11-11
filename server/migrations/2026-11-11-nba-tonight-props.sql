-- nba_tonight_props: one row per (player on tonight's NBA slate) x (pts/reb/ast/fg3m),
-- with the main line and the evidence SportQuery needs pre-joined, so betting-style
-- questions become a filter + sort instead of a 50-line LLM-written query.
--
-- "Tonight" is the US Eastern date: CURRENT_DATE is UTC and rolls over at 7-8pm ET,
-- mid-slate. Main line = the ladder rung with implied_prob closest to 0.5.
-- Allowed-to-position comes from the latest opponent_position_defense snapshot
-- (refreshed nightly; per-game totals for the whole position group).
-- security_invoker so the view never widens what the querying role can read.

CREATE INDEX IF NOT EXISTS idx_nba_player_stats_player_date
  ON public.nba_player_stats (player_id, game_date DESC);

CREATE OR REPLACE VIEW public.nba_tonight_props WITH (security_invoker = true) AS
WITH d AS (
  SELECT (now() AT TIME ZONE 'America/New_York')::date AS today
), slate AS (
  SELECT dc.player_id, dc.game_id, dc.game_date, dc.opponent_team_id, dc.home_away,
         dc.days_rest, dc.position_group, dc.rolling_min_5g,
         COALESCE(array_length(dc.key_teammates_out, 1), 0) AS key_teammates_out
  FROM daily_conditions dc, d
  WHERE dc.game_date = d.today
), cur AS (
  SELECT MAX(season) AS season FROM games, d WHERE league_id = 1 AND game_date <= d.today
), recent AS (
  SELECT s.player_id, s.points, s.rebounds, s.assists, s.three_points_made,
         g.season = (SELECT season FROM cur) AS this_season,
         ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.game_date DESC) AS rn
  FROM nba_player_stats s
  JOIN slate sl ON sl.player_id = s.player_id
  JOIN games g ON g.id = s.game_id, d
  WHERE g.game_type IN ('regular', 'playoff', 'playin')
    AND s.minutes_played > 0
    AND s.game_date < d.today
    AND s.game_date >= d.today - 400
), unpivot AS (
  SELECT r.player_id, r.rn, r.this_season, x.stat, x.val
  FROM recent r
  CROSS JOIN LATERAL (VALUES
    ('pts', r.points), ('reb', r.rebounds), ('ast', r.assists), ('fg3m', r.three_points_made)
  ) AS x(stat, val)
), main AS (
  SELECT DISTINCT ON (dl.entity_id, dl.stat) dl.entity_id AS player_id, dl.stat, dl.line, dl.implied_prob
  FROM daily_lines dl, d
  WHERE dl.league_id = 1 AND dl.game_date = d.today AND dl.prop_type = 'player'
    AND NOT dl.is_first_half AND dl.stat IN ('pts', 'reb', 'ast', 'fg3m')
  ORDER BY dl.entity_id, dl.stat, ABS(dl.implied_prob - 0.5)
), opd AS (
  SELECT DISTINCT ON (team_id, position_group) team_id, position_group,
         pts_allowed_pg, reb_allowed_pg, ast_allowed_pg, fg3m_allowed_pg,
         league_rank, reb_rank, ast_rank, fg3m_rank
  FROM opponent_position_defense
  ORDER BY team_id, position_group, snapshot_date DESC
), agg AS (
  SELECT u.player_id, u.stat,
         AVG(u.val) FILTER (WHERE u.rn <= 5)  AS avg_last_5,
         AVG(u.val) FILTER (WHERE u.rn <= 10) AS avg_last_10,
         COUNT(*)   FILTER (WHERE u.rn <= 10) AS games_last_10,
         AVG(u.val) FILTER (WHERE u.this_season) AS season_avg,
         COUNT(*)   FILTER (WHERE u.this_season) AS season_games,
         CASE WHEN MAX(m.line) IS NOT NULL
              THEN COUNT(*) FILTER (WHERE u.rn <= 10 AND u.val > m.line) END AS over_last_10
  FROM unpivot u
  LEFT JOIN main m ON m.player_id = u.player_id AND m.stat = u.stat
  GROUP BY u.player_id, u.stat
)
SELECT sl.game_date, sl.game_id, p.id AS player_id, p.name, p.team, sl.position_group,
       opp.abbreviation AS opponent, sl.home_away, sl.days_rest, sl.key_teammates_out,
       st.stat,
       m.line,
       ROUND((m.implied_prob * 100)::numeric) AS implied_pct,
       (m.line IS NOT NULL) AS has_line,
       ROUND(a.avg_last_5, 1)  AS avg_last_5,
       ROUND(a.avg_last_10, 1) AS avg_last_10,
       a.games_last_10,
       a.over_last_10,
       ROUND(a.avg_last_10 - m.line::numeric, 1) AS avg_vs_line,
       ROUND(a.season_avg, 1) AS season_avg,
       a.season_games,
       ROUND(sl.rolling_min_5g::numeric, 1) AS min_last_5,
       ROUND((CASE st.stat WHEN 'pts' THEN o.pts_allowed_pg WHEN 'reb' THEN o.reb_allowed_pg
                           WHEN 'ast' THEN o.ast_allowed_pg ELSE o.fg3m_allowed_pg END)::numeric, 1)
         AS opp_allowed_to_position,
       CASE st.stat WHEN 'pts' THEN o.league_rank WHEN 'reb' THEN o.reb_rank
                    WHEN 'ast' THEN o.ast_rank ELSE o.fg3m_rank END AS opp_rank,
       ROUND(t.trend_val::numeric, 2) AS trend_z
FROM slate sl
CROSS JOIN (VALUES ('pts', 0), ('reb', 1), ('ast', 2), ('fg3m', 3)) AS st(stat, trend_stat)
JOIN players p ON p.id = sl.player_id
LEFT JOIN teams opp ON opp.id = sl.opponent_team_id
LEFT JOIN main m ON m.player_id = sl.player_id AND m.stat = st.stat
LEFT JOIN agg a ON a.player_id = sl.player_id AND a.stat = st.stat
LEFT JOIN opd o ON o.team_id = sl.opponent_team_id AND o.position_group = sl.position_group
LEFT JOIN nba_trends t ON t.player_id = sl.player_id AND t.stat = st.trend_stat AND t.window_size = 10;

GRANT SELECT ON public.nba_tonight_props TO sportquery_reader;
