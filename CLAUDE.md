# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**StatTrak** is a full-stack sports statistics and trends analysis app focused on identifying betting-relevant player performance trends. Currently only NBA data infrastructure is complete; NFL/MLB/NHL render a ComingSoon page.

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
| `client/src/App.tsx` | Route definitions |
| `client/src/index.css` | Global styles, font imports, custom keyframe animations |
| `client/tailwind.config.js` | Design tokens: colors, font families |
| `server/src/config/supabaseAdmin.ts` | Supabase client initialization |
| `server/src/server.ts` | Express app with middleware (Helmet, CORS, Morgan) |

## Frontend Structure

**Routes:** `/` (Home), `/nba`, `/nfl`, `/mlb`, `/nhl`, `/player/:id`

**Styling:** Tailwind CSS + shadcn/ui. No SCSS or Bootstrap. Design tokens live in `tailwind.config.js` and CSS variables in `index.css`.

**Font stack:**
- `font-display` → Doto (logo, large stat numbers)
- `font-condensed` → Barlow Condensed (section labels, headings, stat badges)
- `font-sans` → DM Sans (body text, default)

**Design tokens (tailwind.config.js):**
- `mint` / `mint/DEFAULT` → `#2AFFC8` — primary accent; use for active states, live indicators, positive z-scores
- `surface` / `surface.elevated` → `#141414` / `#1a1a1a`
- `over` → `#22C55E`, `under` → `#EF4444`, `push` → `#EAB308` — hit-rate result colors

**Custom animations (index.css):**
- `animate-bar-grow` — scaleY from 0, use on chart bars with staggered `animationDelay`
- `animate-pulse-live` — opacity/scale pulse, use on live game indicators
- `animate-fade-up` — for dropdowns and modal-like elements

**Layout pattern:** Every page is `<Sidebar /> + <main className="flex-1 overflow-y-auto">`. Header is fixed `h-16`, content area uses `pt-16 h-screen flex flex-col` in App.tsx.

**Component map:**

| Component | Location | Notes |
|-----------|----------|-------|
| Header | `components/Header/Header.tsx` | Fixed top bar; active nav via `useLocation`; player search with debounce |
| Sidebar | `components/Sidebar/Sidebar.tsx` | `w-52`; today's NBA games; VS-layout cards; live pulse dot |
| PickOfTheDay | `components/Home/PickOfTheDay.tsx` | Hero card; large Doto number; radial glow; trend-strength bar |
| TopTrending | `components/Home/TopTrending.tsx` | Ranked list; z-score mini bar per row |
| TrendFinder | `components/TrendFinder/TrendFinder.tsx` | Tab stat selector; line + window filters; player result rows |
| PlayerDetailView | `components/TrendFinder/PlayerDetailView.tsx` | Stat cards + bar chart with absolute threshold line + summary grid |
| ComingSoon | `components/ComingSoon/ComingSoon.tsx` | Used by NFL/MLB/NHL pages; watermark + feature chips |

**Label/heading pattern used throughout:**
```
text-[10px] font-bold text-gray-600 uppercase tracking-[0.2em] font-condensed
```

**Card container pattern:**
```
bg-[#0D0D0D] border border-[#161616] rounded-2xl
```

**Active tab/nav indicator pattern:**
```
absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full
```

## Backend Structure

MVC-like: `routes/` → `controllers/` → `config/` (Supabase, OpenAI, DB). The `jobs/` directory contains scheduled/on-demand data processing.

`computeNBATrends.ts` uses `STAT_CONFIGS` object defining quality thresholds (min season std dev, rolling avg, minutes played) per stat to filter low-volume noise before storing to `nba_trends`.

## TypeScript Configuration

- **Server:** `target: ES2020`, `module: CommonJS`, strict mode
- **Client:** Project references (app + node tsconfigs), `moduleResolution: bundler`
