# Frontend F — Game View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plan G (typography) must be complete. Plan D (player explorer) bar-click navigation targets this route.
>
> **Tooling:** Use `frontend-design` skill for UI decisions. Use Playwright MCP to verify. Use context7 for library docs.
>
> **APPROVAL GATE in Task 2**: Starting lineup data source requires user decision before building that section.

**Goal:** Build `/game/:id` with two states — Upcoming (lineup matchup, props, game context) and Completed (box score, prop outcomes). Wire sidebar game cards and player chart bar clicks to this route.

**Architecture:** New `GameView` component at `client/src/components/GameView/GameView.tsx`. New API methods in `api.ts`. New backend controller `gameController.ts`. State determined by `game_date` vs today.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, React Router, Supabase

---

### File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `server/src/controllers/gameController.ts` | `/api/nba/games/:id` endpoint |
| Modify | `server/src/server.ts` | Register new route |
| Modify | `client/src/services/api.ts` | Add `getGame(id)` method + types |
| Create | `client/src/components/GameView/GameView.tsx` | Two-state game page |
| Modify | `client/src/App.tsx` | Add `/game/:id` route |
| Modify | `client/src/components/Sidebar/Sidebar.tsx` | Make game cards navigate to `/game/:id` |

---

### Task 1: Add /game/:id route and skeleton GameView

**Files:**
- Create: `client/src/components/GameView/GameView.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create GameView skeleton**

  ```tsx
  // client/src/components/GameView/GameView.tsx
  import { useParams, useNavigate } from 'react-router-dom'
  import { ArrowLeft } from 'lucide-react'
  import { Skeleton } from '@/components/ui/skeleton'

  export default function GameView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    return (
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-white mb-2 transition-colors font-condensed tracking-wide uppercase"
        >
          <ArrowLeft size={12} /> Back
        </button>
        <div className="text-gray-600 text-sm font-condensed">Game {id} — building...</div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Add route to App.tsx**

  In `client/src/App.tsx`, add after the existing player route:
  ```tsx
  import GameView from '@/components/GameView/GameView'
  // ...
  <Route path="/game/:id" element={<GameView />} />
  ```

- [ ] **Step 3: Build check**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```

- [ ] **Step 4: Playwright — navigate to /game/1**

  Navigate to `http://localhost:5173/game/1`. Should render the skeleton without crashing.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/components/GameView/GameView.tsx client/src/App.tsx
  git commit -m "feat(game-view): add /game/:id route with skeleton component"
  ```

---

### Task 2: Backend — game detail API endpoint

**Files:**
- Create: `server/src/controllers/gameController.ts`
- Modify: `server/src/server.ts`

- [ ] **Step 1: Check what data is available for a game**

  Run via Supabase MCP `execute_sql`:
  ```sql
  SELECT g.id, g.game_date, g.home_team_id, g.away_team_id,
         ht.abbreviation as home_abbr, ht.name as home_name,
         at.abbreviation as away_abbr, at.name as away_name
  FROM games g
  JOIN teams ht ON ht.id = g.home_team_id
  JOIN teams at ON at.id = g.away_team_id
  WHERE g.league_id = 1
  ORDER BY g.game_date DESC LIMIT 5;
  ```

  Also check if box score data exists:
  ```sql
  SELECT player_id, game_date, points, rebounds, assists, minutes
  FROM nba_player_stats
  WHERE game_date = (SELECT MAX(game_date) FROM nba_player_stats)
  LIMIT 10;
  ```

- [ ] **Step 2: PAUSE — report lineup data availability to user**

  Starting lineups (starters vs bench) require either:
  - **Option A**: Fetch live from `nba_api` `BoxScoreTraditionalV2` endpoint (accurate but adds latency)
  - **Option B**: All players who played in that game from `nba_player_stats` ordered by minutes (approximate)
  - **Option C**: `player_availability` table (only has out/available, not starter/bench distinction)

  Present findings and options to user. **Wait for approval before building the lineup section.**

  For now, build the rest of the endpoint (game header, box score stats) using available data.

- [ ] **Step 3: Create gameController.ts**

  ```typescript
  // server/src/controllers/gameController.ts
  import { supabaseAdmin } from '../config/supabaseAdmin';

  export async function getGameById(req: any, res: any) {
    try {
      const gameId = parseInt(req.params.id, 10);
      if (isNaN(gameId)) {
        return res.status(400).json({ success: false, error: 'Invalid game ID' });
      }

      // Fetch game + teams
      const { data: game, error: gameErr } = await supabaseAdmin
        .from('games')
        .select(`
          id, game_date, league_id,
          home_team:teams!games_home_team_id_fkey(id, abbreviation, name),
          away_team:teams!games_away_team_id_fkey(id, abbreviation, name)
        `)
        .eq('id', gameId)
        .single();

      if (gameErr || !game) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }

      const today = new Date().toISOString().slice(0, 10);
      const isCompleted = game.game_date < today;

      // Fetch player stats for this game (box score)
      const { data: playerStats } = await supabaseAdmin
        .from('nba_player_stats')
        .select('player_id, game_date, points, rebounds, assists, three_points_made, minutes, players(name, team, position)')
        .eq('game_date', game.game_date)
        .or(`team_id.eq.${(game.home_team as any).id},team_id.eq.${(game.away_team as any).id}`)
        .order('minutes', { ascending: false });

      // Fetch top props for this game from daily_lines
      const { data: props } = await supabaseAdmin
        .from('daily_lines')
        .select('market_ticker, line, implied_prob, prop_type, entity_id, team_id, source')
        .eq('entity_id', gameId)
        .order('implied_prob', { ascending: false })
        .limit(20);

      // Fetch player picks for this game date
      const { data: picks } = await supabaseAdmin
        .from('pick_results')
        .select('entity_id, stat, recommended_line, hit_rate, confidence_score, implied_prob, edge, actual_result, did_hit')
        .eq('game_date', game.game_date)
        .limit(20);

      res.json({
        success: true,
        data: {
          game: {
            id: game.id,
            game_date: game.game_date,
            home_team: game.home_team,
            away_team: game.away_team,
            is_completed: isCompleted,
          },
          player_stats: playerStats ?? [],
          props: props ?? [],
          picks: picks ?? [],
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
  ```

- [ ] **Step 4: Register route in server.ts**

  In `server/src/server.ts`, find where NBA routes are registered and add:
  ```typescript
  import { getGameById } from './controllers/gameController';
  // ...
  app.get('/api/nba/games/:id', getGameById);
  ```

- [ ] **Step 5: Build and test the endpoint**

  ```bash
  cd server && npm run build 2>&1 | tail -10 && npx vitest run 2>&1 | tail -5
  ```

  Then test manually:
  ```bash
  curl http://localhost:3000/api/nba/games/1 2>/dev/null | python -m json.tool | head -30
  ```

- [ ] **Step 6: Add getGame to api.ts**

  ```typescript
  export interface GameDetail {
    game: {
      id: number
      game_date: string
      home_team: { id: number; abbreviation: string; name: string }
      away_team: { id: number; abbreviation: string; name: string }
      is_completed: boolean
    }
    player_stats: Array<{
      player_id: number
      game_date: string
      points: number
      rebounds: number
      assists: number
      three_points_made: number
      minutes: number
      players: { name: string; team: string; position: string } | null
    }>
    props: Array<{
      market_ticker: string
      line: number | null
      implied_prob: number | null
      prop_type: string
      entity_id: number | null
      team_id: number | null
      source: string | null
    }>
    picks: Array<{
      entity_id: number
      stat: string
      recommended_line: number
      hit_rate: number
      confidence_score: number
      implied_prob: number | null
      edge: number
      actual_result: number | null
      did_hit: boolean | null
    }>
  }

  // Add to nbaApi object:
  getGame: (id: number): Promise<GameDetail> =>
    get(`${BASE}/nba/games/${id}`),
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add server/src/controllers/gameController.ts server/src/server.ts client/src/services/api.ts
  git commit -m "feat(game-view): add /api/nba/games/:id endpoint and GameDetail type"
  ```

---

### Task 3: Build GameView — completed state (box score)

**Files:**
- Modify: `client/src/components/GameView/GameView.tsx`

- [ ] **Step 1: Replace skeleton with data-driven component**

  ```tsx
  // client/src/components/GameView/GameView.tsx
  import { useEffect, useState } from 'react'
  import { useParams, useNavigate } from 'react-router-dom'
  import { ArrowLeft } from 'lucide-react'
  import { nbaApi, GameDetail } from '@/services/api'
  import { Skeleton } from '@/components/ui/skeleton'
  import { cn } from '@/lib/utils'
  import UpcomingView from './UpcomingView'
  import CompletedView from './CompletedView'

  export default function GameView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [data, setData] = useState<GameDetail | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      if (!id) return
      nbaApi.getGame(parseInt(id))
        .then(setData)
        .catch(() => {})
        .finally(() => setLoading(false))
    }, [id])

    if (loading) {
      return (
        <div className="p-6 space-y-4 max-w-5xl mx-auto">
          <Skeleton className="h-8 w-48 bg-[#0F0F0F]" />
          <Skeleton className="h-24 w-full bg-[#0F0F0F]" />
          <Skeleton className="h-64 w-full bg-[#0F0F0F]" />
        </div>
      )
    }

    if (!data) {
      return <div className="p-6 text-gray-600 font-condensed">Game not found</div>
    }

    return (
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-white transition-colors font-condensed tracking-wide uppercase"
        >
          <ArrowLeft size={12} /> Back
        </button>

        {/* Game header */}
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-[22px] font-bold text-white font-condensed">{data.game.away_team.abbreviation}</div>
              <div className="text-[11px] text-gray-600 font-condensed">{data.game.away_team.name}</div>
            </div>
            <div className="text-center px-6">
              <div className="text-[11px] text-gray-600 font-condensed uppercase tracking-widest">
                {data.game.is_completed ? 'Final' : new Date(data.game.game_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div className="text-[13px] font-black text-gray-500 font-condensed mt-1">VS</div>
            </div>
            <div className="text-center flex-1">
              <div className="text-[22px] font-bold text-white font-condensed">{data.game.home_team.abbreviation}</div>
              <div className="text-[11px] text-gray-600 font-condensed">{data.game.home_team.name}</div>
            </div>
          </div>
        </div>

        {data.game.is_completed
          ? <CompletedView data={data} />
          : <UpcomingView data={data} />
        }
      </div>
    )
  }
  ```

- [ ] **Step 2: Create CompletedView sub-component**

  Create `client/src/components/GameView/CompletedView.tsx`:
  ```tsx
  import { GameDetail } from '@/services/api'
  import { cn } from '@/lib/utils'

  interface Props { data: GameDetail }

  const STAT_COLS = [
    { key: 'points',            label: 'PTS' },
    { key: 'rebounds',          label: 'REB' },
    { key: 'assists',           label: 'AST' },
    { key: 'three_points_made', label: '3PM' },
    { key: 'minutes',           label: 'MIN' },
  ]

  function BoxScoreTable({ players, title }: { players: GameDetail['player_stats']; title: string }) {
    return (
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#111]">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">{title}</span>
        </div>
        {/* Header */}
        <div className="grid grid-cols-[2fr_repeat(5,1fr)] gap-2 px-4 py-2 border-b border-[#111]">
          <span className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed">Player</span>
          {STAT_COLS.map(c => (
            <span key={c.key} className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed text-right">{c.label}</span>
          ))}
        </div>
        {players.map((p, i) => (
          <div key={i} className="grid grid-cols-[2fr_repeat(5,1fr)] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] last:border-0 hover:bg-white/[0.02]">
            <span className="text-[12px] font-semibold text-white font-condensed truncate">
              {p.players?.name ?? `Player ${p.player_id}`}
            </span>
            {STAT_COLS.map(c => (
              <span key={c.key} className="text-[12px] font-mono text-gray-300 text-right">
                {(p as any)[c.key] ?? 0}
              </span>
            ))}
          </div>
        ))}
      </div>
    )
  }

  export default function CompletedView({ data }: Props) {
    const homePlayers = data.player_stats.filter(p => p.players?.team === data.game.home_team.abbreviation)
    const awayPlayers = data.player_stats.filter(p => p.players?.team === data.game.away_team.abbreviation)

    const picksWithOutcome = data.picks.filter(p => p.did_hit != null)

    return (
      <div className="space-y-4">
        <BoxScoreTable players={awayPlayers} title={`${data.game.away_team.abbreviation} — Box Score`} />
        <BoxScoreTable players={homePlayers} title={`${data.game.home_team.abbreviation} — Box Score`} />

        {picksWithOutcome.length > 0 && (
          <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#111]">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Prop Outcomes</span>
            </div>
            {picksWithOutcome.map((pick, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0">
                <div className="text-[12px] font-condensed text-white">
                  Entity {pick.entity_id} · {pick.stat.toUpperCase()} {pick.recommended_line}+
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-gray-500">Edge +{Math.round(pick.edge * 100)}%</span>
                  <span className={cn(
                    'text-[12px] font-black font-condensed px-2 py-0.5 rounded',
                    pick.did_hit === true  ? 'text-green-400 bg-green-400/10' :
                    pick.did_hit === false ? 'text-red-400 bg-red-400/10' : 'text-gray-600'
                  )}>
                    {pick.did_hit === true ? '✓ HIT' : pick.did_hit === false ? '✗ MISS' : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 3: Create UpcomingView stub**

  Create `client/src/components/GameView/UpcomingView.tsx`:
  ```tsx
  import { GameDetail } from '@/services/api'

  interface Props { data: GameDetail }

  export default function UpcomingView({ data }: Props) {
    return (
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5 space-y-4">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Upcoming</div>

        {/* Props for this game */}
        {data.props.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-700 uppercase tracking-widest font-condensed mb-2">Today's Lines</div>
            {data.props.slice(0, 10).map((prop, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-[#111] last:border-0">
                <span className="text-[11px] text-gray-400 font-condensed truncate">{prop.market_ticker}</span>
                <div className="flex gap-3 flex-shrink-0">
                  {prop.line != null && <span className="text-[11px] font-mono text-gray-300">{prop.line}</span>}
                  {prop.implied_prob != null && (
                    <span className="text-[11px] font-mono text-gray-500">{Math.round(prop.implied_prob * 100)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Lineup section — pending lineup data source decision */}
        <div className="border border-dashed border-[#222] rounded-xl p-4 text-center">
          <div className="text-[11px] text-gray-700 font-condensed">Lineup comparison coming — awaiting data source decision</div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4: Build and Playwright**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```
  Navigate to a completed game `/game/:id`. Verify box score and prop outcomes render. Navigate to an upcoming game. Verify upcoming view.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/components/GameView/
  git commit -m "feat(game-view): build two-state GameView — box score + upcoming shell"
  ```

---

### Task 4: Wire sidebar game cards to /game/:id

**Files:**
- Modify: `client/src/components/Sidebar/Sidebar.tsx`

`TodaysGame` has `gameId: string`. The backend `getGamesByDate` returns game data. We need the numeric DB `id`, not the external API id. Check what `gameId` is in the existing response.

- [ ] **Step 1: Check what gameId is in TodaysGame**

  In `client/src/services/api.ts`:
  ```typescript
  export interface TodaysGame {
    gameId: string   // ← is this the DB id or external ESPN id?
  ```

  Check in `nbaController.ts` what populates this field. If it's the ESPN game ID, we need to join `games` table to get the DB id. Run:
  ```bash
  grep -n "gameId\|game_id" server/src/controllers/nbaController.ts | head -20
  ```

- [ ] **Step 2: Update TodaysGame to include db_id if needed**

  If `gameId` is not the DB `id`, add `dbId?: number` to `TodaysGame` and populate it from the `games` table join in `getTodaysGames`.

- [ ] **Step 3: Make sidebar game cards clickable**

  In `client/src/components/Sidebar/Sidebar.tsx`, import `useNavigate`:
  ```tsx
  import { useNavigate } from 'react-router-dom'
  ```

  Add `const navigate = useNavigate()` inside the component. Update the `Card` element:
  ```tsx
  <Card
    key={game.gameId}
    onClick={() => game.dbId && navigate(`/game/${game.dbId}`)}
    className={cn(
      "mb-2.5 rounded-xl bg-[#0D0D0D] border-[#161616] shadow-none transition-colors",
      game.dbId ? "cursor-pointer hover:border-[#333]" : "cursor-default"
    )}
  >
  ```

- [ ] **Step 4: Build, lint, Playwright**

  ```bash
  cd client && npm run build && npm run lint 2>&1 | tail -10
  ```
  Click a sidebar game card. Should navigate to `/game/:id`.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/components/Sidebar/Sidebar.tsx server/src/controllers/nbaController.ts client/src/services/api.ts
  git commit -m "feat(sidebar): game cards navigate to /game/:id"
  ```

---

### Task 5: Final integration test

- [ ] **Step 1: Run full test suite**

  ```bash
  cd server && npx vitest run 2>&1 | tail -5
  cd ../client && npm run build && npm run lint 2>&1 | tail -10
  ```

- [ ] **Step 2: Playwright end-to-end flow**

  1. Home → click sidebar game card → GameView
  2. Navigate to a player → click a bar → GameView (completed state)
  3. GameView → Back → previous page

- [ ] **Step 3: Final commit**

  ```bash
  git commit -m "feat(game-view): complete Game View implementation — two states, sidebar + bar-click entry"
  ```
