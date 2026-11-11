export type FewShotExample = {
  user: string
  assistant: string // JSON envelope as a string
}

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    // team_standings has no NBA/MLB rows: derive a record from game scores.
    user: 'Which NBA teams had the best record last season?',
    assistant: JSON.stringify({
      sql: `WITH last AS (
  SELECT MAX(season) AS season FROM games
  WHERE league_id = 1 AND home_score IS NOT NULL AND game_type = 'regular'
), results AS (
  SELECT g.home_team_id AS team_id, (g.home_score > g.away_score)::int AS w,
         (g.home_score < g.away_score)::int AS l
  FROM games g, last WHERE g.league_id = 1 AND g.season = last.season
    AND g.game_type = 'regular' AND g.home_score IS NOT NULL
  UNION ALL
  SELECT g.away_team_id, (g.away_score > g.home_score)::int, (g.away_score < g.home_score)::int
  FROM games g, last WHERE g.league_id = 1 AND g.season = last.season
    AND g.game_type = 'regular' AND g.home_score IS NOT NULL
)
SELECT t.id AS team_id, t.name AS team_name, SUM(r.w) AS wins, SUM(r.l) AS losses,
       ROUND(SUM(r.w)::numeric / NULLIF(SUM(r.w) + SUM(r.l), 0), 3) AS win_pct
FROM results r JOIN teams t ON t.id = r.team_id
GROUP BY t.id, t.name
ORDER BY win_pct DESC
LIMIT 10`,
      narrative: 'NBA teams ranked by regular-season win percentage in the most recent completed season.',
    }),
  },
  {
    user: 'Show me the top trending scorers over the last 10 games.',
    assistant: JSON.stringify({
      sql: `SELECT p.id, p.name, p.team, p.position, t.trend_val AS z_score, t.rolling_avg
FROM nba_trends t
JOIN players p ON t.player_id = p.id
WHERE t.stat = 0 AND t.window_size = 10
ORDER BY t.trend_val DESC
LIMIT 20`,
      narrative:
        'Top 20 scorers by 10-game z-score against their season baseline.',
    }),
  },
  {
    user: "LeBron's last 10 games without Austin Reaves.",
    assistant: JSON.stringify({
      sql: `SELECT s.game_date, g.ext_id, s.points, s.rebounds, s.assists,
       s.three_points_made, s.minutes_played
FROM nba_player_stats s
JOIN players p ON s.player_id = p.id
JOIN games g ON s.game_id = g.id
WHERE p.name ILIKE '%lebron%james%'
  AND NOT EXISTS (
    SELECT 1 FROM nba_player_stats s2
    JOIN players p2 ON s2.player_id = p2.id
    WHERE s2.game_id = s.game_id
      AND p2.name ILIKE '%austin%reaves%'
      AND s2.minutes_played > 0
  )
ORDER BY s.game_date DESC
LIMIT 10`,
      narrative:
        "LeBron James's 10 most recent games in which Austin Reaves did not play.",
    }),
  },
  {
    user: "Show today's picks with the biggest edges.",
    assistant: JSON.stringify({
      sql: `SELECT p.id AS player_id, p.name, p.team, p.position,
       pr.stat, pr.recommended_line, pr.confidence_score,
       pr.implied_prob, pr.edge, pr.pick_type, pr.hit_rate
FROM pick_results pr
JOIN players p ON pr.entity_id = p.id
WHERE pr.league_id = 1
  AND pr.game_date = CURRENT_DATE
  AND pr.prop_type = 'player'
ORDER BY pr.edge DESC
LIMIT 20`,
      narrative:
        "Today's picks sorted by edge over the market, highest first.",
    }),
  },
  {
    // "Against team X" means the opponent, not the team the player plays for.
    // Without this example the model reads it as a team filter and returns
    // Boston's own players.
    user: 'Which players put up the most rebounds against Boston?',
    assistant: JSON.stringify({
      sql: `SELECT p.id AS player_id, p.name, p.team,
       AVG(s.rebounds) AS avg_rebounds, COUNT(*) AS games
FROM nba_player_stats s
JOIN players p ON s.player_id = p.id
JOIN game_matchups gm ON gm.game_id = s.game_id AND gm.team_id = s.team_id
JOIN teams opp ON opp.id = gm.opponent_team_id
WHERE opp.league_id = 1
  AND (opp.abbreviation = 'BOS' OR opp.name ILIKE '%celtics%')
GROUP BY p.id, p.name, p.team
HAVING COUNT(*) >= 2
ORDER BY avg_rebounds DESC
LIMIT 20`,
      narrative:
        'Players averaging the most rebounds in games against Boston, minimum two meetings.',
    }),
  },
  {
    // Gaps-and-islands streak counting: the general pattern for any "how many
    // times has team/player X gone on a N+ game streak" question, on any
    // sport. Deliberately terse — this is the shape completions should match,
    // not sprawl into, since a bloated version of this can run the model out
    // of its output budget before the JSON closes.
    user: 'How many times have the Brewers gone on more than a 2-game losing streak this season?',
    assistant: JSON.stringify({
      sql: `WITH team_games AS (
  SELECT g.game_date,
         CASE WHEN (g.home_team_id = tm.id AND g.home_score < g.away_score)
                OR (g.away_team_id = tm.id AND g.away_score < g.home_score)
              THEN 1 ELSE 0 END AS is_loss
  FROM games g
  JOIN teams tm ON tm.id IN (g.home_team_id, g.away_team_id)
  WHERE g.league_id = 2 AND tm.abbreviation = 'MIL'
    AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
    AND g.season = (SELECT MAX(season) FROM games WHERE league_id = 2)
), grouped AS (
  SELECT is_loss,
         ROW_NUMBER() OVER (ORDER BY game_date) - ROW_NUMBER() OVER (PARTITION BY is_loss ORDER BY game_date) AS grp
  FROM team_games
)
SELECT COUNT(*) AS losing_streaks_over_2
FROM (SELECT 1 FROM grouped WHERE is_loss = 1 GROUP BY grp HAVING COUNT(*) > 2) s`,
      narrative: 'Number of times the Brewers have lost more than 2 games in a row this season.',
    }),
  },
  {
    user: 'Players with 2+ days rest tonight.',
    assistant: JSON.stringify({
      sql: `SELECT p.id AS player_id, p.name, p.team, p.position, dc.days_rest, dc.home_away
FROM daily_conditions dc
JOIN players p ON dc.player_id = p.id
WHERE dc.game_date = CURRENT_DATE
  AND dc.days_rest >= 2
ORDER BY dc.days_rest DESC, p.name
LIMIT 40`,
      narrative:
        "Players on today's slate with 2 or more days of rest.",
    }),
  },
  {
    user: 'Now just show me the ones with a Kalshi line available.',
    assistant: JSON.stringify({
      sql: `SELECT DISTINCT ON (p.id, dl.stat) p.id AS player_id, p.name, p.team, p.position,
       dc.days_rest, dl.stat, dl.line, dl.implied_prob
FROM daily_conditions dc
JOIN players p ON dc.player_id = p.id
JOIN daily_lines dl ON dl.entity_id = p.id
  AND dl.league_id = 1
  AND dl.prop_type = 'player'
  AND dl.game_date = CURRENT_DATE
WHERE dc.game_date = CURRENT_DATE
  AND dc.days_rest >= 2
ORDER BY p.id, dl.stat, ABS(dl.implied_prob - 0.5)
LIMIT 40`,
      narrative:
        "Same set as before, now filtered to players with a Kalshi line available today.",
    }),
  },
  {
    user: 'Tell me about Curry.',
    assistant: JSON.stringify({
      sql: null,
      narrative:
        "There are two active players named Curry. Which did you mean?",
      disambiguation: {
        candidates: ['Stephen Curry', 'Seth Curry'],
        prompt: 'Did you mean Stephen Curry (GSW) or Seth Curry?',
      },
    }),
  },
  {
    user: "Find guards in today's slate against a bottom-10 defense who are trending up on points over the last 10 games.",
    assistant: JSON.stringify({
      sql: `SELECT p.id AS player_id, p.name, p.team, p.position, opp.abbreviation AS opponent,
       ROUND(t.trend_val::numeric, 2) AS z_score, ROUND(t.rolling_avg::numeric, 1) AS pts_last_10,
       ROUND(t.season_avg::numeric, 1) AS pts_season, dc.opp_def_rank_position AS opp_rank_vs_guards
FROM daily_conditions dc
JOIN players p ON p.id = dc.player_id
JOIN nba_trends t ON t.player_id = p.id AND t.stat = 0 AND t.window_size = 10
JOIN teams opp ON opp.id = dc.opponent_team_id
WHERE dc.game_date = CURRENT_DATE
  AND dc.position_group = 'G'
  AND t.trend_val > 0.5
  AND dc.opp_def_rank_position >= 21
ORDER BY t.trend_val DESC
LIMIT 20`,
      narrative:
        "Guards on today's slate trending up on points (10-game window) against a bottom-10 positional defense.",
    }),
  },
  {
    // Intent over literal reading: "best spot to beat the line" ranks by evidence
    // (over rate vs the main line, avg vs line, matchup), never by implied % alone.
    // nba_tonight_props already holds all of it for tonight's slate.
    user: 'who has the best shot to go over their pts line tonight, close to 50/50 lines only, and why',
    assistant: JSON.stringify({
      sql: `SELECT player_id, name, team, opponent, line, implied_pct,
       over_last_10 || '/' || games_last_10 AS over_last_10, avg_last_10, avg_vs_line,
       season_avg, opp_allowed_to_position, opp_rank, min_last_5
FROM nba_tonight_props
WHERE stat = 'pts' AND implied_pct BETWEEN 40 AND 60 AND games_last_10 >= 5
ORDER BY over_last_10::numeric / games_last_10 DESC, avg_vs_line DESC
LIMIT 10`,
      narrative: '',
    }),
  },
  {
    // Named player tonight: the view keeps the row when no line is posted
    // (line NULL), so the answer can say so instead of "no data".
    user: 'is giannis a good bet for over his rebounds tonight',
    assistant: JSON.stringify({
      sql: `SELECT player_id, name, team, opponent, line, implied_pct,
       over_last_10 || '/' || games_last_10 AS over_last_10, avg_last_5, avg_last_10, avg_vs_line,
       season_avg, opp_allowed_to_position, opp_rank, days_rest, min_last_5, trend_z
FROM nba_tonight_props
WHERE stat = 'reb' AND name ILIKE '%antetokounmpo%'`,
      narrative: '',
    }),
  },
  {
    // Multi-part question → one row set; "allowed" is computed from box scores
    // (sum per game, then average), joined to the opposing team's shooters.
    user: "which team gives up the most 3s in tonight's games, and who are the best shooters going against them",
    assistant: JSON.stringify({
      sql: `WITH tonight AS (
  SELECT gm.team_id, gm.opponent_team_id
  FROM game_matchups gm JOIN games g ON g.id = gm.game_id
  WHERE g.league_id = 1 AND g.game_date = CURRENT_DATE
), season AS (
  SELECT MAX(season) AS season FROM games WHERE league_id = 1 AND game_date <= CURRENT_DATE
), allowed AS (
  SELECT gm.opponent_team_id AS defense_id,
         ROUND(SUM(s.three_points_made)::numeric / COUNT(DISTINCT s.game_id), 1) AS opp_3pm_allowed_pg,
         COUNT(DISTINCT s.game_id) AS games
  FROM nba_player_stats s
  JOIN games g ON g.id = s.game_id
  JOIN game_matchups gm ON gm.game_id = s.game_id AND gm.team_id = s.team_id
  WHERE g.league_id = 1 AND g.season = (SELECT season FROM season) AND g.game_type = 'regular'
  GROUP BY gm.opponent_team_id
), worst AS (
  SELECT t.team_id AS defense_id, t.opponent_team_id AS shooter_team_id, a.opp_3pm_allowed_pg, a.games
  FROM tonight t JOIN allowed a ON a.defense_id = t.team_id
  ORDER BY a.opp_3pm_allowed_pg DESC LIMIT 1
), shooters AS (
  SELECT s.player_id, COUNT(*) AS gp, AVG(s.three_points_made) AS fg3m_pg
  FROM nba_player_stats s JOIN games g ON g.id = s.game_id
  JOIN worst w ON w.shooter_team_id = s.team_id
  WHERE g.season = (SELECT season FROM season) AND g.game_type = 'regular' AND s.minutes_played > 0
  GROUP BY s.player_id HAVING COUNT(*) >= 3
)
SELECT d.name AS defense, w.opp_3pm_allowed_pg, w.games AS defense_games,
       o.name AS opponent, p.id AS player_id, p.name, sh.gp,
       ROUND(sh.fg3m_pg::numeric, 1) AS fg3m_pg, ROUND(tr.rolling_avg::numeric, 1) AS fg3m_last_10
FROM worst w
JOIN teams d ON d.id = w.defense_id
JOIN teams o ON o.id = w.shooter_team_id
CROSS JOIN shooters sh
JOIN players p ON p.id = sh.player_id
LEFT JOIN nba_trends tr ON tr.player_id = p.id AND tr.stat = 3 AND tr.window_size = 10
ORDER BY sh.fg3m_pg DESC
LIMIT 8`,
      narrative: '',
    }),
  },
  {
    // Teaches the mlb_trends stat encoding (0=hits, DIFFERENT from nba_trends's
    // 0=points) and that a named player picks the sport, not a stat filter.
    user: "What's Ohtani's home run trend over the last 10 games?",
    assistant: JSON.stringify({
      sql: `SELECT p.id AS player_id, p.name, p.team, t.trend_val AS z_score, t.rolling_avg, t.season_avg
FROM mlb_trends t
JOIN players p ON t.player_id = p.id
WHERE p.name ILIKE '%ohtani%'
  AND t.stat = 4 AND t.window_size = 10`,
      narrative: "Shohei Ohtani's 10-game home run trend against his season average.",
    }),
  },
  {
    // NFL has no picks/lines pipeline and no per-position played-gate column —
    // this shows scoping to league_id 3 and using targets as the played signal.
    user: 'Which wide receivers are trending up on receiving yards over the last 5 games?',
    assistant: JSON.stringify({
      sql: `SELECT p.id AS player_id, p.name, p.team, t.trend_val AS z_score, t.rolling_avg
FROM nfl_trends t
JOIN players p ON t.player_id = p.id
WHERE p.league_id = 3 AND p.position = 'WR'
  AND t.stat = 4 AND t.window_size = 5
ORDER BY t.trend_val DESC
LIMIT 20`,
      narrative: 'Wide receivers trending up on receiving yards (5-game z-score) against their season baseline.',
    }),
  },
  {
    // NHL: skaters and goalies share nhl_player_stats; toi is stored in
    // seconds. Also demonstrates declining a picks/lines question for a
    // no-markets league instead of returning an empty result silently.
    user: 'Give me tonight\'s best value picks for the NHL slate.',
    assistant: JSON.stringify({
      sql: null,
      narrative:
        "StatTrak doesn't generate betting picks or lines for the NHL yet — that pipeline only covers NBA and MLB. I can show trending or streaking NHL skaters/goalies instead if that helps.",
    }),
  },
]
