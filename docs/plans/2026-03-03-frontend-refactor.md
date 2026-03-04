# Frontend Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Bootstrap + SCSS with Tailwind CSS + shadcn/ui, wire the frontend to real NBA backend data, add sidebar with today's games, and implement pick-of-the-day + top trending player sections.

**Architecture:** Full clean-slate rewrite — delete all dead code and mock data first, then rebuild each layer (backend routes → client API service → components → pages). The backend gains 5 new Express routes querying Supabase `nba_trends` and `nba_player_stats`. The client replaces all mock data with typed fetch calls.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS v3, shadcn/ui, Vitest + React Testing Library, lucide-react, Express 5 + Supabase (server)

---

## Reference

**Supabase tables:**
- `players` — `id, name, team, position, league, is_active`
- `nba_player_stats` — `game_id, player_id, team_id, points, rebounds, assists, three_points_made, fouls, minutes_played, game_date`
- `nba_trends` — `player_id, stat (0-5), window_size, trend_val (z-score), rolling_avg, season_avg, season_std`

**Stat ID map:** `0=points, 1=rebounds, 2=assists, 3=threes, 4=fouls, 5=minutes`

**ESPN schedule API (public, no auth):**
`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`

**Key file paths:**
- Entry point: `client/src/Main.tsx`
- App shell: `client/src/App.tsx`
- Server: `server/src/server.ts`
- Supabase client: `server/src/config/supabaseAdmin.ts`

---

## Task 1: Install dependencies + testing infrastructure

**Files:**
- Modify: `client/package.json`
- Create: `client/vite.config.ts`
- Create: `client/tsconfig.app.json` (modify paths)
- Create: `client/vitest.config.ts`
- Create: `client/src/test/setup.ts`

**Step 1: Install Tailwind + shadcn/ui dependencies**

Run from `client/`:
```bash
npm install tailwindcss@3 postcss autoprefixer
npm install class-variance-authority clsx tailwind-merge
npm install @radix-ui/react-slot
npx tailwindcss init -p
```

**Step 2: Install shadcn/ui**

Run from `client/`:
```bash
npx shadcn@latest init
```

When prompted:
- Style: `Default`
- Base color: `Zinc`
- CSS variables: `Yes`

This creates `components.json`, `src/lib/utils.ts`, and updates `src/index.css`.

**Step 3: Add path alias to vite.config.ts**

```ts
// client/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

Also install: `npm install -D @types/node`

**Step 4: Add path alias to tsconfig.app.json**

Find the `compilerOptions` section in `client/tsconfig.app.json` and add:
```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

**Step 5: Install Vitest + React Testing Library**

Run from `client/`:
```bash
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

**Step 6: Create vitest config**

```ts
// client/vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Step 7: Create test setup file**

```ts
// client/src/test/setup.ts
import '@testing-library/jest-dom'
```

**Step 8: Add test script to package.json**

In `client/package.json` scripts, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 9: Run tests to verify setup**

```bash
cd client && npm test
```
Expected: 0 tests found, no errors.

**Step 10: Commit**

```bash
git add client/
git commit -m "feat: install Tailwind, shadcn/ui, Vitest"
```

---

## Task 2: Delete dead code + remove Bootstrap

**Files:**
- Delete: `client/src/components/Home/Trends.tsx`
- Delete: `client/src/components/Home/trends.scss`
- Delete: `client/src/components/Sidebar/Sidebar.tsx`
- Delete: `client/src/components/Sidebar/sidebar.scss`
- Delete: `client/src/pages/Home/Home.tsx`
- Delete: `client/src/pages/Home/home.scss`
- Delete: `client/src/styles/App.scss`
- Delete: `client/src/styles/global/variables.scss`
- Delete: `client/src/styles/global/mixins.scss`
- Delete: `client/src/styles/global/main.scss`
- Delete: `client/src/pages/NBA/nba.scss`
- Delete: `client/src/pages/NFL/nfl.scss`
- Delete: `client/src/pages/MLB/mlb.scss`
- Delete: `client/src/pages/NHL/nhl.scss`
- Delete: `client/src/components/Header/header.scss`
- Delete: `client/src/components/Searchbar/searchbar.scss`
- Delete: `client/src/components/TrendFinder/trendfinder.scss`
- Delete: `client/src/components/TrendFinder/playerdetailview.scss`
- Delete: `client/src/components/Footer/footer.scss`

**Step 1: Delete all SCSS files and dead components**

```bash
cd client
rm src/components/Home/Trends.tsx src/components/Home/trends.scss
rm src/components/Sidebar/Sidebar.tsx src/components/Sidebar/sidebar.scss
rm src/pages/Home/Home.tsx src/pages/Home/home.scss
rm src/styles/App.scss src/styles/global/variables.scss src/styles/global/mixins.scss src/styles/global/main.scss
rm src/pages/NBA/nba.scss src/pages/NFL/nfl.scss src/pages/MLB/mlb.scss src/pages/NHL/nhl.scss
rm src/components/Header/header.scss src/components/Searchbar/searchbar.scss
rm src/components/TrendFinder/trendfinder.scss src/components/TrendFinder/playerdetailview.scss
rm src/components/Footer/footer.scss
```

**Step 2: Remove Bootstrap from Main.tsx**

Replace `client/src/Main.tsx` with:
```tsx
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
```

**Step 3: Uninstall Bootstrap + sass**

```bash
cd client && npm uninstall bootstrap sass
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete dead code, remove Bootstrap + SCSS"
```

---

## Task 3: Configure design tokens

**Files:**
- Modify: `client/src/index.css`
- Modify: `client/tailwind.config.js`

**Step 1: Update tailwind.config.js with mint color + dark theme**

```js
// client/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mint: {
          DEFAULT: '#2AFFC8',
          50: '#edfff9',
          100: '#c8fff0',
          200: '#94ffe2',
          300: '#2AFFC8',
          400: '#00e8ae',
          500: '#00c994',
          600: '#00a077',
        },
        surface: {
          DEFAULT: '#141414',
          elevated: '#1a1a1a',
        },
        border: '#1E1E1E',
        over: '#22C55E',
        under: '#EF4444',
        push: '#EAB308',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Doto', 'sans-serif'],
      },
      backgroundColor: {
        app: '#0A0A0A',
      },
    },
  },
  plugins: [],
}
```

**Step 2: Update index.css with CSS variables + font imports**

```css
/* client/src/index.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Doto:wght@700;900&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 4%;
    --foreground: 0 0% 94%;
    --card: 0 0% 8%;
    --card-foreground: 0 0% 94%;
    --primary: 166 100% 58%;
    --primary-foreground: 0 0% 4%;
    --muted: 0 0% 15%;
    --muted-foreground: 220 9% 46%;
    --border: 0 0% 12%;
    --input: 0 0% 12%;
    --ring: 166 100% 58%;
    --radius: 0.75rem;
  }

  * {
    border-color: hsl(var(--border));
  }

  body {
    background-color: #0A0A0A;
    color: hsl(var(--foreground));
    font-family: 'Inter', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* Custom scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #0A0A0A; }
  ::-webkit-scrollbar-thumb { background: #2AFFC8; border-radius: 3px; }
}
```

**Step 3: Install shadcn components needed**

```bash
cd client
npx shadcn@latest add card badge button input skeleton tabs
```

**Step 4: Verify dev server compiles**

```bash
cd client && npm run dev
```
Expected: No errors, blank page (App.tsx still has broken imports — that's fine for now).

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: configure Tailwind design tokens + mint theme"
```

---

## Task 4: Build backend NBA routes

**Files:**
- Modify: `server/src/server.ts`
- Create: `server/src/routes/nba.ts`
- Create: `server/src/controllers/nbaController.ts`

**Step 1: Create NBA controller**

```ts
// server/src/controllers/nbaController.ts
import { supabaseAdmin } from '../config/supabaseAdmin';

const STAT_NAMES: Record<number, string> = {
  0: 'points', 1: 'rebounds', 2: 'assists',
  3: 'threes', 4: 'fouls', 5: 'minutes'
};

export async function getTopTrending(req: any, res: any) {
  try {
    const { data, error } = await supabaseAdmin
      .from('nba_trends')
      .select('player_id, stat, window_size, trend_val, rolling_avg, players(name, team, position)')
      .order('trend_val', { ascending: false })
      .eq('window_size', 10)
      .limit(10);

    if (error) throw error;

    const result = data.map((row: any) => ({
      playerId: row.player_id,
      playerName: row.players?.name,
      team: row.players?.team,
      position: row.players?.position,
      stat: STAT_NAMES[row.stat],
      statId: row.stat,
      zScore: row.trend_val,
      rollingAvg: row.rolling_avg,
      windowSize: row.window_size,
    }));

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTrends(req: any, res: any) {
  try {
    const { stat, window = '10', threshold = '0' } = req.query as Record<string, string>;

    let query = supabaseAdmin
      .from('nba_trends')
      .select('player_id, stat, window_size, trend_val, rolling_avg, season_avg, players(name, team, position)')
      .eq('window_size', parseInt(window))
      .order('trend_val', { ascending: false });

    if (stat !== undefined) {
      const statId = Object.entries(STAT_NAMES).find(([, name]) => name === stat)?.[0];
      if (statId !== undefined) query = query.eq('stat', parseInt(statId));
    }

    if (parseFloat(threshold) > 0) {
      query = query.gte('rolling_avg', parseFloat(threshold));
    }

    const { data, error } = await query;
    if (error) throw error;

    const result = data.map((row: any) => ({
      playerId: row.player_id,
      playerName: row.players?.name,
      team: row.players?.team,
      position: row.players?.position,
      stat: STAT_NAMES[row.stat],
      statId: row.stat,
      zScore: row.trend_val,
      rollingAvg: row.rolling_avg,
      seasonAvg: row.season_avg,
      windowSize: row.window_size,
    }));

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function searchPlayers(req: any, res: any) {
  try {
    const { q = '' } = req.query as Record<string, string>;
    if (q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const { data, error } = await supabaseAdmin
      .from('players')
      .select('id, name, team, position')
      .ilike('name', `%${q}%`)
      .eq('league', 'nba')
      .eq('is_active', true)
      .limit(10);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getPlayerGames(req: any, res: any) {
  try {
    const { id } = req.params;

    const { data: playerData, error: playerError } = await supabaseAdmin
      .from('players')
      .select('id, name, team, position')
      .eq('id', parseInt(id))
      .single();

    if (playerError) throw playerError;

    const { data: statsData, error: statsError } = await supabaseAdmin
      .from('nba_player_stats')
      .select('game_id, points, rebounds, assists, three_points_made, fouls, minutes_played, game_date, teams(abbreviation)')
      .eq('player_id', parseInt(id))
      .order('game_date', { ascending: false })
      .limit(20);

    if (statsError) throw statsError;

    const { data: trendsData, error: trendsError } = await supabaseAdmin
      .from('nba_trends')
      .select('stat, trend_val, rolling_avg, window_size')
      .eq('player_id', parseInt(id))
      .eq('window_size', 10);

    if (trendsError) throw trendsError;

    const zScores: Record<string, number> = {};
    const rollingAvgs: Record<string, number> = {};
    for (const t of (trendsData || [])) {
      const statName = STAT_NAMES[t.stat];
      zScores[statName] = t.trend_val;
      rollingAvgs[statName] = t.rolling_avg;
    }

    res.json({
      success: true,
      data: {
        player: playerData,
        games: (statsData || []).map((g: any) => ({
          gameId: g.game_id,
          date: g.game_date,
          opponent: g.teams?.abbreviation,
          points: g.points,
          rebounds: g.rebounds,
          assists: g.assists,
          threes: g.three_points_made,
          fouls: g.fouls,
          minutes: g.minutes_played,
        })),
        zScores,
        rollingAvgs,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getTodaysGames(req: any, res: any) {
  try {
    const response = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
    );
    const json = await response.json() as any;

    const games = (json.events || []).map((event: any) => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      return {
        gameId: event.id,
        time: comp?.date,
        status: event.status?.type?.shortDetail,
        home: { team: home?.team?.abbreviation, score: home?.score },
        away: { team: away?.team?.abbreviation, score: away?.score },
      };
    });

    res.json({ success: true, data: games });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
```

**Step 2: Create NBA routes**

```ts
// server/src/routes/nba.ts
const express = require('express');
const router = express.Router();
const {
  getTopTrending,
  getTrends,
  searchPlayers,
  getPlayerGames,
  getTodaysGames,
} = require('../controllers/nbaController');

router.get('/trends/top', getTopTrending);
router.get('/trends', getTrends);
router.get('/players/search', searchPlayers);
router.get('/players/:id/games', getPlayerGames);
router.get('/games/today', getTodaysGames);

module.exports = router;
```

**Step 3: Register routes in server.ts**

Replace `server/src/server.ts` with:
```ts
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

app.get('/health', (req: any, res: any) => {
  res.json({ status: 'OK', message: 'StatTrak API is running!', timestamp: new Date().toISOString() });
});

const nbaRoutes = require('./routes/nba');
app.use('/api/nba', nbaRoutes);

app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
});
```

**Step 4: Start the server and test each endpoint**

```bash
cd server && npm run dev
```

In another terminal:
```bash
curl http://localhost:3000/api/nba/trends/top
curl http://localhost:3000/api/nba/trends?stat=points&window=10&threshold=20
curl "http://localhost:3000/api/nba/players/search?q=lebron"
curl http://localhost:3000/api/nba/games/today
```
Expected: JSON with `{ success: true, data: [...] }` for each.

**Step 5: Commit**

```bash
git add server/src/
git commit -m "feat: add NBA backend routes (trends, players, ESPN games)"
```

---

## Task 5: Build client API service

**Files:**
- Modify: `client/src/services/api.ts`
- Create: `client/src/services/api.test.ts`

**Step 1: Write failing tests**

```ts
// client/src/services/api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nbaApi } from './api'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

const mockResponse = (data: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data }) } as Response)

describe('nbaApi.getTopTrending', () => {
  it('returns trending players array', async () => {
    mockFetch.mockReturnValueOnce(mockResponse([{ playerId: 1, playerName: 'LeBron James' }]))
    const result = await nbaApi.getTopTrending()
    expect(result).toHaveLength(1)
    expect(result[0].playerName).toBe('LeBron James')
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/nba/trends/top')
  })
})

describe('nbaApi.getTrends', () => {
  it('fetches with stat and window params', async () => {
    mockFetch.mockReturnValueOnce(mockResponse([]))
    await nbaApi.getTrends({ stat: 'points', window: 10, threshold: 25 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/nba/trends?stat=points&window=10&threshold=25'
    )
  })
})

describe('nbaApi.searchPlayers', () => {
  it('fetches with query param', async () => {
    mockFetch.mockReturnValueOnce(mockResponse([]))
    await nbaApi.searchPlayers('lebron')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/nba/players/search?q=lebron'
    )
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
cd client && npm test
```
Expected: FAIL — `nbaApi` not exported from `./api`

**Step 3: Write the API service**

```ts
// client/src/services/api.ts
const BASE = 'http://localhost:3000/api'

export interface TrendingPlayer {
  playerId: number
  playerName: string
  team: string
  position: string
  stat: string
  statId: number
  zScore: number
  rollingAvg: number
  windowSize: number
  seasonAvg?: number
}

export interface PlayerSearchResult {
  id: number
  name: string
  team: string
  position: string
}

export interface GameStat {
  gameId: number
  date: string
  opponent: string
  points: number
  rebounds: number
  assists: number
  threes: number
  fouls: number
  minutes: number
}

export interface PlayerProfile {
  player: PlayerSearchResult
  games: GameStat[]
  zScores: Record<string, number>
  rollingAvgs: Record<string, number>
}

export interface TodaysGame {
  gameId: string
  time: string
  status: string
  home: { team: string; score: string }
  away: { team: string; score: string }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Request failed')
  return json.data as T
}

export const nbaApi = {
  getTopTrending: () =>
    get<TrendingPlayer[]>(`${BASE}/nba/trends/top`),

  getTrends: (params: { stat?: string; window?: number; threshold?: number }) => {
    const q = new URLSearchParams()
    if (params.stat) q.set('stat', params.stat)
    if (params.window) q.set('window', String(params.window))
    if (params.threshold) q.set('threshold', String(params.threshold))
    return get<TrendingPlayer[]>(`${BASE}/nba/trends?${q}`)
  },

  searchPlayers: (query: string) =>
    get<PlayerSearchResult[]>(`${BASE}/nba/players/search?q=${encodeURIComponent(query)}`),

  getPlayerProfile: (id: number) =>
    get<PlayerProfile>(`${BASE}/nba/players/${id}/games`),

  getTodaysGames: () =>
    get<TodaysGame[]>(`${BASE}/nba/games/today`),
}
```

**Step 4: Run tests to verify they pass**

```bash
cd client && npm test
```
Expected: PASS — 3 tests passing.

**Step 5: Commit**

```bash
git add client/src/services/
git commit -m "feat: typed NBA API client service"
```

---

## Task 6: Rebuild Header with inline search

**Files:**
- Modify: `client/src/components/Header/Header.tsx`
- Create: `client/src/components/Header/Header.test.tsx`

**Step 1: Write failing test**

```tsx
// client/src/components/Header/Header.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import Header from './Header'

vi.mock('@/services/api', () => ({
  nbaApi: { searchPlayers: vi.fn().mockResolvedValue([]) }
}))

describe('Header', () => {
  it('renders the StatTrak logo', () => {
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.getByText('Stat')).toBeInTheDocument()
    expect(screen.getByText('Trak')).toBeInTheDocument()
  })

  it('renders all sport nav links', () => {
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.getByText('NBA')).toBeInTheDocument()
    expect(screen.getByText('NFL')).toBeInTheDocument()
    expect(screen.getByText('MLB')).toBeInTheDocument()
    expect(screen.getByText('NHL')).toBeInTheDocument()
  })

  it('renders search input', () => {
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.getByPlaceholderText('Search players...')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd client && npm test
```
Expected: FAIL — cannot find module

**Step 3: Write Header component**

```tsx
// client/src/components/Header/Header.tsx
import { useState, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { nbaApi, PlayerSearchResult } from '@/services/api'

const NAV_LINKS = [
  { label: 'NBA', href: '/nba' },
  { label: 'NFL', href: '/nfl' },
  { label: 'MLB', href: '/mlb' },
  { label: 'NHL', href: '/nhl' },
]

export default function Header() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<PlayerSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (val.trim().length < 2) { setSuggestions([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      const results = await nbaApi.searchPlayers(val)
      setSuggestions(results)
      setOpen(results.length > 0)
    }, 250)
  }, [])

  const handleSelect = useCallback((player: PlayerSearchResult) => {
    setQuery('')
    setSuggestions([])
    setOpen(false)
    navigate(`/player/${player.id}`, { state: { player } })
  }, [navigate])

  const handleBlur = useCallback(() => {
    setTimeout(() => setOpen(false), 150)
  }, [])

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[#0A0A0A]/95 backdrop-blur border-b border-[#1E1E1E] flex items-center px-6 gap-8">
      {/* Logo */}
      <Link to="/" className="flex-shrink-0">
        <span className="font-display text-xl font-black text-mint">Stat</span>
        <span className="font-display text-xl font-black text-white">Trak</span>
      </Link>

      {/* Nav */}
      <nav className="flex gap-1">
        {NAV_LINKS.map(link => (
          <Link
            key={link.href}
            to={link.href}
            className="px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-colors"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Search */}
      <div className="relative ml-auto w-64">
        <div className="flex items-center gap-2 bg-surface border border-[#1E1E1E] rounded-lg px-3 py-2">
          <Search size={14} className="text-gray-500 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Search players..."
            className="bg-transparent text-sm text-white placeholder-gray-500 outline-none w-full"
          />
        </div>
        {open && (
          <ul className="absolute top-full mt-1 left-0 right-0 bg-surface border border-[#1E1E1E] rounded-lg overflow-hidden z-50 shadow-xl">
            {suggestions.map(player => (
              <li
                key={player.id}
                onClick={() => handleSelect(player)}
                className="px-4 py-2.5 text-sm cursor-pointer hover:bg-white/5 flex justify-between items-center"
              >
                <span className="text-white">{player.name}</span>
                <span className="text-gray-500 text-xs">{player.team} · {player.position}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  )
}
```

**Step 4: Run tests**

```bash
cd client && npm test
```
Expected: PASS — 3 tests passing.

**Step 5: Commit**

```bash
git add client/src/components/Header/
git commit -m "feat: rebuild Header with inline player search"
```

---

## Task 7: Build Sidebar (Today's Games)

**Files:**
- Create: `client/src/components/Sidebar/Sidebar.tsx`
- Create: `client/src/components/Sidebar/Sidebar.test.tsx`

**Step 1: Write failing test**

```tsx
// client/src/components/Sidebar/Sidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from './Sidebar'

vi.mock('@/services/api', () => ({
  nbaApi: {
    getTodaysGames: vi.fn().mockResolvedValue([
      {
        gameId: '1',
        status: '7:30 PM ET',
        home: { team: 'LAL', score: '' },
        away: { team: 'GSW', score: '' },
      }
    ])
  }
}))

describe('Sidebar', () => {
  it('renders today\'s games heading', async () => {
    render(<Sidebar />)
    expect(screen.getByText("Today's Games")).toBeInTheDocument()
  })

  it('renders game matchup after load', async () => {
    render(<Sidebar />)
    expect(await screen.findByText('LAL')).toBeInTheDocument()
    expect(await screen.findByText('GSW')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd client && npm test
```
Expected: FAIL — Sidebar not found

**Step 3: Write Sidebar component**

```tsx
// client/src/components/Sidebar/Sidebar.tsx
import { useEffect, useState } from 'react'
import { nbaApi, TodaysGame } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Calendar } from 'lucide-react'

export default function Sidebar() {
  const [games, setGames] = useState<TodaysGame[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTodaysGames()
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <aside className="w-52 flex-shrink-0 border-r border-[#1E1E1E] bg-[#0A0A0A] overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={14} className="text-mint" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Today's Games</span>
        </div>

        {loading && (
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full bg-surface" />)}
          </div>
        )}

        {!loading && games.length === 0 && (
          <p className="text-xs text-gray-600">No games today</p>
        )}

        {!loading && games.map(game => (
          <div key={game.gameId} className="mb-3 p-3 bg-surface rounded-lg border border-[#1E1E1E]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-white">{game.away.team}</span>
              {game.away.score && <span className="text-sm font-bold text-white">{game.away.score}</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{game.home.team}</span>
              {game.home.score && <span className="text-sm font-bold text-white">{game.home.score}</span>}
            </div>
            <div className="mt-1.5 text-xs text-mint">{game.status}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}
```

**Step 4: Run tests**

```bash
cd client && npm test
```
Expected: PASS

**Step 5: Commit**

```bash
git add client/src/components/Sidebar/
git commit -m "feat: Sidebar with today's NBA games from ESPN"
```

---

## Task 8: Build PlayerDetailView

**Files:**
- Modify: `client/src/components/TrendFinder/PlayerDetailView.tsx`
- Create: `client/src/components/TrendFinder/PlayerDetailView.test.tsx`

**Step 1: Write failing test**

```tsx
// client/src/components/TrendFinder/PlayerDetailView.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import PlayerDetailView from './PlayerDetailView'

const mockProfile = {
  player: { id: 1, name: 'LeBron James', team: 'LAL', position: 'SF' },
  games: [
    { gameId: 1, date: '2024-01-15', opponent: 'BOS', points: 28, rebounds: 7, assists: 8, threes: 1, fouls: 2, minutes: 36 },
  ],
  zScores: { points: 1.8, rebounds: 0.5, assists: 1.2 },
  rollingAvgs: { points: 27.4, rebounds: 7.1, assists: 8.2 },
}

vi.mock('@/services/api', () => ({
  nbaApi: { getPlayerProfile: vi.fn().mockResolvedValue(mockProfile) }
}))

describe('PlayerDetailView', () => {
  it('renders player name after load', async () => {
    render(
      <MemoryRouter initialEntries={['/player/1']}>
        <Routes>
          <Route path="/player/:id" element={<PlayerDetailView />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('LeBron James')).toBeInTheDocument()
  })

  it('renders z-score summary strip', async () => {
    render(
      <MemoryRouter initialEntries={['/player/1']}>
        <Routes>
          <Route path="/player/:id" element={<PlayerDetailView />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('points')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd client && npm test
```
Expected: FAIL

**Step 3: Write PlayerDetailView**

```tsx
// client/src/components/TrendFinder/PlayerDetailView.tsx
import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { nbaApi, PlayerProfile, GameStat } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

const STATS = ['points', 'rebounds', 'assists', 'threes'] as const
type StatKey = typeof STATS[number]

const STAT_LABELS: Record<StatKey, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM'
}

function zScoreColor(z: number) {
  if (z >= 1.5) return 'text-mint'
  if (z >= 0.5) return 'text-green-400'
  if (z <= -1.5) return 'text-red-400'
  if (z <= -0.5) return 'text-orange-400'
  return 'text-gray-400'
}

export default function PlayerDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeStat, setActiveStat] = useState<StatKey>('points')
  const [threshold, setThreshold] = useState(20)
  const [gameWindow, setGameWindow] = useState(10)

  useEffect(() => {
    if (!id) return
    nbaApi.getPlayerProfile(parseInt(id))
      .then(data => { setProfile(data); if (data.rollingAvgs.points) setThreshold(Math.floor(data.rollingAvgs.points)) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  const chartGames = useMemo(() => {
    if (!profile) return []
    return profile.games.slice(0, gameWindow)
  }, [profile, gameWindow])

  const maxVal = useMemo(() => Math.max(...chartGames.map(g => g[activeStat as keyof GameStat] as number), threshold), [chartGames, activeStat, threshold])

  const hitRate = useMemo(() => {
    if (!chartGames.length) return 0
    const hits = chartGames.filter(g => (g[activeStat as keyof GameStat] as number) >= threshold).length
    return Math.round((hits / chartGames.length) * 100)
  }, [chartGames, activeStat, threshold])

  if (loading) return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-16 w-64 bg-surface" />
      <Skeleton className="h-32 w-full bg-surface" />
    </div>
  )

  if (!profile) return <div className="p-6 text-gray-400">Player not found</div>

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back + Player header */}
      <div>
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 transition-colors">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-surface border border-[#1E1E1E] flex items-center justify-center text-lg font-bold text-mint">
            {profile.player.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{profile.player.name}</h1>
            <p className="text-sm text-gray-400">{profile.player.team} · {profile.player.position}</p>
          </div>
        </div>
      </div>

      {/* Z-Score strip */}
      <div className="grid grid-cols-4 gap-3">
        {STATS.map(stat => (
          <button
            key={stat}
            onClick={() => setActiveStat(stat)}
            className={`p-3 rounded-xl border transition-all text-left ${activeStat === stat ? 'border-mint bg-mint/10' : 'border-[#1E1E1E] bg-surface hover:border-gray-600'}`}
          >
            <div className="text-xs text-gray-500 mb-1">{STAT_LABELS[stat]}</div>
            <div className={`text-xl font-bold ${activeStat === stat ? 'text-mint' : zScoreColor(profile.zScores[stat] ?? 0)}`}>
              {profile.rollingAvgs[stat]?.toFixed(1) ?? '—'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              z: {profile.zScores[stat] != null ? (profile.zScores[stat] > 0 ? '+' : '') + profile.zScores[stat].toFixed(2) : '—'}
            </div>
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Line:</span>
          <input
            type="number"
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-20 bg-surface border border-[#1E1E1E] rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-mint"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Games:</span>
          {[5, 10, 15, 20].map(n => (
            <button
              key={n}
              onClick={() => setGameWindow(n)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${gameWindow === n ? 'bg-mint text-black' : 'bg-surface text-gray-400 hover:text-white border border-[#1E1E1E]'}`}
            >
              L{n}
            </button>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-surface border border-[#1E1E1E] rounded-xl p-4">
        <div className="flex items-end gap-1.5 h-48">
          {chartGames.map((game, i) => {
            const val = game[activeStat as keyof GameStat] as number
            const pct = maxVal > 0 ? (val / maxVal) * 100 : 0
            const isOver = val >= threshold
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group relative">
                <div
                  className={`w-full rounded-t transition-all ${isOver ? 'bg-mint/80 hover:bg-mint' : 'bg-red-500/70 hover:bg-red-500'}`}
                  style={{ height: `${Math.max(pct, 4)}%` }}
                />
                <span className="text-[10px] text-gray-600 group-hover:text-gray-300">{game.opponent}</span>
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block bg-black border border-[#1E1E1E] rounded px-2 py-1 text-xs text-white whitespace-nowrap z-10">
                  {val} {STAT_LABELS[activeStat]} vs {game.opponent}
                </div>
              </div>
            )
          })}
        </div>
        {/* Threshold line annotation */}
        <div className="mt-2 flex items-center gap-2">
          <div className="w-3 h-0.5 bg-mint" />
          <span className="text-xs text-gray-500">Line: {threshold}+</span>
          <Badge className="ml-auto bg-mint/10 text-mint border-mint/20">{hitRate}% hit rate</Badge>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Hit Rate', value: `${hitRate}%` },
          { label: `L${gameWindow} Avg`, value: chartGames.length ? (chartGames.reduce((s, g) => s + (g[activeStat as keyof GameStat] as number), 0) / chartGames.length).toFixed(1) : '—' },
          { label: 'Best Game', value: chartGames.length ? Math.max(...chartGames.map(g => g[activeStat as keyof GameStat] as number)) : '—' },
        ].map(item => (
          <div key={item.label} className="bg-surface border border-[#1E1E1E] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">{item.value}</div>
            <div className="text-xs text-gray-500 mt-1">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 4: Run tests**

```bash
cd client && npm test
```
Expected: PASS

**Step 5: Commit**

```bash
git add client/src/components/TrendFinder/PlayerDetailView.tsx client/src/components/TrendFinder/PlayerDetailView.test.tsx
git commit -m "feat: rebuild PlayerDetailView with z-score strip + bar chart"
```

---

## Task 9: Build TrendFinder (NBA-only, real data)

**Files:**
- Modify: `client/src/components/TrendFinder/TrendFinder.tsx`

**Step 1: Write failing test**

```tsx
// client/src/components/TrendFinder/TrendFinder.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import TrendFinder from './TrendFinder'

vi.mock('@/services/api', () => ({
  nbaApi: { getTrends: vi.fn().mockResolvedValue([]) }
}))

describe('TrendFinder', () => {
  it('renders stat filter buttons', () => {
    render(<MemoryRouter><TrendFinder /></MemoryRouter>)
    expect(screen.getByText('PTS')).toBeInTheDocument()
    expect(screen.getByText('REB')).toBeInTheDocument()
    expect(screen.getByText('AST')).toBeInTheDocument()
    expect(screen.getByText('3PM')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd client && npm test
```
Expected: FAIL

**Step 3: Write TrendFinder**

```tsx
// client/src/components/TrendFinder/TrendFinder.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { SlidersHorizontal } from 'lucide-react'

const STATS = [
  { id: 'points', label: 'PTS' },
  { id: 'rebounds', label: 'REB' },
  { id: 'assists', label: 'AST' },
  { id: 'threes', label: '3PM' },
]
const WINDOWS = [5, 10, 15, 20]

export default function TrendFinder() {
  const navigate = useNavigate()
  const [stat, setStat] = useState('points')
  const [threshold, setThreshold] = useState('')
  const [window, setWindow] = useState(10)
  const [players, setPlayers] = useState<TrendingPlayer[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const t = parseFloat(threshold)
    if (!stat || !window) return
    setLoading(true)
    setSearched(true)
    nbaApi.getTrends({ stat, window, threshold: t > 0 ? t : undefined })
      .then(setPlayers)
      .catch(() => setPlayers([]))
      .finally(() => setLoading(false))
  }, [stat, window, threshold])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <SlidersHorizontal size={16} className="text-mint" />
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Trend Finder</h2>
      </div>

      {/* Stat selector */}
      <div className="flex flex-wrap gap-2">
        {STATS.map(s => (
          <button
            key={s.id}
            onClick={() => setStat(s.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${stat === s.id ? 'bg-mint text-black' : 'bg-surface border border-[#1E1E1E] text-gray-400 hover:text-white'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Threshold + window */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Line:</span>
          <input
            type="number"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            placeholder="e.g. 20"
            className="w-24 bg-surface border border-[#1E1E1E] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 outline-none focus:border-mint"
          />
          <span className="text-xs text-gray-500">+</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Games:</span>
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${window === w ? 'bg-mint text-black' : 'bg-surface text-gray-400 hover:text-white border border-[#1E1E1E]'}`}
            >
              L{w}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="space-y-2">
          {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full bg-surface" />)}
        </div>
      )}

      {!loading && searched && players.length === 0 && (
        <div className="py-8 text-center text-gray-600 text-sm">No players match these filters</div>
      )}

      {!loading && players.map(player => (
        <button
          key={`${player.playerId}-${player.statId}`}
          onClick={() => navigate(`/player/${player.playerId}`, { state: { player } })}
          className="w-full flex items-center gap-4 p-4 bg-surface border border-[#1E1E1E] rounded-xl hover:border-mint/40 hover:bg-mint/5 transition-all text-left"
        >
          <div className="w-10 h-10 rounded-full bg-[#1E1E1E] flex items-center justify-center text-sm font-bold text-mint flex-shrink-0">
            {player.playerName?.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white truncate">{player.playerName}</div>
            <div className="text-xs text-gray-500">{player.team} · {player.position}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-lg font-bold text-white">{player.rollingAvg.toFixed(1)}</div>
            <div className="text-xs text-gray-500">avg {STATS.find(s => s.id === player.stat)?.label}</div>
          </div>
          <Badge className={`flex-shrink-0 ${player.zScore >= 1.5 ? 'bg-mint/10 text-mint border-mint/20' : player.zScore >= 0.5 ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
            {player.zScore > 0 ? '+' : ''}{player.zScore.toFixed(2)}σ
          </Badge>
        </button>
      ))}
    </div>
  )
}
```

**Step 4: Run tests**

```bash
cd client && npm test
```
Expected: PASS

**Step 5: Commit**

```bash
git add client/src/components/TrendFinder/
git commit -m "feat: rebuild TrendFinder NBA-only with real data"
```

---

## Task 10: Build PickOfTheDay + TopTrending

**Files:**
- Create: `client/src/components/Home/PickOfTheDay.tsx`
- Create: `client/src/components/Home/TopTrending.tsx`

**Step 1: Write PickOfTheDay**

```tsx
// client/src/components/Home/PickOfTheDay.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Flame } from 'lucide-react'

export default function PickOfTheDay() {
  const navigate = useNavigate()
  const [pick, setPick] = useState<TrendingPlayer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTopTrending()
      .then(players => setPick(players[0] ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Skeleton className="h-40 w-full bg-surface rounded-2xl" />
  if (!pick) return null

  return (
    <button
      onClick={() => navigate(`/player/${pick.playerId}`, { state: { player: pick } })}
      className="w-full p-6 bg-gradient-to-r from-mint/10 to-transparent border border-mint/20 rounded-2xl hover:border-mint/40 transition-all text-left group"
    >
      <div className="flex items-center gap-2 mb-3">
        <Flame size={14} className="text-mint" />
        <span className="text-xs font-semibold text-mint uppercase tracking-wider">Pick of the Day</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white group-hover:text-mint transition-colors">{pick.playerName}</h2>
          <p className="text-sm text-gray-400 mt-0.5">{pick.team} · {pick.position}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-mint">{pick.rollingAvg.toFixed(1)}</div>
          <div className="text-xs text-gray-500 mt-0.5">L{pick.windowSize} avg {pick.stat}</div>
          <Badge className="mt-1 bg-mint/10 text-mint border-mint/20">+{pick.zScore.toFixed(2)}σ</Badge>
        </div>
      </div>
    </button>
  )
}
```

**Step 2: Write TopTrending**

```tsx
// client/src/components/Home/TopTrending.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp } from 'lucide-react'

export default function TopTrending() {
  const navigate = useNavigate()
  const [players, setPlayers] = useState<TrendingPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTopTrending()
      .then(data => setPlayers(data.slice(1, 10))) // skip #1 (used in PickOfTheDay)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-mint" />
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Top Trending</h2>
      </div>
      {loading && (
        <div className="space-y-2">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-14 w-full bg-surface" />)}
        </div>
      )}
      {!loading && players.map((player, i) => (
        <button
          key={`${player.playerId}-${player.statId}`}
          onClick={() => navigate(`/player/${player.playerId}`, { state: { player } })}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface border-b border-[#1E1E1E] last:border-0 transition-colors text-left group"
        >
          <span className="text-xs font-bold text-gray-600 w-5">#{i + 2}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white group-hover:text-mint transition-colors truncate">{player.playerName}</div>
            <div className="text-xs text-gray-500">{player.team} · {player.stat}</div>
          </div>
          <div className="text-right">
            <span className="text-sm font-bold text-mint">{player.rollingAvg.toFixed(1)}</span>
            <span className="text-xs text-gray-600 ml-1">avg</span>
          </div>
          <span className="text-xs text-gray-500 w-14 text-right">+{player.zScore.toFixed(2)}σ</span>
        </button>
      ))}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add client/src/components/Home/
git commit -m "feat: PickOfTheDay + TopTrending components"
```

---

## Task 11: Build HomePage + NBAPage

**Files:**
- Modify: `client/src/pages/Home/Home.tsx`
- Modify: `client/src/pages/NBA/NBA.tsx`
- Create: `client/src/pages/NFL/NFL.tsx` (ComingSoon)
- Create: `client/src/pages/MLB/MLB.tsx` (ComingSoon)
- Create: `client/src/pages/NHL/NHL.tsx` (ComingSoon)
- Create: `client/src/components/ComingSoon/ComingSoon.tsx`

**Step 1: Write ComingSoon component**

```tsx
// client/src/components/ComingSoon/ComingSoon.tsx
import { Link } from 'react-router-dom'

interface Props { league: string }

export default function ComingSoon({ league }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8">
      <div className="text-6xl font-black text-gray-800 mb-4">{league}</div>
      <h2 className="text-xl font-semibold text-white mb-2">Coming Soon</h2>
      <p className="text-gray-500 text-sm mb-8 max-w-xs">
        {league} trend data is on the roadmap. NBA is live right now.
      </p>
      <Link
        to="/nba"
        className="px-6 py-2.5 bg-mint text-black font-semibold rounded-full text-sm hover:bg-mint/90 transition-colors"
      >
        Go to NBA →
      </Link>
    </div>
  )
}
```

**Step 2: Update stub pages**

```tsx
// client/src/pages/NFL/NFL.tsx
import ComingSoon from '@/components/ComingSoon/ComingSoon'
export default function NFL() { return <ComingSoon league="NFL" /> }

// client/src/pages/MLB/MLB.tsx
import ComingSoon from '@/components/ComingSoon/ComingSoon'
export default function MLB() { return <ComingSoon league="MLB" /> }

// client/src/pages/NHL/NHL.tsx
import ComingSoon from '@/components/ComingSoon/ComingSoon'
export default function NHL() { return <ComingSoon league="NHL" /> }
```

**Step 3: Write HomePage (with sidebar layout)**

```tsx
// client/src/pages/Home/Home.tsx
import Sidebar from '@/components/Sidebar/Sidebar'
import PickOfTheDay from '@/components/Home/PickOfTheDay'
import TopTrending from '@/components/Home/TopTrending'

export default function Home() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <PickOfTheDay />
        <div className="bg-surface border border-[#1E1E1E] rounded-xl overflow-hidden">
          <TopTrending />
        </div>
      </main>
    </div>
  )
}
```

**Step 4: Write NBAPage**

```tsx
// client/src/pages/NBA/NBA.tsx
import Sidebar from '@/components/Sidebar/Sidebar'
import TrendFinder from '@/components/TrendFinder/TrendFinder'
import TopTrending from '@/components/Home/TopTrending'

export default function NBA() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className="bg-surface border border-[#1E1E1E] rounded-xl p-6">
          <TrendFinder />
        </div>
        <div className="bg-surface border border-[#1E1E1E] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#1E1E1E]">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Pre-Computed Trends</h2>
          </div>
          <TopTrending />
        </div>
      </main>
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add client/src/pages/ client/src/components/ComingSoon/
git commit -m "feat: HomePage + NBAPage + ComingSoon stubs"
```

---

## Task 12: Wire up App.tsx + final cleanup

**Files:**
- Modify: `client/src/App.tsx`

**Step 1: Write new App.tsx**

```tsx
// client/src/App.tsx
import { Route, Routes } from 'react-router-dom'
import Header from '@/components/Header/Header'
import Home from '@/pages/Home/Home'
import NBA from '@/pages/NBA/NBA'
import NFL from '@/pages/NFL/NFL'
import MLB from '@/pages/MLB/MLB'
import NHL from '@/pages/NHL/NHL'
import PlayerDetailView from '@/components/TrendFinder/PlayerDetailView'

export default function App() {
  return (
    <div className="bg-app min-h-screen">
      <Header />
      <div className="pt-16 h-screen flex flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/nba" element={<NBA />} />
          <Route path="/nfl" element={<NFL />} />
          <Route path="/mlb" element={<MLB />} />
          <Route path="/nhl" element={<NHL />} />
          <Route path="/player/:id" element={<PlayerDetailView />} />
        </Routes>
      </div>
    </div>
  )
}
```

**Step 2: Run the full test suite**

```bash
cd client && npm test
```
Expected: All tests PASS.

**Step 3: Start both servers and verify the app loads**

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Visit `http://localhost:5173` and verify:
- Header shows StatTrak logo + NBA/NFL/MLB/NHL links + search bar
- Home page loads with PickOfTheDay + TopTrending
- Sidebar shows today's games
- `/nba` shows TrendFinder + pre-computed trends
- Clicking a player navigates to PlayerDetailView
- `/nfl`, `/mlb`, `/nhl` show ComingSoon

**Step 4: Run lint**

```bash
cd client && npm run lint
```
Fix any warnings before committing.

**Step 5: Final commit**

```bash
git add client/src/App.tsx
git commit -m "feat: wire up App.tsx routes, complete frontend refactor"
```

---

## Done

Full refactor complete:
- Bootstrap + SCSS removed, Tailwind + shadcn/ui installed
- All dead code and mock data deleted
- 5 new backend endpoints serving real Supabase data
- Header with inline player search wired to PlayerDetailView
- Sidebar with today's games via ESPN API
- Home: PickOfTheDay hero + Top 9 trending players
- NBA: TrendFinder (custom filters) + pre-computed z-score players
- PlayerDetailView: z-score strip + interactive bar chart
- NFL/MLB/NHL: Coming Soon stubs
- Vitest + React Testing Library set up with component + service tests
