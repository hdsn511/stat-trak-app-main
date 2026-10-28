-- Opponent "allowed to position" store (NFL first). Long format: one row per
-- defense x game x position group x stat. team_defense_rolling is the latest
-- season-to-date snapshot (point-in-time values are recomputed from
-- team_position_allowed). Built by analytics/batch/compute_team_defense.py.
-- Backtest (2025 holdout) showed full-game values predict at least as well as
-- garbage-time-excluded values, so only full-game values are stored; blowout
-- games are identified by joining game_garbage_time.
-- Already applied to the hosted project.

CREATE TABLE IF NOT EXISTS public.team_position_allowed (
  game_id        bigint NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  team_id        bigint NOT NULL REFERENCES public.teams(id),
  league_id      bigint NOT NULL,
  opp_team_id    bigint NOT NULL REFERENCES public.teams(id),
  season         smallint NOT NULL,
  game_date      date NOT NULL,
  position_group text NOT NULL,
  stat_key       text NOT NULL,
  value          real NOT NULL,
  n_players      smallint,
  PRIMARY KEY (game_id, team_id, position_group, stat_key)
);
CREATE INDEX IF NOT EXISTS team_position_allowed_lookup
  ON public.team_position_allowed (league_id, team_id, season, position_group, stat_key, game_date);

CREATE TABLE IF NOT EXISTS public.team_defense_rolling (
  league_id      bigint NOT NULL,
  team_id        bigint NOT NULL REFERENCES public.teams(id),
  season         smallint NOT NULL,
  position_group text NOT NULL,
  stat_key       text NOT NULL,
  as_of_date     date NOT NULL,
  n_games        smallint NOT NULL,
  allowed_pg     real NOT NULL,
  allowed_l5     real,
  league_avg_pg  real NOT NULL,
  delta          real NOT NULL,
  z_score        real,
  league_rank    smallint,
  PRIMARY KEY (league_id, team_id, season, position_group, stat_key)
);

ALTER TABLE public.team_position_allowed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_defense_rolling ENABLE ROW LEVEL SECURITY;
CREATE POLICY sportquery_reader_select ON public.team_position_allowed FOR SELECT TO sportquery_reader USING (true);
CREATE POLICY sportquery_reader_select ON public.team_defense_rolling FOR SELECT TO sportquery_reader USING (true);
