# Frontend D — Player Explorer Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plans G (typography) and F (game view route `/game/:id` must exist) before implementing bar-click navigation.
>
> **Tooling:** Use `frontend-design` skill for UI decisions. Use Playwright MCP to verify after each task. Use context7 for library docs.

**Goal:** Redesign `/player/:id` as a rich explorer dashboard: improved header, clickable bar chart bars that navigate to the game view, a today's-props section, and z-score sparklines for all 4 stats.

**Architecture:** Full rewrite of `PlayerDetailView.tsx`. New `PlayerPropsSection` sub-component for today's props. Backend: add `game_id` and `opponent` to the `getPlayerProfile` API response (verify if already present, join if not).

**Tech Stack:** React 18, TypeScript, Tailwind CSS, React Router, shadcn/ui

---

### File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `server/src/controllers/nbaController.ts` | Add `game_id` + `opponent_abbr` to game log response |
| Modify | `client/src/services/api.ts` | Update `GameStat` interface |
| Modify | `client/src/components/TrendFinder/PlayerDetailView.tsx` | Full redesign |

---

### Task 1: Verify and expose game_id in player game log API

**Files:**
- Modify: `server/src/controllers/nbaController.ts` (getPlayerGames function)
- Modify: `client/src/services/api.ts` (GameStat interface)

- [ ] **Step 1: Check nba_player_stats schema**

  Run via Supabase MCP `execute_sql`:
  ```sql
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'nba_player_stats'
  ORDER BY ordinal_position;
  ```
  Note whether `game_id` and `opponent` (or `opponent_team_id`) columns exist.

- [ ] **Step 2: Find getPlayerGames in nbaController.ts**

  ```bash
  grep -n "getPlayerGames\|player.*games\|games.*player" server/src/controllers/nbaController.ts | head -20
  ```

- [ ] **Step 3: Update the select query to include game_id**

  In the query that fetches `nba_player_stats` rows for a player, add `game_id` to the select. If `opponent_team_id` exists, join `teams` to get `abbreviation`. The goal: each `GameStat` row has `gameId: number` and `opponent: string`.

  If `game_id` does NOT exist in `nba_player_stats`: join `games` on `game_date + team_id` to resolve it:
  ```sql
  -- Resolution query (run via execute_sql to verify approach)
  SELECT s.*, g.id as game_id
  FROM nba_player_stats s
  JOIN games g ON g.game_date = s.game_date
    AND (g.home_team_id = s.team_id OR g.away_team_id = s.team_id)
  WHERE s.player_id = $1
  ORDER BY s.game_date DESC
  LIMIT 20;
  ```

- [ ] **Step 4: Update GameStat interface in api.ts**

  ```typescript
  export interface GameStat {
    gameId: number
    date: string
    opponent?: string      // opponent team abbreviation
    points: number
    rebounds: number
    assists: number
    threes: number
    fouls: number
    minutes: number
  }
  ```

- [ ] **Step 5: Build and test**

  ```bash
  cd server && npm run build 2>&1 | tail -10 && npx vitest run 2>&1 | tail -5
  cd ../client && npm run build 2>&1 | tail -5
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/controllers/nbaController.ts client/src/services/api.ts
  git commit -m "feat(player-api): expose game_id and opponent_abbr in player game log"
  ```

---

### Task 2: Redesign PlayerDetailView — header + stat selector tabs

**Files:**
- Modify: `client/src/components/TrendFinder/PlayerDetailView.tsx`

- [ ] **Step 1: Replace player header section**

  Find the header block in `PlayerDetailView.tsx` (~lines 88-111). Replace with:
  ```tsx
  {/* Back + Player header */}
  <div>
    <button
      onClick={() => navigate(-1)}
      className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-white mb-4 transition-colors font-condensed tracking-wide uppercase"
    >
      <ArrowLeft size={12} /> Back
    </button>

    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5 flex items-center gap-5">
      {/* Avatar */}
      <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#222] flex items-center justify-center text-lg font-black text-mint font-condensed flex-shrink-0">
        {profile.player.name.split(' ').map(n => n[0]).join('')}
      </div>
      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <h1 className="text-[28px] font-bold text-white font-condensed tracking-tight leading-none truncate">
          {profile.player.name}
        </h1>
        <p className="text-[11px] text-gray-600 mt-1 font-condensed tracking-wide">
          {profile.player.team} · {profile.player.position}
        </p>
      </div>
      {/* Season avg quick stats */}
      <div className="hidden sm:flex gap-5 flex-shrink-0">
        {STATS.map(stat => (
          <div key={stat} className="text-center">
            <div className="text-[20px] font-black font-mono text-white tabular-nums leading-none">
              {profile.rollingAvgs[stat]?.toFixed(1) ?? '—'}
            </div>
            <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">{STAT_LABELS[stat]}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
  ```

- [ ] **Step 2: Update stat selector to horizontal tab bar**

  Replace the 4-column grid of stat selector buttons with a tab bar:
  ```tsx
  {/* Stat selector — tab bar */}
  <div className="flex border-b border-[#161616]">
    {STATS.map(stat => {
      const z = profile.zScores[stat] ?? 0
      const isActive = activeStat === stat
      return (
        <button
          key={stat}
          onClick={() => setActiveStat(stat)}
          className={cn(
            'flex-1 py-3 px-2 text-center relative transition-colors',
            isActive ? 'text-white' : 'text-gray-600 hover:text-gray-400'
          )}
        >
          <div className="text-[10px] font-bold font-condensed uppercase tracking-widest">{STAT_LABELS[stat]}</div>
          <div className={cn('text-[15px] font-black font-mono tabular-nums leading-tight', isActive ? 'text-mint' : zColor(z))}>
            {profile.rollingAvgs[stat]?.toFixed(1) ?? '—'}
          </div>
          <div className={cn('text-[9px] font-mono', isActive ? 'text-mint/60' : 'text-gray-700')}>
            {z != null ? (z > 0 ? '+' : '') + z.toFixed(2) + 'σ' : '—'}
          </div>
          {isActive && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />}
        </button>
      )
    })}
  </div>
  ```

- [ ] **Step 3: Build check**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```

- [ ] **Step 4: Playwright — check header and tab bar**

  Navigate to a valid player URL. Verify header renders cleanly. Verify stat tabs switch correctly.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/components/TrendFinder/PlayerDetailView.tsx
  git commit -m "feat(player): redesign header and stat selector tabs"
  ```

---

### Task 3: Make bar chart bars clickable → /game/:id

**Files:**
- Modify: `client/src/components/TrendFinder/PlayerDetailView.tsx`

**Prerequisite:** `/game/:id` route must exist (Plan F Task 1). If not yet created, bar clicks should be disabled with `cursor-default` until the route exists.

- [ ] **Step 1: Update bar elements to show opponent label and be clickable**

  In the bar chart section (~lines 193-220), update the outer `div` and add game label:
  ```tsx
  {chartGames.map((game, i) => {
    const val = getStatVal(game, activeStat)
    const pct = (val / maxVal) * 100
    const isOver = val >= threshold
    const hasGameId = game.gameId != null

    return (
      <div
        key={i}
        className={cn(
          'flex-1 h-full flex flex-col justify-end group relative',
          hasGameId ? 'cursor-pointer' : 'cursor-default'
        )}
        onClick={() => hasGameId && navigate(`/game/${game.gameId}`)}
      >
        <div
          className={cn(
            'w-full rounded-t animate-bar-grow transition-opacity',
            isOver ? 'bg-mint/60 group-hover:bg-mint/90' : 'bg-red-500/40 group-hover:bg-red-500/70'
          )}
          style={{ height: `${Math.max(pct, 3)}%`, animationDelay: `${i * 22}ms` }}
        />
        {/* Tooltip */}
        <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-2.5 py-1.5 z-20 shadow-2xl whitespace-nowrap">
          <span className="text-[12px] font-black text-mint font-mono">{val}</span>
          <span className="text-[10px] text-gray-500 ml-1 font-condensed">{STAT_LABELS[activeStat]}</span>
          {game.opponent && <div className="text-[9px] text-gray-600 font-condensed mt-0.5">vs {game.opponent}</div>}
        </div>
      </div>
    )
  })}
  ```

- [ ] **Step 2: Update game labels below chart to show opponent + date**

  Replace generic `G{i+1}` labels:
  ```tsx
  {chartGames.map((game, i) => (
    <div key={i} className="flex-1 text-center">
      <div className="text-[8px] text-gray-700 font-condensed font-bold truncate">
        {game.opponent ?? `G${i+1}`}
      </div>
    </div>
  ))}
  ```

- [ ] **Step 3: Build and test**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```

- [ ] **Step 4: Playwright — click a bar and verify navigation**

  Navigate to a player page. Click a bar in the chart. Should navigate to `/game/:id`. If game view isn't built yet, a blank/404 page is acceptable — confirms routing works.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/components/TrendFinder/PlayerDetailView.tsx
  git commit -m "feat(player): clickable chart bars navigate to game view"
  ```

---

### Task 4: Add today's props section

**Files:**
- Modify: `client/src/components/TrendFinder/PlayerDetailView.tsx`

Fetch `nbaApi.getPlayerPicks(playerId)` (already in `api.ts`). Show props only when a game exists today.

- [ ] **Step 1: Add props fetch to component state**

  After the `profile` fetch `useEffect`, add:
  ```tsx
  const [playerPicks, setPlayerPicks] = useState<Pick[]>([])

  useEffect(() => {
    if (!id) return
    nbaApi.getPlayerPicks(parseInt(id))
      .then(setPlayerPicks)
      .catch(() => {})
  }, [id])
  ```

  Import `Pick` from `@/services/api`.

- [ ] **Step 2: Add today's props section below summary stats**

  After the summary grid (3-stat row), add:
  ```tsx
  {/* Today's props */}
  {playerPicks.length > 0 && (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111]">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">
          Today's Props
        </span>
      </div>
      {playerPicks.map((pick, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0">
          <div>
            <span className="text-[12px] font-bold text-white font-condensed">
              {pick.statLabel} {pick.recommendedLine}+
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-gray-500 font-condensed">
              Mkt <span className="font-mono">{Math.round(pick.impliedProb * 100)}%</span>
            </span>
            <span className="text-[11px] text-gray-400 font-condensed">
              Hit <span className="font-mono">{Math.round(pick.hitRate * 100)}%</span>
            </span>
            <span className="text-[11px] font-bold text-mint font-condensed">
              Edge <span className="font-mono">+{Math.round(pick.edge * 100)}%</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  )}
  ```

- [ ] **Step 3: Build, lint, Playwright**

  ```bash
  cd client && npm run build && npm run lint 2>&1 | tail -10
  ```
  Navigate to a player with picks today. Verify section appears. Navigate to a player with no picks — verify section is hidden.

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/components/TrendFinder/PlayerDetailView.tsx
  git commit -m "feat(player): add today's props section"
  ```

---

### Task 5: Final PlayerDetailView polish and full test

- [ ] **Step 1: Run full test suite**

  ```bash
  cd server && npx vitest run 2>&1 | tail -5
  cd ../client && npm run build && npm run lint 2>&1 | tail -10
  ```

- [ ] **Step 2: Playwright — full player detail audit**

  Visit 2-3 different player pages. Verify:
  - Header with avatar, name, team, position, season avgs
  - Stat tab bar with z-scores and rolling avgs
  - Bar chart with opponent labels and click navigation
  - Summary stats row
  - Today's props (if available)
  
  Take screenshots.

- [ ] **Step 3: Final commit**

  ```bash
  git add client/src/
  git commit -m "feat(player): complete Player Explorer Dashboard redesign"
  ```
