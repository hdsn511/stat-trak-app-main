export type FewShotExample = {
  user: string
  assistant: string // JSON envelope as a string
}

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [
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
    user: 'Which guards are trending up on assists over the last 5 games?',
    assistant: JSON.stringify({
      sql: `SELECT p.id, p.name, p.team, p.position, t.trend_val AS z_score, t.rolling_avg
FROM nba_trends t
JOIN players p ON t.player_id = p.id
WHERE t.stat = 2 AND t.window_size = 5
  AND (p.position ILIKE '%G%' OR p.position IN ('PG','SG','G'))
  AND t.trend_val > 0.8
ORDER BY t.trend_val DESC
LIMIT 20`,
      narrative:
        'Guards with positive assist trends (z > 0.8) over their last 5 games.',
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
    user: 'Who has faced the worst defenses against their position recently?',
    assistant: JSON.stringify({
      sql: `SELECT p.id, p.name, p.team, p.position, opd.league_rank, opd.pts_allowed_pg
FROM players p
JOIN opponent_position_defense opd ON opd.team_id IN (
  SELECT pgc.opponent_team_id
  FROM player_game_conditions pgc
  WHERE pgc.player_id = p.id
    AND pgc.game_date >= CURRENT_DATE - INTERVAL '14 days'
)
AND opd.position_group = LEFT(p.position, 1)
WHERE opd.league_rank >= 25
ORDER BY opd.league_rank DESC
LIMIT 20`,
      narrative:
        'Players who in the last 14 days faced teams ranked in the bottom 6 defensively against their position.',
    }),
  },
  {
    user: 'What home/away split does Anthony Edwards have on points this season?',
    assistant: JSON.stringify({
      sql: `SELECT pgc.home_away,
       AVG(s.points) AS avg_points,
       COUNT(*) AS games
FROM nba_player_stats s
JOIN players p ON s.player_id = p.id
JOIN player_game_conditions pgc ON pgc.player_id = p.id AND pgc.game_id = s.game_id
JOIN games g ON g.id = s.game_id
WHERE p.name ILIKE '%anthony%edwards%'
  AND g.league_id = 1
  AND g.season = (SELECT MAX(season) FROM games WHERE league_id = 1)
GROUP BY pgc.home_away`,
      narrative:
        "Anthony Edwards's home vs away scoring averages for the current season.",
    }),
  },
  {
    user: 'Players with 2+ days rest tonight.',
    assistant: JSON.stringify({
      sql: `SELECT DISTINCT p.id, p.name, p.team, p.position, pgc.days_rest
FROM player_game_conditions pgc
JOIN players p ON pgc.player_id = p.id
WHERE pgc.game_date = CURRENT_DATE
  AND pgc.days_rest >= 2
ORDER BY pgc.days_rest DESC, p.name
LIMIT 40`,
      narrative:
        "Players on today's slate with 2 or more days of rest.",
    }),
  },
  {
    user: 'Now just show me the ones with a Kalshi line available.',
    assistant: JSON.stringify({
      sql: `SELECT DISTINCT p.id, p.name, p.team, p.position, pgc.days_rest,
       dl.stat, dl.line, dl.kalshi_price
FROM player_game_conditions pgc
JOIN players p ON pgc.player_id = p.id
JOIN daily_lines dl ON dl.entity_id = p.id
  AND dl.league_id = 1
  AND dl.prop_type = 'player'
  AND dl.game_date = CURRENT_DATE
WHERE pgc.game_date = CURRENT_DATE
  AND pgc.days_rest >= 2
  AND dl.kalshi_price IS NOT NULL
ORDER BY pgc.days_rest DESC, p.name
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
      sql: `SELECT DISTINCT p.id, p.name, p.team, p.position,
       t.trend_val AS z_score, t.rolling_avg, opd.league_rank AS opp_def_rank
FROM players p
JOIN nba_trends t ON t.player_id = p.id
JOIN player_game_conditions pgc ON pgc.player_id = p.id
JOIN opponent_position_defense opd ON opd.team_id = pgc.opponent_team_id
  AND opd.position_group = 'G'
WHERE (p.position ILIKE '%G%' OR p.position IN ('PG','SG','G'))
  AND t.stat = 0 AND t.window_size = 10
  AND t.trend_val > 0.5
  AND pgc.game_date = CURRENT_DATE
  AND opd.league_rank >= 21
ORDER BY t.trend_val DESC
LIMIT 20`,
      narrative:
        "Guards on today's slate trending up on points (10-game window) against a bottom-10 positional defense.",
    }),
  },
]
