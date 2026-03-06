# Design: Supabase + Backend Wiring

Date: 2026-03-06

## Problem

The existing `nbaController.ts` was written against a schema with denormalized `team`, `position`, `is_active`, and `league` columns on `players`, and `minutes_played` + `game_date` on `nba_player_stats`. A schema migration left those columns missing, breaking all controller queries once data is loaded.

## Approach

Approach A: Add the missing denormalized columns back via DB migration, fix the one column rename (`minutes` → `minutes_played`), and update the Python scraper to populate the new columns.

## DB Schema Changes

### `players` table — add columns
- `league TEXT` — e.g. `'nba'` — enables filtering without FK join
- `team TEXT` — current team abbreviation (e.g. `'LAL'`)
- `position TEXT` — player position (e.g. `'G'`, `'F'`, `'C'`)
- `is_active BOOLEAN DEFAULT TRUE`

### `nba_player_stats` table — two changes
- rename `minutes` → `minutes_played`
- add `game_date DATE`

## Controller Changes

`nbaController.ts` is already written correctly for the intended schema. No logic changes needed — the DB migration makes it work as-is.

## Python Script Changes (`server/scripts/nba_init.py`)

1. `fetch_and_insert_players` — add `league: 'nba'` and `is_active: True` to each player record
2. `fetch_and_insert_rosters` — after inserting rosters, extract `POSITION` and team abbreviation from the `commonteamroster` DataFrame and update each player row in `players`
3. `fetch_and_insert_player_stats` — add `game_date` from `GAME_DATE` column in the gamelog row; rename `minutes` key → `minutes_played`
4. `resume_nba_stats.py` — same `minutes` → `minutes_played` rename

## Data Flow (end to end)

```
nba_init.py (scraper)
  → leagues, teams, players (with league/team/position/is_active)
  → rosters (team+player per season)
  → games (with game_date)
  → nba_player_stats (with game_date, minutes_played)
  → computeNBATrends.ts (z-scores → nba_trends)
        ↓
Express API (nbaController.ts)
  → /api/nba/trends/top
  → /api/nba/trends
  → /api/nba/players/search
  → /api/nba/players/:id/games
  → /api/nba/games/today
        ↓
React frontend (services/api.ts → components)
```

## Out of Scope

- Running the Python scraper (data population)
- NFL/MLB/NHL routes (scaffolded, no data)
- computeNBATrends.ts changes
