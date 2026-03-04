# Frontend Refactor Design
**Date:** 2026-03-03
**Scope:** Full clean-slate frontend rewrite — Tailwind + shadcn/ui, NBA-only MVP, backend wiring

---

## Goals

- Replace Bootstrap + SCSS with Tailwind CSS + shadcn/ui
- Delete all dead code and mock data blobs
- Wire frontend to real backend (nba_trends, players, game stats)
- NBA-only for MVP; other sports stubbed as "Coming Soon"
- Mint accent color, dark theme, modern clean look

---

## Visual System

| Token | Value |
|-------|-------|
| Accent (mint) | `#2AFFC8` |
| Background | `#0A0A0A` |
| Card surface | `#141414` |
| Border | `#1E1E1E` |
| Text primary | `#F0F0F0` |
| Text secondary | `#6B7280` |
| Over | `#22C55E` |
| Under | `#EF4444` |
| Push | `#EAB308` |

**Typography:** Doto (logo wordmark only) + Inter (all UI text)
**Icons:** lucide-react (already installed)
**Libraries:** tailwindcss, @tailwindcss/vite, shadcn/ui (Card, Badge, Button, Input, Skeleton, Tabs)

---

## Layout Shell

Header is fixed. Search bar moves into the header (eliminates the separate SearchbarHeader row). Main content scrolls below.

```
┌─────────────────────────────────────────────────┐
│  HEADER (fixed)                                  │
│  StatTrak logo | NBA NFL MLB NHL | [Search]      │
├─────────────────────────────────────────────────┤
│  MAIN CONTENT (scrollable)                       │
│  <Routes />                                      │
└─────────────────────────────────────────────────┘
```

---

## Routes

| Route | Component | Sidebar |
|-------|-----------|---------|
| `/` | HomePage | Yes |
| `/nba` | NBAPage | Yes |
| `/nfl` | ComingSoon | No |
| `/mlb` | ComingSoon | No |
| `/nhl` | ComingSoon | No |
| `/player/:id` | PlayerDetailView | No (full width) |

- `/trend-finder` and `/trend-finder/player/:id` removed — TrendFinder embedded in pages, PlayerDetailView moved to `/player/:id`

---

## Page Layouts

### Home (`/`)
```
┌────────────────┬──────────────────────────────────┐
│  TODAY'S GAMES │  Pick of the Day (hero card)      │
│  (ESPN API)    │  ────────────────────────────────  │
│                │  Top 10 Trending Players          │
│  Game cards    │  (highest z-scores from           │
│  with time,    │   nba_trends, clickable →         │
│  teams, score  │   PlayerDetailView)               │
└────────────────┴──────────────────────────────────┘
```

### NBA (`/nba`)
```
┌────────────────┬──────────────────────────────────┐
│  TODAY'S GAMES │  TrendFinder (NBA only)           │
│  (ESPN API)    │  Stat filter → player results     │
│                │  ────────────────────────────────  │
│  Game cards    │  Top Z-Score Players              │
│                │  (pre-computed, below filter)     │
└────────────────┴──────────────────────────────────┘
```

### PlayerDetailView (`/player/:id`) — full width
```
┌──────────────────────────────────────────────────┐
│  ← Back  |  Player name · team · position        │
├──────────────────────────────────────────────────┤
│  Z-Score summary strip (all 6 stats at a glance) │
├──────────────────────────────────────────────────┤
│  Custom filter: stat | line | games | vs team    │
├──────────────────────────────────────────────────┤
│  Bar chart + hit rate / avg / best game          │
└──────────────────────────────────────────────────┘
```

### NFL / MLB / NHL — full width
```
┌──────────────────────────────────────────────────┐
│  [League]  Coming Soon                           │
│  NBA is live — check it out →                    │
└──────────────────────────────────────────────────┘
```

---

## API Layer

### New Backend Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/nba/trends/top` | Top 10 players by z-score (home, NBA page) |
| GET | `/api/nba/trends?stat=&window=` | Filtered trends for TrendFinder |
| GET | `/api/nba/players/search?q=` | Player search suggestions (header search bar) |
| GET | `/api/nba/players/:id/games` | Game-by-game stats (PlayerDetailView chart) |
| GET | `/api/nba/games/today` | Today's NBA schedule via ESPN proxy (sidebar) |

### Client Service Layer (`client/src/services/api.ts`)
Typed async functions for each endpoint above. No mock data — real Supabase data from `nba_trends` and `nba_player_stats` tables.

### ESPN API
Proxy through Express backend: `GET /api/nba/games/today` calls ESPN's public schedule endpoint and returns simplified game objects `{ homeTeam, awayTeam, time, gameId }`.

---

## Dead Code to Delete

- `client/src/components/Home/Trends.tsx` — never rendered
- `client/src/components/Sidebar/Sidebar.tsx` — always commented out (will be rebuilt)
- `client/src/pages/Home/Home.tsx` — passthrough wrapper only
- All `.scss` files across the project
- Bootstrap imports and dependencies
- All mock data blobs inside NBA.tsx, TrendFinder.tsx, Searchbar.tsx

---

## Components to Build

| Component | Location | Notes |
|-----------|----------|-------|
| Header | `components/Header/Header.tsx` | Logo + nav + inline search |
| Sidebar | `components/Sidebar/Sidebar.tsx` | Today's games, ESPN data |
| PickOfTheDay | `components/Home/PickOfTheDay.tsx` | Hero card, highest z-score player |
| TopTrending | `components/Home/TopTrending.tsx` | Top 10 z-score grid |
| TrendFinder | `components/TrendFinder/TrendFinder.tsx` | NBA-only, real data |
| PlayerDetailView | `components/PlayerDetailView/PlayerDetailView.tsx` | Profile + chart |
| ComingSoon | `components/ComingSoon/ComingSoon.tsx` | Stub for NFL/MLB/NHL |
| HomePage | `pages/Home/Home.tsx` | Composes sidebar + PickOfTheDay + TopTrending |
| NBAPage | `pages/NBA/NBA.tsx` | Composes sidebar + TrendFinder + TopTrending |
