# StatTrak Changelog

## 2026-05-03 — Picks Pipeline v2

Refactored the NBA player-prop picks pipeline to use direct opportunity signals
(touches), recency-weighted hit rates, stat-specific opponent rank matching,
an optional teammate-injury condition, and a bounded modifier system.

### Highlights

- **Touches as the opportunity signal.** Replaced inferred-usage condition
  matching with `BoxScorePlayerTrackV3` touches. The screener gates on
  `rolling_touches_5g` (with a usage-fallback while the backfill ramps up);
  the backtest's "opportunity" condition matches on a touches bucket.
  TOP / paint_touches / front_court_touches were intentionally **dropped** —
  V3 doesn't expose them and V2 returns invalid JSON for many recent games.
  See `fetch_player_track` docstring for the decision history.

- **Recency-weighted hit rate.** Backtest matches are weighted by
  `HIT_RATE_DECAY=0.95` so recent games count more than ancient ones.

- **Optional teammate-injury condition.** When today's `key_teammates_out`
  is non-empty and historical samples with the same teammates-out
  intersection ≥ `MIN_TEAMMATE_HISTORICAL_SAMPLES`, the condition activates
  and historical games are filtered to the matching set.

- **Stat-specific opponent rank matching** (pts→def, reb→reb, ast→ast,
  fg3m→fg3m). Already wired in v1 — verified intact through v2.

- **Modifier system replaces B2B hit-rate adjustment + first-half cap.**
  - `b2b` modifier: −3.0 when `days_rest == 0`.
  - `recent_opp_form` modifier: signed delta of opponent's last-7 vs season
    form scaled by `FORM_MODIFIER_SCALE=30`, capped at `FORM_MODIFIER_CAP=5`.
  - `MAX_MODIFIER_IMPACT=7` clamps `|sum(modifiers)|`.
  - First-half cap removed entirely; first-half markets are dropped at
    Kalshi parse time.

- **Safe + Value picks per (player, stat).** The picks generator now selects
  two lines per group: safe (max `hit_rate_adjusted`) and value (max `edge`).
  When they collide on the same line, only one row is stored. Schema:
  `pick_results.pick_type ∈ {safe, value, game}`.

### Schema

- `player_game_conditions` += touches, front_court_touches, time_of_possession,
  paint_touches, avg_speed (V3 populates touches + avg_speed; the rest stay NULL).
- `daily_conditions` += rolling_touches_5g, season_avg_touches, key_teammates_out,
  positional_sub_for, recent_opp_{pts,reb,ast,fg3m}_form (TOP fields kept for
  forward-compat but always NULL).
- `pick_results` += modifiers (JSONB).
- `pick_results` UNIQUE: `(game_date, entity_id, stat)` → `(game_date, entity_id,
  stat, pick_type)` so safe + value can coexist.

### Background

- BoxScorePlayerTrackV3 backfill running across 2023-24 / 2024-25 / 2025-26
  via `python -m analytics.data.enrich_games --backfill-track`. Speed-tuned
  retry: fast retry first, full cooldown on second consecutive failure.
  Coverage will fill in oldest-first.
