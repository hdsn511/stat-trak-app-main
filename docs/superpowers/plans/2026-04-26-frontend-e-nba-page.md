# Frontend E — NBA Page Content Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plan G (typography) must be complete before starting this plan.
>
> **Tooling:** Use `frontend-design` skill for UI decisions. Use Playwright MCP to verify after each task. Use context7 for library docs.

**Goal:** Expand `NBA.tsx` to include 4 POTD cards, a props table with bucketed tabs, a streaks card, and move TrendFinder + TopTrending to the bottom of a single-scroll layout.

**Architecture:** Five new components under `client/src/components/NBA/` + update `NBA.tsx` layout. No backend changes — all data comes from existing API endpoints (`getTopPicks`, `getPlayerStreaks`, `getGameStreaks`). Props table uses `nbaApi.getTopPicks` response already in `api.ts`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui (Tabs, Badge, Button, Skeleton)

---

### File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `client/src/components/NBA/PicksRow.tsx` | 4-card POTD row |
| Create | `client/src/components/NBA/PropsTable.tsx` | Props table with bucket tabs |
| Create | `client/src/components/NBA/StreaksCard.tsx` | Streaks leaderboard |
| Modify | `client/src/pages/NBA/NBA.tsx` | Assemble all sections |

---

### Task 1: Create PicksRow — 4 POTD cards

**Files:**
- Create: `client/src/components/NBA/PicksRow.tsx`

- [ ] **Step 1: Create the component**

  ```tsx
  // client/src/components/NBA/PicksRow.tsx
  import { useEffect, useState } from 'react'
  import { useNavigate } from 'react-router-dom'
  import { nbaApi, TopPickPlayer, TopPickGame, TopPicksResponse } from '@/services/api'
  import { Skeleton } from '@/components/ui/skeleton'
  import { TrendingUp, Flame } from 'lucide-react'

  type CardType = 'player' | 'spread' | 'total' | 'ml'

  interface PickCardProps {
    label: string
    type: CardType
    playerPick?: TopPickPlayer | null
    gamePick?: TopPickGame | null
  }

  function PickCard({ label, type, playerPick, gamePick }: PickCardProps) {
    const navigate = useNavigate()
    const isEmpty = !playerPick && !gamePick

    if (isEmpty) {
      return (
        <div className="flex-1 bg-[#0D0D0D] border border-[#161616] rounded-2xl flex items-center justify-center h-32">
          <span className="text-[10px] text-gray-700 font-condensed uppercase tracking-widest">No {label} pick</span>
        </div>
      )
    }

    const isPlayer = type === 'player'
    const edge = isPlayer ? playerPick!.edge : gamePick!.edge
    const conf = isPlayer ? playerPick!.confidence : gamePick!.confidence
    const hitRate = isPlayer ? playerPick!.hit_rate : gamePick!.hit_rate
    const impliedProb = isPlayer ? playerPick!.implied_prob : (gamePick!.implied_prob ?? 0)
    const edgePct = Math.round(edge * 100)
    const hitPct = Math.round(hitRate * 100)
    const mktPct = Math.round(impliedProb * 100)
    const confInt = Math.round(conf)

    const title = isPlayer
      ? playerPick!.player_name ?? '—'
      : `${gamePick!.away_team ?? '?'} @ ${gamePick!.home_team ?? '?'}`
    const subtitle = isPlayer
      ? `${playerPick!.team ?? ''} · ${playerPick!.position ?? ''}`
      : type === 'spread' ? 'Spread' : type === 'total' ? 'Total' : 'ML'
    const lineLabel = isPlayer
      ? `OVER ${playerPick!.line} ${playerPick!.stat_label}`
      : gamePick!.line != null ? `${gamePick!.line}` : '—'

    return (
      <div
        onClick={() => isPlayer && playerPick!.player_id && navigate(`/player/${playerPick!.player_id}`)}
        className={`flex-1 bg-[#0D0D0D] border rounded-2xl p-4 flex flex-col gap-2 min-w-0 ${
          isPlayer ? 'border-mint/20 cursor-pointer hover:border-mint/40 transition-colors' : 'border-[#161616]'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Flame size={9} className="text-mint flex-shrink-0" />
            <span className="text-[9px] font-bold text-mint uppercase tracking-widest font-condensed">{label}</span>
          </div>
          <span className="font-mono text-[20px] font-black text-mint leading-none">{confInt}</span>
        </div>
        <div>
          <div className="text-[15px] font-bold text-white font-condensed leading-tight truncate">{title}</div>
          <div className="text-[10px] text-gray-600 font-condensed">{subtitle}</div>
        </div>
        <div className="inline-flex items-center gap-1 border border-mint/25 rounded px-1.5 py-0.5 self-start">
          <TrendingUp size={8} className="text-mint" />
          <span className="text-[10px] font-black text-mint font-condensed">{lineLabel}</span>
        </div>
        <div className="space-y-1 mt-auto">
          <div className="flex justify-between">
            <span className="text-[9px] text-gray-700 font-condensed">MKT <span className="font-mono">{mktPct}%</span></span>
            <span className="text-[9px] text-mint font-condensed">HIT <span className="font-mono">{hitPct}%</span> <span className="text-mint/50 font-mono">+{edgePct}%</span></span>
          </div>
          <div className="relative h-0.5 bg-[#1A1A1A] rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-gray-700/50 rounded-full" style={{ width: `${mktPct}%` }} />
            <div className="absolute inset-y-0 left-0 bg-mint rounded-full transition-all duration-700" style={{ width: `${hitPct}%` }} />
          </div>
        </div>
      </div>
    )
  }

  export default function PicksRow() {
    const [picks, setPicks] = useState<TopPicksResponse | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      nbaApi.getTopPicks(5)
        .then(setPicks)
        .catch(() => {})
        .finally(() => setLoading(false))
    }, [])

    if (loading) {
      return (
        <div className="flex gap-3">
          {[0,1,2,3].map(i => <Skeleton key={i} className="flex-1 h-32 bg-[#0F0F0F] rounded-2xl" />)}
        </div>
      )
    }

    const playerPick = picks?.player?.[0] ?? null
    const spreadPick = picks?.game?.find(g => g.featured === 'spread') ?? null
    const totalPick  = picks?.game?.find(g => g.featured === 'total')  ?? null
    const mlPick     = picks?.game?.find(g => g.featured === 'ml')     ?? null

    return (
      <div className="flex gap-3">
        <PickCard label="Player Pick" type="player" playerPick={playerPick} />
        <PickCard label="Spread Pick" type="spread" gamePick={spreadPick} />
        <PickCard label="Total Pick"  type="total"  gamePick={totalPick} />
        <PickCard label="ML Pick"     type="ml"     gamePick={mlPick} />
      </div>
    )
  }
  ```

- [ ] **Step 2: Build check**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```
  Expected: 0 errors.

- [ ] **Step 3: Temporarily add to NBA.tsx for visual check**

  In `client/src/pages/NBA/NBA.tsx`, import and add `<PicksRow />` above the existing content. Start dev server, navigate to `http://localhost:5173/nba`, take Playwright screenshot.

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/components/NBA/PicksRow.tsx client/src/pages/NBA/NBA.tsx
  git commit -m "feat(nba): add 4-card POTD picks row"
  ```

---

### Task 2: Create PropsTable — bucket tabs + edge sort

**Files:**
- Create: `client/src/components/NBA/PropsTable.tsx`

The `getTopPicks` response (`TopPicksResponse`) has `player: TopPickPlayer[]` and `game: TopPickGame[]`. This table shows player props (up to 10) and game props split into spread (5) and total (5). Tab rows `50|60|70|80|90` filter by `implied_prob` bucket. Within each bucket, sort by `edge` descending.

- [ ] **Step 1: Create PropsTable component**

  ```tsx
  // client/src/components/NBA/PropsTable.tsx
  import { useState } from 'react'
  import { Badge } from '@/components/ui/badge'
  import { cn } from '@/lib/utils'
  import { TopPickPlayer, TopPickGame, TopPicksResponse } from '@/services/api'

  type PropTab = 'player' | 'spread' | 'total'
  type BucketTab = 50 | 60 | 70 | 80 | 90

  const BUCKET_TABS: BucketTab[] = [50, 60, 70, 80, 90]
  const PROP_TABS: { key: PropTab; label: string }[] = [
    { key: 'player', label: 'Player Props' },
    { key: 'spread', label: 'Spread' },
    { key: 'total',  label: 'Total' },
  ]

  function inBucket(prob: number, bucket: BucketTab): boolean {
    return prob >= bucket / 100 && prob < (bucket + 10) / 100
  }

  interface PropsTableProps {
    picks: TopPicksResponse | null
  }

  export default function PropsTable({ picks }: PropsTableProps) {
    const [propTab, setPropTab] = useState<PropTab>('player')
    const [bucket, setBucket] = useState<BucketTab>(50)

    const playerRows: TopPickPlayer[] = (picks?.player ?? [])
      .filter(p => inBucket(p.implied_prob, bucket))
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 10)

    const spreadRows: TopPickGame[] = (picks?.game ?? [])
      .filter(g => g.prop_type === 'spread' && g.implied_prob != null && inBucket(g.implied_prob!, bucket))
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 5)

    const totalRows: TopPickGame[] = (picks?.game ?? [])
      .filter(g => g.prop_type === 'total' && g.implied_prob != null && inBucket(g.implied_prob!, bucket))
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 5)

    const activeRows = propTab === 'player' ? playerRows : propTab === 'spread' ? spreadRows : totalRows
    const isEmpty = activeRows.length === 0

    return (
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[#111]">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Props</span>
        </div>

        {/* Prop type tabs */}
        <div className="flex border-b border-[#111]">
          {PROP_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setPropTab(t.key)}
              className={cn(
                'px-4 py-2.5 text-[11px] font-bold font-condensed tracking-wide uppercase transition-colors relative',
                propTab === t.key ? 'text-white' : 'text-gray-600 hover:text-gray-400'
              )}
            >
              {t.label}
              {propTab === t.key && (
                <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* Bucket tabs */}
        <div className="flex gap-1 px-4 py-2.5 border-b border-[#111]">
          <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest self-center mr-1">Kalshi %</span>
          {BUCKET_TABS.map(b => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition-colors',
                bucket === b
                  ? 'bg-mint text-black'
                  : 'bg-[#141414] text-gray-600 hover:text-white border border-[#222]'
              )}
            >
              {b}
            </button>
          ))}
        </div>

        {/* Table */}
        {isEmpty ? (
          <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
            No props in the {bucket}–{bucket + 9}% range today
          </div>
        ) : (
          <div>
            {/* Header row */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 border-b border-[#111]">
              {['Player / Game', 'Line', 'Mkt %', 'Model %', 'Edge'].map(h => (
                <span key={h} className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed">{h}</span>
              ))}
            </div>
            {propTab === 'player'
              ? playerRows.map((p, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
                  <div>
                    <div className="text-[12px] font-semibold text-white font-condensed truncate">{p.player_name}</div>
                    <div className="text-[10px] text-gray-600 font-condensed">{p.team} · {p.stat_label}</div>
                  </div>
                  <span className="text-[12px] font-mono text-gray-300 self-center">{p.line}</span>
                  <span className="text-[12px] font-mono text-gray-400 self-center">{Math.round(p.implied_prob * 100)}%</span>
                  <span className="text-[12px] font-mono text-gray-300 self-center">{Math.round(p.hit_rate * 100)}%</span>
                  <span className={cn('text-[12px] font-mono font-bold self-center', p.edge >= 0.1 ? 'text-mint' : 'text-gray-500')}>
                    +{Math.round(p.edge * 100)}%
                  </span>
                </div>
              ))
              : (propTab === 'spread' ? spreadRows : totalRows).map((g, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
                  <div>
                    <div className="text-[12px] font-semibold text-white font-condensed truncate">{g.away_team} @ {g.home_team}</div>
                    <div className="text-[10px] text-gray-600 font-condensed">{propTab === 'spread' ? 'Spread' : 'Total'}</div>
                  </div>
                  <span className="text-[12px] font-mono text-gray-300 self-center">{g.line ?? '—'}</span>
                  <span className="text-[12px] font-mono text-gray-400 self-center">{g.implied_prob != null ? Math.round(g.implied_prob * 100) + '%' : '—'}</span>
                  <span className="text-[12px] font-mono text-gray-300 self-center">{Math.round(g.hit_rate * 100)}%</span>
                  <span className={cn('text-[12px] font-mono font-bold self-center', g.edge >= 0.1 ? 'text-mint' : 'text-gray-500')}>
                    +{Math.round(g.edge * 100)}%
                  </span>
                </div>
              ))
            }
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 2: Build check**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```

- [ ] **Step 3: Playwright verification**

  Add `<PropsTable picks={null} />` temporarily to NBA.tsx, verify loading/empty states render correctly.

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/components/NBA/PropsTable.tsx
  git commit -m "feat(nba): add PropsTable with bucket tabs and edge sort"
  ```

---

### Task 3: Create StreaksCard

**Files:**
- Create: `client/src/components/NBA/StreaksCard.tsx`

Uses `nbaApi.getPlayerStreaks(stat, window)`. Cross-tab: stat × window. Displays top 10 rows.

- [ ] **Step 1: Create StreaksCard**

  ```tsx
  // client/src/components/NBA/StreaksCard.tsx
  import { useEffect, useState } from 'react'
  import { nbaApi, PlayerStreakRow } from '@/services/api'
  import { Skeleton } from '@/components/ui/skeleton'
  import { cn } from '@/lib/utils'

  type StatKey = 'pts' | 'reb' | 'ast' | 'fg3m'
  type WindowKey = 3 | 5 | 10

  const STAT_TABS: { key: StatKey; label: string }[] = [
    { key: 'pts',  label: 'PTS' },
    { key: 'reb',  label: 'REB' },
    { key: 'ast',  label: 'AST' },
    { key: 'fg3m', label: '3PM' },
  ]
  const WINDOW_TABS: WindowKey[] = [3, 5, 10]

  export default function StreaksCard() {
    const [stat, setStat] = useState<StatKey>('pts')
    const [window, setWindow] = useState<WindowKey>(5)
    const [rows, setRows] = useState<PlayerStreakRow[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      setLoading(true)
      nbaApi.getPlayerStreaks(stat, window)
        .then(res => setRows(res.rows.slice(0, 10)))
        .catch(() => setRows([]))
        .finally(() => setLoading(false))
    }, [stat, window])

    return (
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-[#111]">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Streaks</span>
        </div>

        {/* Stat tabs */}
        <div className="flex border-b border-[#111]">
          {STAT_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setStat(t.key)}
              className={cn(
                'flex-1 py-2.5 text-[11px] font-bold font-condensed tracking-wide uppercase transition-colors relative',
                stat === t.key ? 'text-white' : 'text-gray-600 hover:text-gray-400'
              )}
            >
              {t.label}
              {stat === t.key && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />}
            </button>
          ))}
        </div>

        {/* Window tabs */}
        <div className="flex gap-1 px-4 py-2.5 border-b border-[#111]">
          <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest self-center mr-1">Last</span>
          {WINDOW_TABS.map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={cn(
                'w-9 h-7 rounded-lg text-[11px] font-bold font-mono transition-colors',
                window === w
                  ? 'bg-mint text-black'
                  : 'bg-[#141414] text-gray-600 hover:text-white border border-[#222]'
              )}
            >
              {w}
            </button>
          ))}
        </div>

        {loading && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 bg-[#141414] rounded" />
            ))}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">No streaks found</div>
        )}

        {!loading && rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[10px] text-gray-700 font-mono w-4 flex-shrink-0">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-white font-condensed truncate">{row.player_name}</div>
                <div className="text-[10px] text-gray-600 font-condensed">{row.team}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <span className="text-[11px] text-gray-500 font-mono">{row.rolling_avg.toFixed(1)} avg</span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-black text-mint font-mono">{row.streak_count}</span>
                <span className="text-[9px] text-gray-600 font-condensed uppercase">streak</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }
  ```

- [ ] **Step 2: Build check**

  ```bash
  cd client && npm run build 2>&1 | tail -10
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/components/NBA/StreaksCard.tsx
  git commit -m "feat(nba): add StreaksCard with stat x window cross-tabs"
  ```

---

### Task 4: Assemble NBA.tsx final layout

**Files:**
- Modify: `client/src/pages/NBA/NBA.tsx`

- [ ] **Step 1: Update NBA.tsx to assemble all sections**

  Replace the entire contents of `client/src/pages/NBA/NBA.tsx`:
  ```tsx
  import { useEffect, useState } from 'react'
  import Sidebar from '@/components/Sidebar/Sidebar'
  import TrendFinder from '@/components/TrendFinder/TrendFinder'
  import TopTrending from '@/components/Home/TopTrending'
  import PicksRow from '@/components/NBA/PicksRow'
  import PropsTable from '@/components/NBA/PropsTable'
  import StreaksCard from '@/components/NBA/StreaksCard'
  import { nbaApi, TopPicksResponse } from '@/services/api'

  export default function NBA() {
    const [picks, setPicks] = useState<TopPicksResponse | null>(null)

    useEffect(() => {
      nbaApi.getTopPicks(10).then(setPicks).catch(() => {})
    }, [])

    return (
      <div className="flex h-full">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Row 1: 4 POTD cards */}
          <PicksRow />

          {/* Row 2: Props table */}
          <PropsTable picks={picks} />

          {/* Row 3: Streaks */}
          <StreaksCard />

          {/* Row 4: TrendFinder */}
          <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
            <TrendFinder />
          </div>

          {/* Row 5: TopTrending */}
          <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#111]">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">
                Today's Trending
              </span>
            </div>
            <div className="px-4 py-3">
              <TopTrending />
            </div>
          </div>
        </main>
      </div>
    )
  }
  ```

- [ ] **Step 2: Build and lint**

  ```bash
  cd client && npm run build && npm run lint 2>&1 | tail -15
  ```
  Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Playwright — full NBA page audit**

  Navigate to `http://localhost:5173/nba`. Verify:
  - 4 POTD cards render in a row (or show empty state if no picks)
  - Props table renders with bucket tabs (50/60/70/80/90)
  - Streaks card renders with stat + window tabs
  - TrendFinder and TopTrending appear at the bottom
  - No layout overflow or broken spacing

  Take a screenshot.

- [ ] **Step 4: Run full test suite**

  ```bash
  cd server && npx vitest run 2>&1 | tail -5
  cd ../client && npm run build 2>&1 | tail -5
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/pages/NBA/NBA.tsx
  git commit -m "feat(nba): assemble full NBA page layout — POTD row, props, streaks, trendfinder, trending"
  ```
