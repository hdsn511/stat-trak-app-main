# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StatTrak** is a full-stack sports statistics and trends analysis app focused on identifying betting-relevant player performance trends. Currently only NBA data infrastructure is complete; NFL/MLB/NHL are scaffolded with mock data.

## Architecture

**Three-layer stack:**
1. **`client/`** — React 18 + TypeScript + Vite frontend (port 5173)
2. **`server/`** — Express 5 + TypeScript backend (port 3000)
3. **`server/scripts/`** — Python data pipeline using `nba_api` → Supabase (PostgreSQL)

**Data flow:** Python scripts fetch NBA data → store in Supabase → TypeScript job `computeNBATrends.ts` computes z-scores/rolling averages → Express API serves to React frontend.

**Database:** Supabase (PostgreSQL) with tables: `players`, `teams`, `nba_player_stats`, `nba_trends`. Initialized via `supabaseAdmin.ts` with service role key from `server/.env`.

## Commands

### Frontend (from repo root or `client/`)
```bash
npm run dev           # Vite dev server on :5173
npm run build         # TypeScript check + Vite production build
npm run lint          # ESLint with max-warnings 0
npm run preview       # Preview production build
```

### Backend (from repo root or `server/`)
```bash
npm run dev:server    # Nodemon watching src/server.ts on :3000
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

python server/scripts/nba_init.py          # Initial NBA data population
python server/scripts/resume_nba_stats.py  # Resume incomplete data fetch
python server/scripts/check_missing_stats.py
```

## Key Files

| File | Purpose |
|------|---------|
| `server/.env` | Supabase URL/key, OpenAI key, API-Sports key, PORT |
| `server/src/jobs/computeNBATrends.ts` | Core statistical analysis (z-scores, rolling averages) for 6 NBA stats |
| `client/src/services/api.ts` | API client — base URL hardcoded to `http://localhost:3000/api` |
| `client/src/App.tsx` | Route definitions; tests backend health on mount |
| `server/src/config/supabaseAdmin.ts` | Supabase client initialization |
| `server/src/server.ts` | Express app with middleware (Helmet, CORS, Morgan) |

## Frontend Structure

Routes: `/` (Home/TrendFinder), `/nba`, `/nfl`, `/mlb`, `/nhl`, `/trend-finder`, `/trend-finder/player/:id`

Styling: SCSS + Bootstrap 5. Import order matters — Bootstrap variables before component SCSS.

`TrendFinder` component (`client/src/components/TrendFinder/`) is the main analysis UI. NBA/NFL/MLB/NHL page components under `client/src/pages/` currently use hardcoded mock data awaiting API integration.

## Backend Structure

MVC-like: `routes/` → `controllers/` → `config/` (Supabase, OpenAI, DB). The `jobs/` directory contains scheduled/on-demand data processing.

`computeNBATrends.ts` uses `STAT_CONFIGS` object defining quality thresholds (min season std dev, rolling avg, minutes played) per stat to filter low-volume noise before storing to `nba_trends`.

## TypeScript Configuration

- **Server:** `target: ES2020`, `module: CommonJS`, strict mode
- **Client:** Project references (app + node tsconfigs), `moduleResolution: bundler`
