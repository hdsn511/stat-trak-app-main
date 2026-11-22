# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StatTrak** is a full-stack sports statistics and trends analysis app focused on identifying betting-relevant player performance trends. NBA, MLB, NFL and NHL all have real data pipelines and league pages (see `server/src/config/leagues.ts`'s per-league registry); only NBA and MLB have a betting/picks pipeline (`hasMarkets: true`) — NFL and NHL have game and player stat data but no legacy picks pipeline. Separately, NBA and NFL have a Projects pipeline (`analytics/picks/generate_projects.py`, `pick_type='project'`, `GET /api/{league}/projects`), so `daily_lines`/`pick_results` do hold NFL rows even though NFL stays `hasMarkets: false`.

## Architecture

**Three-layer stack:**
1. **`client/`** — React 18 + TypeScript + Vite frontend (port 5173)
2. **`server/`** — Express 5 + TypeScript backend (port 3001, from `server/.env` PORT)
3. **`analytics/`** — Python data pipelines (ESPN API for NBA/NFL/NHL, MLB Stats API for MLB) → Supabase (PostgreSQL)

**Data flow:** Python pipelines in `analytics/` fetch league data from ESPN (no `nba_api`) → store in Supabase → TypeScript job `computeNBATrends.ts` computes z-scores/rolling averages → Express API serves to React frontend.

**Database:** Supabase (PostgreSQL) with tables: `players`, `teams`, `nba_player_stats`, `nba_trends`. Initialized via `supabaseAdmin.ts` with service role key from `server/.env`.

## Commands

### Frontend (from repo root or `client/`)
```bash
npm run dev           # Vite dev server on :5173 (proxies /api to the backend, default :3001)
npm run build         # TypeScript check + Vite production build
npm run lint          # ESLint with max-warnings 0
npm run preview       # Preview production build
```

### Backend (from repo root or `server/`)
```bash
npm run dev:server    # Nodemon watching src/server.ts on :3001
npm run build         # Compile TypeScript to dist/
npm start             # Run compiled dist/server.js
npm run sync-data     # Run NBA data sync scripts via ts-node
```

### Run both concurrently (from repo root)
```bash
npm run dev:both      # Frontend + backend simultaneously
```

### Python data scripts (requires venv)
```bash
# Activate venv first (Windows/WSL)
source venv/Scripts/activate   # or venv/bin/activate on Linux

python -m analytics.batch.backfill_season --since 2025-10-01   # NBA box scores via ESPN (fills gaps)
python -m analytics.batch.nhl_init --rosters --season 2026      # NHL via ESPN
python -m analytics.batch.nfl_init --rosters --season 2026      # NFL via ESPN
python server/scripts/check_missing_stats.py
```

## Key Files

| File | Purpose |
|------|---------|
| `server/.env` | Supabase URL/key, OpenAI key, API-Sports key, PORT |
| `server/src/jobs/computeNBATrends.ts` | Core statistical analysis (z-scores, rolling averages) for 6 NBA stats |
| `client/src/services/api.ts` | API client — relative `/api` (VITE_API_BASE_URL overrides; Vite dev proxy / Cloudflare Pages Function forward it) |
| `client/src/App.tsx` | Route definitions |
| `client/src/index.css` | Global styles, CSS variables, keyframes |
| `client/vite.config.ts` | Dev proxy: `/api` → `VITE_DEV_API_TARGET` or `http://localhost:3001` |
| `server/src/config/supabaseAdmin.ts` | Supabase client initialization |
| `server/src/server.ts` | Express app with middleware (Helmet, CORS, Morgan) |

## Frontend Structure

**Routes (`client/src/App.tsx`):** `/` Home, `/nba` `/nfl` `/mlb` `/nhl` league pages, `/player/:league/:id`, `/game/:league/:id`, `/team/:league/:id`, `/sportquery[/:sessionId]`, `/login`, `/profile`, `/about`, `/terms`, `/privacy`. Old unqualified `/player/:id`, `/game/:id`, `/team/:id` redirect to the NBA-qualified path.

**UI system ("Ember", `client/src/ember/`):** top-bar layout (`components/EmberHeader`, nav collapses to its own row below ~1180px), dark warm palette, orange accent `#FF6B3D`, hit/miss green `#3FBF7F` / red `#FF6B5C`. Fonts: Space Grotesk (sans) and Space Mono, loaded in `client/index.html`. Ember components use `font-chakra` / `font-martian` class names that are NOT defined in tailwind.config.js (no-ops today, so text renders in Space Grotesk): define them or drop them. Tailwind + a few shadcn-style CSS variables in `client/src/index.css`. The old Sidebar layout, mint tokens and Doto font are gone: do not reintroduce them.

**Ember folders:** `home/` (signals, league cards), `league/` (standings, picks, trending), `game/` (ScoreHeader, BestProps, StreaksTable, TaleOfTape, tables), `player/` (PlayerView + filters, chart, matchup panel), `team/`, `sportquery/`, `auth/`, `components/` (shared: ModuleCard, TrendingPlayers, StreakWatch, PropVisuals, LiveTicker, GlobalSearch, PlayerAvatar).

**Linking convention:** build player/game/team URLs with `lib/paths.ts` (`playerPath(league, id, {stat, line, window})` carries the row's stat/line/window as query params so the player page opens on them).

**Time convention:** show tipoff times in the viewer's zone with the zone name (`formatGameTime(iso, true)`); show years on dates that can be from a past season (`formatGameDateYear`).

## Backend Structure

MVC-like: `routes/` → `controllers/` → `config/` (Supabase, OpenAI, DB). The `jobs/` directory contains scheduled/on-demand data processing.

`computeNBATrends.ts` uses `STAT_CONFIGS` object defining quality thresholds (min season std dev, rolling avg, minutes played) per stat to filter low-volume noise before storing to `nba_trends`.

## TypeScript Configuration

- **Server:** `target: ES2020`, `module: CommonJS`, strict mode
- **Client:** Project references (app + node tsconfigs), `moduleResolution: bundler`
