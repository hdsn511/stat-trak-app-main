import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { nbaApi, PlayerProfile, GameStat, Pick } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const STATS = ['points', 'rebounds', 'assists', 'threes'] as const
type StatKey = typeof STATS[number]

const STAT_LABELS: Record<StatKey, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM',
}

function zColor(z: number) {
  if (z >= 1.5) return 'text-mint'
  if (z >= 0.5) return 'text-green-400'
  if (z <= -1.5) return 'text-red-400'
  if (z <= -0.5) return 'text-orange-400'
  return 'text-gray-500'
}

export default function PlayerDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [playerPicks, setPlayerPicks] = useState<Pick[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStat, setActiveStat] = useState<StatKey>('points')
  const [threshold, setThreshold] = useState(20)
  const [gameWindow, setGameWindow] = useState(10)

  useEffect(() => {
    if (!id) return
    nbaApi.getPlayerProfile(parseInt(id))
      .then(data => {
        setProfile(data)
        const ptAvg = data.seasonAvgs?.points ?? data.rollingAvgs?.points
        if (ptAvg) setThreshold(Math.floor(ptAvg))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!id) return
    nbaApi.getPlayerPicks(parseInt(id))
      .then(setPlayerPicks)
      .catch(() => {})
  }, [id])

  const chartGames = useMemo(() => {
    if (!profile) return []
    return profile.games.slice(0, gameWindow)
  }, [profile, gameWindow])

  const displayGames = useMemo(() => [...chartGames].reverse(), [chartGames])

  const getStatVal = (game: GameStat, stat: StatKey): number =>
    game[stat as keyof GameStat] as number

  const maxVal = useMemo(
    () => Math.max(...chartGames.map(g => getStatVal(g, activeStat)), threshold, 1),
    [chartGames, activeStat, threshold]
  )

  const hitRate = useMemo(() => {
    if (!chartGames.length) return 0
    const hits = chartGames.filter(g => getStatVal(g, activeStat) >= threshold).length
    return Math.round((hits / chartGames.length) * 100)
  }, [chartGames, activeStat, threshold])

  const avg = useMemo(() => {
    if (!chartGames.length) return 0
    return chartGames.reduce((s, g) => s + getStatVal(g, activeStat), 0) / chartGames.length
  }, [chartGames, activeStat])

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-48 bg-[#0F0F0F]" />
        <Skeleton className="h-20 w-full bg-[#0F0F0F]" />
        <Skeleton className="h-32 w-full bg-[#0F0F0F]" />
        <Skeleton className="h-52 w-full bg-[#0F0F0F]" />
      </div>
    )
  }

  if (!profile) {
    return <div className="p-6 text-gray-600">Player not found</div>
  }

  const thresholdPct = (threshold / maxVal) * 100

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
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
              {profile.teamId
                ? (
                  <button
                    onClick={() => navigate(`/team/${profile.teamId}`)}
                    className="hover:text-white transition-colors"
                  >
                    {profile.player.team}
                  </button>
                )
                : profile.player.team}
              {' · '}{profile.player.position}
            </p>
          </div>
          {/* Season avg quick stats */}
          <div className="hidden sm:flex gap-5 flex-shrink-0">
            {STATS.map(stat => (
              <div key={stat} className="text-center">
                <div className="text-[20px] font-black font-mono text-white tabular-nums leading-none">
                  {profile.seasonAvgs?.[stat]?.toFixed(1) ?? '—'}
                </div>
                <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">{STAT_LABELS[stat]}</div>
              </div>
            ))}
            {profile.gamesPlayed > 0 && (
              <div className="text-center self-end">
                <div className="text-[11px] text-gray-700 font-mono tabular-nums leading-none">{profile.gamesPlayed}</div>
                <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">GP</div>
              </div>
            )}
          </div>
        </div>
      </div>

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
              <div className={cn('text-[15px] font-black font-mono tabular-nums leading-tight mt-0.5', isActive ? 'text-mint' : zColor(z))}>
                {profile.rollingAvgs[stat]?.toFixed(1) ?? '—'}
              </div>
              <div className={cn('text-[9px] font-condensed', isActive ? 'text-mint/40' : 'text-gray-800')}>L10</div>
              <div className={cn('text-[9px] font-mono', isActive ? 'text-mint/60' : 'text-gray-700')}>
                {z != null ? (z > 0 ? '+' : '') + z.toFixed(2) + 'σ' : '—'}
              </div>
              {isActive && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />}
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase">Line</span>
          <input
            type="number"
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-20 bg-[#0D0D0D] border border-[#1E1E1E] rounded-xl px-3 py-1.5 text-sm text-white outline-none focus:border-mint/30 transition-colors text-center font-bold tabular-nums font-mono"
          />
          <span className="text-[11px] text-gray-700 font-condensed">+</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase mr-1">Last</span>
          {[5, 10, 15, 20].map(n => (
            <button
              key={n}
              onClick={() => setGameWindow(n)}
              className={`w-9 h-8 rounded-lg text-[13px] font-bold font-mono transition-colors ${
                gameWindow === n
                  ? 'bg-mint text-black'
                  : 'bg-[#0D0D0D] text-gray-600 hover:text-white border border-[#1E1E1E]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      {chartGames.length > 0 && (
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-4">
          {/* Chart area with threshold line */}
          <div className="relative h-44 mb-1">
            {/* Threshold line */}
            <div
              className="absolute left-0 right-0 z-10 pointer-events-none"
              style={{ bottom: `${Math.min(thresholdPct, 98)}%` }}
            >
              <div className="border-t border-dashed border-mint/35 relative">
                <span className="absolute -top-3.5 right-0 text-[9px] text-mint/60 font-condensed font-bold bg-[#0D0D0D] px-1">
                  {threshold}+
                </span>
              </div>
            </div>

            {/* Bars */}
            <div className="absolute inset-0 flex items-end gap-1">
              {displayGames.map((game, i) => {
                const val = getStatVal(game, activeStat)
                const pct = (val / maxVal) * 100
                const isOver = val >= threshold
                const hasGameId = game.gameId != null
                return (
                  <div
                    key={i}
                    onClick={() => hasGameId && navigate(`/game/${game.gameId}`)}
                    className={cn(
                      'flex-1 h-full flex items-end group relative',
                      hasGameId ? 'cursor-pointer' : 'cursor-default'
                    )}
                  >
                    <div
                      className={cn(
                        'w-full rounded-t animate-bar-grow transition-opacity',
                        isOver
                          ? 'bg-green-500/80 group-hover:bg-green-500/100'
                          : 'bg-red-500/80 group-hover:bg-red-500/100'
                      )}
                      style={{
                        height: `${Math.max(pct, 3)}%`,
                        animationDelay: `${i * 22}ms`,
                      }}
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-2.5 py-1.5 z-20 shadow-2xl whitespace-nowrap">
                      <span className="text-[12px] font-black text-mint font-mono">{val}</span>
                      <span className="text-[10px] text-gray-500 ml-1 font-condensed">{STAT_LABELS[activeStat]}</span>
                      {game.opponent && (
                        <div className="text-[9px] text-gray-600 font-condensed mt-0.5">vs {game.opponent}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Game labels */}
          <div className="flex gap-1 mb-3">
            {displayGames.map((game, i) => (
              <div key={i} className="flex-1 text-center">
                <div className="text-[8px] text-gray-700 font-condensed font-bold truncate">
                  {game.opponent ?? `G${i + 1}`}
                </div>
                {game.date && (
                  <div className="text-[7px] text-gray-800 font-condensed truncate">
                    {new Date(game.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 pt-2 border-t border-[#141414]">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-green-500/80" />
              <span className="text-[10px] text-gray-600 font-condensed">Over {threshold}+</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-red-500/80" />
              <span className="text-[10px] text-gray-600 font-condensed">Under</span>
            </div>
            <Badge className="ml-auto bg-mint/10 text-mint border-mint/20 font-mono font-bold text-[11px]">
              {hitRate}% hit rate
            </Badge>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'Hit Rate', value: `${hitRate}%` },
          { label: `L${gameWindow} Avg`, value: avg.toFixed(1) },
          { label: 'Best Game', value: chartGames.length ? Math.max(...chartGames.map(g => getStatVal(g, activeStat))) : '—' },
        ].map(item => (
          <div key={item.label} className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-4 text-center">
            <div className="text-3xl font-black text-white font-mono tabular-nums">{item.value}</div>
            <div className="text-[10px] text-gray-700 mt-1.5 font-condensed tracking-widest uppercase">{item.label}</div>
          </div>
        ))}
      </div>

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
    </div>
  )
}
