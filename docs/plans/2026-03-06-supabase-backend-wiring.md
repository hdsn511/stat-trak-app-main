# Supabase + Backend Wiring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the schema mismatch between the DB and controllers so the full stack works end-to-end once data is loaded.

**Architecture:** Two DB migrations via Supabase MCP add missing denormalized columns to `players` and `nba_player_stats`. Python scraper is updated to populate those columns. The Express controllers are already written correctly — no changes needed there.

**Tech Stack:** Supabase MCP (migrations), TypeScript/Express (nbaController.ts), Python + nba_api (nba_init.py, resume_nba_stats.py)

---

## Context

The `nbaController.ts` was written for a schema that has:
- `players.league` (TEXT), `players.team` (TEXT), `players.position` (TEXT), `players.is_active` (BOOLEAN)
- `nba_player_stats.minutes_played` (not `minutes`), `nba_player_stats.game_date`

A migration left those columns out. All tables are currently empty (0 rows). The `computeNBATrends.ts` job also expects `minutes_played` in `nba_player_stats`.

Position comes from the `commonteamroster` endpoint's `POSITION` column (via `nba_init.py`). Team abbreviation is available from roster and gamelog rows.

---

### Task 1: Add columns to `players` table

**Files:**
- Migration via Supabase MCP (no file created)

**Step 1: Run migration**

Use the `mcp__supabase__apply_migration` tool with name `add_player_denorm_columns` and SQL:

```sql
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS league TEXT,
  ADD COLUMN IF NOT EXISTS team TEXT,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
```

**Step 2: Verify columns exist**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'players'
ORDER BY ordinal_position;
```

Expected: rows for `league`, `team`, `position`, `is_active` appear in results.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add league/team/position/is_active columns to players table"
```

---

### Task 2: Fix `nba_player_stats` — rename column and add `game_date`

**Files:**
- Migration via Supabase MCP

**Step 1: Run migration**

Use `mcp__supabase__apply_migration` with name `fix_nba_player_stats_columns` and SQL:

```sql
ALTER TABLE public.nba_player_stats
  RENAME COLUMN minutes TO minutes_played;

ALTER TABLE public.nba_player_stats
  ADD COLUMN IF NOT EXISTS game_date DATE;
```

**Step 2: Verify**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'nba_player_stats'
ORDER BY ordinal_position;
```

Expected: `minutes_played` exists, `minutes` does not, `game_date` exists.

**Step 3: Commit**

```bash
git commit -m "feat: rename minutes to minutes_played, add game_date to nba_player_stats"
```

---

### Task 3: Update `fetch_and_insert_players` in `nba_init.py`

**Files:**
- Modify: `server/scripts/nba_init.py` (function `fetch_and_insert_players`, lines ~111-153)

**Step 1: Edit the player_record dict**

Find this block (around line 123-128):
```python
player_record = {
    'league_id': league_id,
    'ext_id': str(player['id']),
    'name': player['full_name']
}
```

Change to:
```python
player_record = {
    'league_id': league_id,
    'ext_id': str(player['id']),
    'name': player['full_name'],
    'league': 'nba',
    'is_active': True,
}
```

**Step 2: Verify the edit looks correct**

Read the file and confirm the dict has the two new fields.

**Step 3: Commit**

```bash
git add server/scripts/nba_init.py
git commit -m "feat: populate league and is_active when inserting players"
```

---

### Task 4: Update `fetch_and_insert_rosters` to back-fill `position` and `team` on players

**Files:**
- Modify: `server/scripts/nba_init.py` (function `fetch_and_insert_rosters`, lines ~155-219)

**Step 1: Add player update logic inside the inner loop**

Find the inner `for _, row in df.iterrows():` block (around line 191). After building `roster_record`, add an update to the player's `position` and `team` columns:

```python
for _, row in df.iterrows():
    player_ext_id = str(row['PLAYER_ID'])

    if player_ext_id in player_id_map:
        roster_record = {
            'season': season_year,
            'team_id': team_db_id,
            'player_id': player_id_map[player_ext_id]
        }
        all_rosters.append(roster_record)

        # Back-fill position and team on player row
        position = str(row.get('POSITION', '') or '').strip()
        # team_ext_id is the loop variable from outer for loop
        team_abbr = next(
            (abbr for abbr, tid in team_abbr_map.items() if tid == team_db_id),
            None
        )
        if position or team_abbr:
            update_payload = {}
            if position:
                update_payload['position'] = position
            if team_abbr:
                update_payload['team'] = team_abbr
            supabase.table('players').update(update_payload).eq(
                'id', player_id_map[player_ext_id]
            ).execute()
```

Note: the outer loop variable is `team_db_id` (from `for team_ext_id, team_db_id in team_id_map.items()`). Use the `team_abbr_map` reverse lookup shown above.

**Step 2: Verify the edit looks correct**

Read the function and confirm the update call is inside the `if player_ext_id in player_id_map:` block.

**Step 3: Commit**

```bash
git add server/scripts/nba_init.py
git commit -m "feat: back-fill player position and team from roster endpoint"
```

---

### Task 5: Update `fetch_and_insert_player_stats` in `nba_init.py`

**Files:**
- Modify: `server/scripts/nba_init.py` (function `fetch_and_insert_player_stats`, lines ~331-457)

**Step 1: Add `game_date` extraction inside the inner row loop**

Find the `for _, row in df.iterrows():` block (around line 386). After the `game_db_id` lookup, extract game_date:

```python
# Extract game date from the gamelog row
game_date_raw = row.get('GAME_DATE', None)
game_date = None
if pd.notna(game_date_raw):
    try:
        game_date = str(pd.to_datetime(game_date_raw).date())
    except Exception:
        game_date = None
```

**Step 2: Update the `stat_record` dict**

Find the `stat_record` dict (around line 423). Change `'minutes': minutes_played` to `'minutes_played': minutes_played` and add `game_date`:

```python
stat_record = {
    'game_id': game_db_id,
    'player_id': player_db_id,
    'team_id': team_db_id,
    'points': int(row.get('PTS', 0) or 0),
    'rebounds': int(row.get('REB', 0) or 0),
    'assists': int(row.get('AST', 0) or 0),
    'three_points_made': int(row.get('FG3M', 0) or 0),
    'fouls': int(row.get('PF', 0) or 0),
    'minutes_played': minutes_played,
    'game_date': game_date,
}
```

**Step 3: Verify**

Read the function and confirm `minutes_played` (not `minutes`) and `game_date` appear in stat_record.

**Step 4: Commit**

```bash
git add server/scripts/nba_init.py
git commit -m "feat: add game_date and rename minutes_played in player stats insert"
```

---

### Task 6: Update `resume_nba_stats.py`

**Files:**
- Modify: `server/scripts/resume_nba_stats.py` (stat_record dict, line ~155-165)

**Step 1: Add `game_date` extraction**

In `resume_player_stats`, inside `for _, row in df.iterrows():`, after the minutes parsing block, add:

```python
game_date_raw = row.get('GAME_DATE', None)
game_date = None
if pd.notna(game_date_raw):
    try:
        game_date = str(pd.to_datetime(game_date_raw).date())
    except Exception:
        game_date = None
```

**Step 2: Update the stat_record dict**

Find the dict at line ~155. Change `'minutes': minutes_played` to `'minutes_played': minutes_played` and add `'game_date': game_date`:

```python
stat_record = {
    'game_id': game_db_id,
    'player_id': player_db_id,
    'team_id': team_db_id,
    'points': int(row.get('PTS', 0) or 0),
    'rebounds': int(row.get('REB', 0) or 0),
    'assists': int(row.get('AST', 0) or 0),
    'three_points_made': int(row.get('FG3M', 0) or 0),
    'fouls': int(row.get('PF', 0) or 0),
    'minutes_played': minutes_played,
    'game_date': game_date,
}
```

**Step 3: Commit**

```bash
git add server/scripts/resume_nba_stats.py
git commit -m "feat: add game_date and rename minutes_played in resume stats script"
```

---

### Task 7: Verify the controller and end-to-end wiring

**Files:**
- Read: `server/src/controllers/nbaController.ts`
- Read: `client/src/services/api.ts`

**Step 1: Confirm controller queries match the updated schema**

Check each function references the correct column names:
- `searchPlayers` → `.eq('league', 'nba')` and `.eq('is_active', true)` ✓ (columns now exist)
- `getTopTrending` / `getTrends` → `players(name, team, position)` ✓ (columns now exist)
- `getPlayerGames` → selects `minutes_played, game_date` from `nba_player_stats` ✓ (columns now exist)

**Step 2: Start both dev servers and test the routes**

```bash
npm run dev:both
```

Then hit each endpoint (data will return empty arrays since no scraper run yet — that's expected):

```bash
curl http://localhost:3000/api/nba/trends/top
curl http://localhost:3000/api/nba/trends?stat=points
curl "http://localhost:3000/api/nba/players/search?q=james"
curl http://localhost:3000/api/nba/games/today
```

Expected for trends/players: `{"success":true,"data":[]}` (empty, no data yet)
Expected for games/today: live ESPN data (doesn't need DB)

**Step 3: Confirm frontend renders without errors**

Open `http://localhost:5173` — the app should load with empty trending lists (no JS errors in console).

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify full stack wiring — schema, backend, and frontend aligned"
```

---

## Done

The full stack is now aligned:
- DB schema matches controller expectations
- Python scrapers will populate all required columns when run
- Frontend correctly calls backend which correctly queries Supabase
- When the scraper runs (future), data will flow through end-to-end without changes
