import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Minus, Plus, TrendingUp, TrendingDown } from 'lucide-react'
import { getMLBPlayerProfile, mlbApi, MLBGameStat, MLBPlayerProfile, Pick } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import StatBarChart, { ChartBar } from './StatBarChart'

// Stats surfaced in the player view. `field` indexes the per-game MLBGameStat;
// `avgKey` indexes the season/rolling/z-score maps (keyed by stat name, not the
// camelCase game field).
interface StatDef {
  key: string
  label: string
  field: keyof MLBGameStat
  avgKey: string
}

const MLB_BATTER_STATS: StatDef[] = [
  { key: 'hits', label: 'H',   field: 'hits',       avgKey: 'hits' },
  { key: 'tb',   label: 'TB',  field: 'totalBases', avgKey: 'total_bases' },
  { key: 'rbi',  label: 'RBI', field: 'rbi',        avgKey: 'rbi' },
  { key: 'runs', label: 'R',   field: 'runs',       avgKey: 'runs' },
  { key: 'hr',   label: 'HR',  field: 'homeRuns',   avgKey: 'home_runs' },
]

// Pitcher line — strikeouts ('ks') is the marquee market and the default tab.
const MLB_PITCHER_STATS: StatDef[] = [
  { key: 'ks',   label: 'K',    field: 'strikeoutsPitched', avgKey: 'strikeouts_pitched' },
  { key: 'outs', label: 'Outs', field: 'outsPitched',       avgKey: 'outs_pitched' },
  { key: 'er',   label: 'ER',   field: 'earnedRuns',        avgKey: 'earned_runs' },
  { key: 'ha',   label: 'H',    field: 'hitsAllowed',       avgKey: 'hits_allowed' },
  { key: 'bb',   label: 'BB',   field: 'walksAllowed',      avgKey: 'walks_allowed' },
]

const statSet = (pitcher?: boolean): StatDef[] => (pitcher ? MLB_PITCHER_STATS : MLB_BATTER_STATS)

type Venue = 'all' | 'home' | 'away'

const WINDOWS = [5, 10, 15, 20] as const

function statVal(game: MLBGameStat, field: keyof MLBGameStat): number {
  return (game[field] as number) ?? 0
}

// A sensible default over/under line: the nearest 0.5 boundary at or just below
// the season average, so "over 1.5 H" reads naturally. Clamped to 0.5.
function defaultLine(avg: number): number {
  if (!avg || avg <= 0) return 0.5
  const r = Math.round(avg * 2) / 2
  const line = Number.isInteger(r) ? r - 0.5 : r
  return Math.max(0.5, line)
}

function mean(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

// Position codes that mean "pitcher" (they essentially never bat in the DH era).
function isPitcher(position?: string): boolean {
  if (!position) return false
  return /^(p|sp|rp|lhp|rhp)$/i.test(position.trim()) || /pitch/i.test(position)
}

function zColor(z: number) {
  if (z >= 1.5) return 'text-mint'
  if (z >= 0.5) return 'text-green-400'
  if (z <= -1.5) return 'text-red-400'
  if (z <= -0.5) return 'text-orange-400'
  return 'text-gray-500'
}

export default function MLBPlayerView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<MLBPlayerProfile | null>(null)
  const [playerPicks, setPlayerPicks] = useState<Pick[]>([])
  const [loading, setLoading] = useState(true)

  const [activeKey, setActiveKey] = useState<string>('hits')
  const [line, setLine] = useState(0.5)
  const [window, setWindow] = useState<number>(10)
  const [venue, setVenue] = useState<Venue>('all')
  // Tracks whether the user has hand-edited the line; until then we keep it in
  // sync with the active stat's smart default / today's pick line.
  const [lineTouched, setLineTouched] = useState(false)

  const STATS = statSet(profile?.isPitcher)
  const active = STATS.find(s => s.key === activeKey) ?? STATS[0]

  const todayStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []) // YYYY-MM-DD

  useEffect(() => {
    if (!id) return
    setLoading(true)
    getMLBPlayerProfile(parseInt(id))
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
    mlbApi.getPlayerPicks(parseInt(id)).then(setPlayerPicks).catch(() => {})
  }, [id])

  // Only picks generated for today — older picks are stale (different markets/lines).
  const todaysPicks = useMemo(
    () => playerPicks.filter(p => p.date === todayStr),
    [playerPicks, todayStr]
  )

  // The pick that drives the verdict + the line default for the active stat.
  const activePick = useMemo(
    () => todaysPicks.find(p => p.stat === active.key) ?? null,
    [todaysPicks, active.key]
  )

  // Reset the line whenever the stat changes (unless the user is steering it).
  useEffect(() => {
    if (lineTouched) return
    const fromPick = activePick?.recommendedLine
    const avg = profile?.seasonAvgs?.[active.avgKey] ?? profile?.rollingAvgs?.[active.avgKey] ?? 0
    setLine(fromPick ?? defaultLine(avg))
  }, [active.avgKey, activePick, profile, lineTouched])

  // Keep the active stat valid for the player's role: a pitcher defaults to the
  // K tab, a batter to hits. Runs on load (and clears any stale line override).
  useEffect(() => {
    if (!profile) return
    const set = statSet(profile.isPitcher)
    if (!set.some(s => s.key === activeKey)) {
      setActiveKey(set[0].key)
      setLineTouched(false)
    }
  }, [profile, activeKey])

  // Switching stats clears the manual line override.
  const selectStat = (key: string) => {
    setActiveKey(key)
    setLineTouched(false)
  }

  // Only games the player actually appeared in — a batter needs a plate
  // appearance, a pitcher needs to have faced a batter. A 0-for-N game (PA > 0)
  // still counts; a true DNP (no PA and no batters faced) is dropped so it never
  // renders as a misleading "0" bar.
  const games = useMemo(
    () => (profile?.games ?? []).filter(g => (g.plateAppearances ?? 0) > 0 || (g.battersFaced ?? 0) > 0),
    [profile]
  )

  const windowed = useMemo(() => {
    const filtered = venue === 'all'
      ? games
      : games.filter(g => (venue === 'home' ? g.isHome === true : g.isHome === false))
    return filtered.slice(0, window)
  }, [games, venue, window])

  const bars: ChartBar[] = useMemo(
    () => [...windowed].reverse().map(g => ({
      value: statVal(g, active.field),
      opponent: g.opponent,
      date: g.date,
      gameId: g.gameId,
      isHome: g.isHome,
    })),
    [windowed, active.field]
  )

  const hitRate = useMemo(() => {
    if (!windowed.length) return 0
    const hits = windowed.filter(g => statVal(g, active.field) >= line).length
    return Math.round((hits / windowed.length) * 100)
  }, [windowed, active.field, line])

  const avg = useMemo(() => mean(windowed.map(g => statVal(g, active.field))), [windowed, active.field])
  const best = useMemo(
    () => (windowed.length ? Math.max(...windowed.map(g => statVal(g, active.field))) : 0),
    [windowed, active.field]
  )

  const homeAvg = useMemo(() => mean(games.filter(g => g.isHome === true).map(g => statVal(g, active.field))), [games, active.field])
  const awayAvg = useMemo(() => mean(games.filter(g => g.isHome === false).map(g => statVal(g, active.field))), [games, active.field])

  const z = profile?.zScores?.[active.avgKey] ?? 0

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-48 bg-[#0F0F0F]" />
        <Skeleton className="h-24 w-full bg-[#0F0F0F]" />
        <Skeleton className="h-14 w-full bg-[#0F0F0F]" />
        <Skeleton className="h-60 w-full bg-[#0F0F0F]" />
      </div>
    )
  }

  if (!profile) {
    return <div className="p-6 text-gray-600 font-condensed">Player not found</div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-5">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-white transition-colors font-condensed tracking-wide uppercase"
      >
        <ArrowLeft size={12} /> Back
      </button>

      {/* Player header + season strip */}
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#222] flex items-center justify-center text-lg font-black text-mint font-condensed flex-shrink-0">
          {profile.player.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[26px] sm:text-[28px] font-bold text-white font-condensed tracking-tight leading-none truncate">
            {profile.player.name}
          </h1>
          <p className="text-[11px] text-gray-600 mt-1 font-condensed tracking-wide">
            {profile.teamId
              ? <button onClick={() => navigate(`/team/${profile.teamId}`)} className="hover:text-white transition-colors">{profile.player.team}</button>
              : profile.player.team}
            {' · '}{profile.player.position}
          </p>
        </div>
        {games.length > 0 && <div className="hidden sm:flex gap-5 flex-shrink-0">
          {STATS.map(stat => (
            <div key={stat.key} className="text-center">
              <div className="text-[20px] font-black font-mono text-white tabular-nums leading-none">
                {profile.seasonAvgs?.[stat.avgKey]?.toFixed(1) ?? '—'}
              </div>
              <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">{stat.label}</div>
            </div>
          ))}
          {profile.gamesPlayed > 0 && (
            <div className="text-center self-end">
              <div className="text-[11px] text-gray-700 font-mono tabular-nums leading-none">{profile.gamesPlayed}</div>
              <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">GP</div>
            </div>
          )}
        </div>}
      </div>

      {games.length > 0 ? (
      <>
      <BetVerdict pick={activePick} fallbackPick={todaysPicks[0] ?? null} activeLabel={active.label} />

      {/* Stat selector */}
      <div className="flex border-b border-[#161616]">
        {STATS.map(stat => {
          const sz = profile.zScores?.[stat.avgKey] ?? 0
          const isActive = activeKey === stat.key
          // Pitchers have no rolling-trend rows, so fall back to the season avg.
          const rolling = profile.rollingAvgs?.[stat.avgKey]
          const num = rolling ?? profile.seasonAvgs?.[stat.avgKey]
          return (
            <button
              key={stat.key}
              onClick={() => selectStat(stat.key)}
              className={cn(
                'flex-1 py-3 px-2 text-center relative transition-colors min-h-[44px]',
                isActive ? 'text-white' : 'text-gray-600 hover:text-gray-400'
              )}
            >
              <div className="text-[10px] font-bold font-condensed uppercase tracking-widest">{stat.label}</div>
              <div className={cn('text-[15px] font-black font-mono tabular-nums leading-tight mt-0.5', isActive ? 'text-mint' : zColor(sz))}>
                {num?.toFixed(1) ?? '—'}
              </div>
              <div className={cn('text-[9px] font-condensed', isActive ? 'text-mint/40' : 'text-gray-800')}>
                {rolling != null ? 'L10' : 'SZN'}
              </div>
              {isActive && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />}
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">
        {/* Line stepper */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase">Line</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setLineTouched(true); setLine(l => Math.max(0.5, Math.round((l - 0.5) * 2) / 2)) }}
              className="w-9 h-9 rounded-lg bg-[#0D0D0D] border border-[#1E1E1E] text-gray-400 hover:text-white hover:border-mint/30 flex items-center justify-center transition-colors"
              aria-label="Lower line"
            >
              <Minus size={14} />
            </button>
            <span className="w-12 text-center text-[16px] font-black font-mono text-white tabular-nums">{line}</span>
            <button
              onClick={() => { setLineTouched(true); setLine(l => Math.round((l + 0.5) * 2) / 2) }}
              className="w-9 h-9 rounded-lg bg-[#0D0D0D] border border-[#1E1E1E] text-gray-400 hover:text-white hover:border-mint/30 flex items-center justify-center transition-colors"
              aria-label="Raise line"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Window */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase mr-1">Last</span>
          {WINDOWS.map(n => (
            <button
              key={n}
              onClick={() => setWindow(n)}
              className={cn(
                'w-10 h-9 rounded-lg text-[13px] font-bold font-mono transition-colors',
                window === n ? 'bg-mint text-black' : 'bg-[#0D0D0D] text-gray-600 hover:text-white border border-[#1E1E1E]'
              )}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Venue */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase mr-1">Venue</span>
          {(['all', 'home', 'away'] as Venue[]).map(v => (
            <button
              key={v}
              onClick={() => setVenue(v)}
              className={cn(
                'h-9 px-3 rounded-lg text-[11px] font-bold font-condensed uppercase tracking-wide transition-colors',
                venue === v ? 'bg-mint text-black' : 'bg-[#0D0D0D] text-gray-600 hover:text-white border border-[#1E1E1E]'
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* HERO: bar chart */}
      <StatBarChart
        bars={bars}
        threshold={line}
        statLabel={active.label}
        onBarClick={gid => navigate(`/game/${gid}`)}
      />

      {/* Insight chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <InsightCard label={`Hit Rate (L${window})`} value={`${hitRate}%`} accent={hitRate >= 60} />
        <InsightCard label={`L${window} Avg`} value={avg.toFixed(1)} />
        <InsightCard label="Best Game" value={best} />
        <InsightCard
          label="Season Trend"
          value={(z > 0 ? '+' : '') + z.toFixed(2) + 'σ'}
          icon={z >= 0.25 ? <TrendingUp size={14} className="text-mint" /> : z <= -0.25 ? <TrendingDown size={14} className="text-red-400" /> : undefined}
        />
      </div>

      {/* Home / Away split for the active stat */}
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-4 flex items-center justify-around">
        <SplitStat label="Home avg" value={homeAvg} active={venue === 'home'} statLabel={active.label} />
        <div className="w-px h-8 bg-[#1A1A1A]" />
        <SplitStat label="Away avg" value={awayAvg} active={venue === 'away'} statLabel={active.label} />
      </div>
      </>
      ) : (
        <NoBattingState name={profile.player.name} pitcher={profile.isPitcher ?? isPitcher(profile.player.position)} />
      )}

      {/* Today's props */}
      {todaysPicks.length > 0 && (
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Today's Props</span>
          </div>
          {todaysPicks.map((pick, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0">
              <span className="text-[12px] font-bold text-white font-condensed">{pick.statLabel} {pick.recommendedLine}+</span>
              <div className="flex items-center gap-4">
                <span className="text-[11px] text-gray-500 font-condensed">Mkt <span className="font-mono">{Math.round(pick.impliedProb * 100)}%</span></span>
                <span className="text-[11px] text-gray-400 font-condensed">Hit <span className="font-mono">{Math.round(pick.hitRate * 100)}%</span></span>
                <span className={cn('text-[11px] font-bold font-condensed', pick.edge >= 0 ? 'text-mint' : 'text-red-400')}>
                  Edge <span className="font-mono">{pick.edge >= 0 ? '+' : ''}{Math.round(pick.edge * 100)}%</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── The actionable verdict — the "bet to take" for today's slate ──────────────
function BetVerdict({ pick, fallbackPick, activeLabel }: { pick: Pick | null; fallbackPick: Pick | null; activeLabel: string }) {
  const shown = pick ?? fallbackPick
  if (!shown) {
    return (
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
        <div className="text-[10px] font-bold text-gray-600 uppercase tracking-[0.2em] font-condensed">Verdict</div>
        <div className="text-[15px] text-gray-400 font-condensed mt-1.5">No flagged edge for {activeLabel} today — no qualifying market.</div>
      </div>
    )
  }
  const offStat = !pick // showing a fallback for a different stat than the active tab
  const edgePct = Math.round(shown.edge * 100)
  const positive = shown.edge >= 0
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-mint/20 p-5"
      style={{ background: 'linear-gradient(135deg, #07140f 0%, #0a0a0a 60%)' }}
    >
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-mint/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] font-bold text-mint/70 uppercase tracking-[0.2em] font-condensed">
            {offStat ? `Top edge today · ${shown.statLabel}` : 'Verdict'}
          </div>
          <div className="text-[26px] sm:text-[30px] font-black text-white font-condensed leading-none mt-1.5">
            BET OVER <span className="text-mint font-display">{shown.recommendedLine}</span> {shown.statLabel}
          </div>
          <div className="text-[11px] text-gray-500 font-condensed mt-2">
            {Math.round(shown.hitRate * 100)}% historical hit rate over {shown.sampleSize} comparable games
            {shown.conditionsMatched ? ` · ${shown.conditionsMatched}/${shown.totalConditions} conditions met` : ''}
          </div>
        </div>
        <div className="flex items-stretch gap-3">
          <VerdictStat label="Hit" value={`${Math.round(shown.hitRate * 100)}%`} />
          <VerdictStat label="Mkt" value={`${Math.round(shown.impliedProb * 100)}%`} />
          <VerdictStat label="Edge" value={`${positive ? '+' : ''}${edgePct}%`} highlight={positive} />
          <VerdictStat label="Conf" value={`${Math.round(shown.confidence)}`} />
        </div>
      </div>
    </div>
  )
}

// Shown only when a player has no logged appearances at all this season —
// e.g. a just-called-up arm or a position player yet to play.
function NoBattingState({ name, pitcher }: { name: string; pitcher: boolean }) {
  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-8 sm:p-10 text-center">
      <div className="text-[13px] font-bold text-gray-300 font-condensed">No games logged yet</div>
      <div className="text-[11px] text-gray-600 font-condensed mt-1.5 max-w-sm mx-auto">
        {`No qualifying ${pitcher ? 'pitching' : 'batting'} appearances for ${name} this season.`}
      </div>
    </div>
  )
}

function VerdictStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center px-1">
      <div className={cn('text-[18px] sm:text-[20px] font-black font-mono tabular-nums leading-none', highlight ? 'text-mint' : 'text-white')}>{value}</div>
      <div className="text-[9px] text-gray-600 font-condensed uppercase tracking-widest mt-1">{label}</div>
    </div>
  )
}

function InsightCard({ label, value, accent, icon }: { label: string; value: string | number; accent?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-4 text-center">
      <div className="flex items-center justify-center gap-1.5">
        <div className={cn('text-2xl sm:text-3xl font-black font-mono tabular-nums', accent ? 'text-mint' : 'text-white')}>{value}</div>
        {icon}
      </div>
      <div className="text-[10px] text-gray-700 mt-1.5 font-condensed tracking-widest uppercase">{label}</div>
    </div>
  )
}

function SplitStat({ label, value, active, statLabel }: { label: string; value: number; active: boolean; statLabel: string }) {
  return (
    <div className="text-center">
      <div className={cn('text-xl font-black font-mono tabular-nums', active ? 'text-mint' : 'text-white')}>{value.toFixed(1)}</div>
      <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-1">{label} · {statLabel}</div>
    </div>
  )
}
