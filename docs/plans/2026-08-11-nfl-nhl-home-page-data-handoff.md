# NFL / NHL home-page data — handoff

**Date:** 2026-08-11
**Status:** data layer complete and populated. Server + client wiring belongs to
the session that owns `server/src/**` and `client/src/**`.

This session verified the ESPN migration and built the aggregate layer the
NFL/NHL home pages need. It deliberately touched **no** TypeScript, because a
concurrent session owns `server/src/config/leagues.ts`, the controllers and the
Ember pages.

---

## 1. Migration verification — NFL and NHL are clean

Both leagues are fully and correctly migrated. Nothing needs re-ingesting.

| Check | NFL | NHL |
|---|---|---|
| Games | 285 (2025-09-04 → 2026-02-08) | 1,394 (2025-10-07 → 2026-06-14) |
| Expected | 272 regular + 13 playoff = 285 ✓ | 1,312 regular + 82 playoff = 1,394 ✓ |
| Regular-season games per team | 17 for all 32 ✓ | 82 for all 32 ✓ |
| Games missing box scores | 0 | 0 |
| Stat rows | 17,511 (1,841 players) | 53,123 (1,038 players) |
| Null `player_id` / `team_id` | 0 / 0 | 0 / 0 |

Values were spot-checked against the real seasons: NFL passing leaders came out
Stafford 4,707/46TD, Goff 4,564, Prescott 4,552, Maye 4,394; NHL McDavid 138 pts
(48G/90A, 306 SOG) in 82 GP with goalie SV% in a .910–.921 band. The NHL
`shotsTotal` vs `shootoutGoals` label trap was handled correctly — SOG averages
3.7/game, not ~0. February 2026's thin NHL slate (74 games) is the Olympic
break, not a gap.

## 2. What was added

### Schema (migration `nfl_nhl_home_page_etl_schema`, additive only)

- `nfl_trends`, `nhl_trends` — mirror `nba_trends` exactly, same columns, same
  unique index on `(player_id, stat, window_size)`.
- `teams.conference`, `teams.division` — there was no column to split a
  standings card on.
- `games.ot` — `'OT'` / `'SO'` / NULL.
- `team_standings` — PK `(league_id, season, team_id)`.

### Data, populated for season 2025

| Table | Rows |
|---|---|
| `nfl_trends` | 2,227 across 599 players |
| `nhl_trends` | 2,832 across 596 players |
| `team_standings` | 64 (32 NFL + 32 NHL) |
| `games.ot` set | 360 (NFL 16 OT; NHL 225 OT + 119 SO) |
| `teams.conference`/`division` | 64/64 |
| NFL positions backfilled | 235 → **0** players with stat rows and no position |

### Jobs (all in `analytics/batch/`, all `--dry-run` and `--league` aware)

`seed_conferences.py`, `backfill_game_ot.py`, `compute_standings.py`,
`compute_trends.py`, `backfill_positions.py`. Documented in
`analytics/README.md` under **League home-page ETL**, including the nightly
sequence.

---

## 3. What the wiring session needs to know

### `leagues.ts` can now be filled in

Both NFL and NHL currently carry `trendsTable: null` with empty
`trendStatNames` / `validStatIds` / `streakStats`, because the tables did not
exist. They do now, and the **stat ids already in your `statConfig` were used
verbatim** — nothing needs renumbering:

```ts
// NFL
trendsTable: 'nfl_trends',
trendStatNames: { 0:'passing_yards', 1:'passing_tds', 2:'rushing_yards',
                  3:'rushing_tds', 4:'receiving_yards', 5:'receptions',
                  6:'receiving_tds', 7:'tackles_total' },
validStatIds: [0,1,2,3,4,5,6,7],

// NHL
trendsTable: 'nhl_trends',
trendStatNames: { 0:'goals', 1:'assists', 2:'points',
                  3:'shots_on_goal', 4:'blocks', 5:'hits' },
validStatIds: [0,1,2,3,4,5],
```

Window sizes are 3/5/10, matching NBA, so the existing `window` query param
works unchanged.

### `team_standings` shape for the standings card

`LeaguePage`'s skeleton renders `W–L · PCT · L10 · STRK` per conference. The
matching columns are `wins`, `losses`, `ties`, `ot_losses`, `win_pct`,
`l10_wins`, `l10_losses`, `streak` (`'W6'`), plus `conference`, `division`,
`conf_rank`, `div_rank`, `league_rank`, `points`, `points_for`,
`points_against`.

Two league differences the card has to respect:

- **NHL is points-based.** The record reads `W-L-OTL` and teams rank on
  `points` (`2W + OTL`), not win pct. `win_pct` holds the *points percentage*
  (`points / (2 * GP)`), which is what the league actually ranks on.
- **NFL has ties.** There is exactly one in 2025, so the record is `W-L-T` and
  `win_pct` is `(W + 0.5T) / GP`. `ot_losses` is always 0 for NFL — an NFL
  overtime loss is an ordinary loss.

Conference values are `'AFC'`/`'NFC'` and `'EASTERN'`/`'WESTERN'`, which match
`leagueConfigs.ts` `conferenceLabels` as-is.

### Both leagues are out of season

Today is 2026-08-11: the NFL season ended 2026-02-08 and the NHL's 2026-06-14.
`games/today` returns nothing for either league and will keep doing so until
September. Per the user's direction the pages should be **built live-shaped and
degrade to a recap** — query today's slate, and when it is empty fall back to a
season-final strip rather than an empty ticker. `team_standings` for season 2025
is the final table and is the right source for that fallback.

Trending/streak rows computed now describe the *end* of the 2025 season, since
"last 10" is the last 10 games each player actually played.

### There is no streaks table

`nfl_trends`/`nhl_trends` cover the **TRENDING PLAYERS** module. The
**STREAK WATCH** module has no precomputed source for these leagues — NBA's
`picks/streaks/perfect` is built on `daily_lines` + `pick_results`, and both
are NBA/MLB only (`hasMarkets: false` for NFL/NHL, correctly). Streaks for
these leagues have to be derived from the stat tables directly. Say the word
and this session will add a `player_streaks` table and the job to fill it.

---

## 4. Gotcha worth carrying

**Paginating Supabase reads requires a total order.** `.range()` paging over a
result set ordered only by `game_date` — or not ordered at all — silently drops
and repeats rows across page boundaries. It cost a full re-run here: the
position backfill quietly resolved 175 of 235 players and reported success. Any
`.range()` loop needs a tiebreaker column (`id`, `game_id`, `player_id`) in the
sort. Fixed in all four loaders and noted in `analytics/README.md`.
