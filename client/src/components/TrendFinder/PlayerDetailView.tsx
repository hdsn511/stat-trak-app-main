import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { nbaApi, PlayerProfile, GameStat } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

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
  const [loading, setLoading] = useState(true)
  const [activeStat, setActiveStat] = useState<StatKey>('points')
  const [threshold, setThreshold] = useState(20)
  const [gameWindow, setGameWindow] = useState(10)

  useEffect(() => {
    if (!id) return
    nbaApi.getPlayerProfile(parseInt(id))
      .then(data => {
        setProfile(data)
        const ptAvg = data.rollingAvgs?.points
        if (ptAvg) setThreshold(Math.floor(ptAvg))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  const chartGames = useMemo(() => {
    if (!profile) return []
    return profile.games.slice(0, gameWindow)
  }, [profile, gameWindow])

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
          className="flex items-center gap-1.5 text-[12px] text-gray-600 hover:text-white mb-5 transition-colors font-condensed tracking-wide"
        >
          <ArrowLeft size={14} /> Back
        </button>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#0F0F0F] border border-[#1A1A1A] flex items-center justify-center text-base font-black text-mint font-condensed">
            {profile.player.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h1 className="text-3xl font-black text-white font-condensed tracking-tight leading-none">
              {profile.player.name}
            </h1>
            <p className="text-[12px] text-gray-600 mt-1 font-condensed tracking-wide">
              {profile.player.team} · {profile.player.position}
            </p>
          </div>
        </div>
      </div>

      {/* Stat selector cards */}
      <div className="grid grid-cols-4 gap-2.5">
        {STATS.map(stat => {
          const z = profile.zScores[stat] ?? 0
          const statAvg = profile.rollingAvgs[stat]
          const isActive = activeStat === stat
          return (
            <button
              key={stat}
              onClick={() => setActiveStat(stat)}
              className={`p-3.5 rounded-2xl border transition-all text-left ${
                isActive
                  ? 'border-mint/30 bg-[#0D1A14]'
                  : 'border-[#161616] bg-[#0D0D0D] hover:border-[#222]'
              }`}
            >
              <div className="text-[10px] text-gray-700 mb-2 font-condensed font-bold tracking-widest uppercase">
                {STAT_LABELS[stat]}
              </div>
              <div className={`text-2xl font-black font-condensed tabular-nums leading-none ${isActive ? 'text-mint' : zColor(z)}`}>
                {statAvg != null ? statAvg.toFixed(1) : '—'}
              </div>
              <div className={`text-[10px] mt-1.5 font-condensed font-bold ${isActive ? 'text-mint/60' : 'text-gray-700'}`}>
                {z != null ? (z > 0 ? '+' : '') + z.toFixed(2) + 'σ' : '—'}
              </div>
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
            className="w-20 bg-[#0D0D0D] border border-[#1E1E1E] rounded-xl px-3 py-1.5 text-sm text-white outline-none focus:border-mint/30 transition-colors text-center font-bold tabular-nums"
          />
          <span className="text-[11px] text-gray-700 font-condensed">+</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase mr-1">Last</span>
          {[5, 10, 15, 20].map(n => (
            <button
              key={n}
              onClick={() => setGameWindow(n)}
              className={`w-9 h-8 rounded-lg text-[13px] font-bold font-condensed transition-colors ${
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
              {chartGames.map((game, i) => {
                const val = getStatVal(game, activeStat)
                const pct = (val / maxVal) * 100
                const isOver = val >= threshold
                return (
                  <div
                    key={i}
                    className="flex-1 h-full flex items-end group relative"
                  >
                    <div
                      className={`w-full rounded-t animate-bar-grow ${
                        isOver
                          ? 'bg-mint/60 hover:bg-mint/90'
                          : 'bg-red-500/40 hover:bg-red-500/70'
                      }`}
                      style={{
                        height: `${Math.max(pct, 3)}%`,
                        animationDelay: `${i * 22}ms`,
                      }}
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-2.5 py-1.5 z-20 shadow-2xl whitespace-nowrap">
                      <span className="text-[12px] font-black text-mint font-condensed">{val}</span>
                      <span className="text-[10px] text-gray-500 ml-1 font-condensed">{STAT_LABELS[activeStat]}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Game labels */}
          <div className="flex gap-1 mb-3">
            {chartGames.map((_, i) => (
              <div key={i} className="flex-1 text-center text-[8px] text-gray-800 font-condensed font-bold">
                G{i + 1}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 pt-2 border-t border-[#141414]">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-mint/60" />
              <span className="text-[10px] text-gray-600 font-condensed">Over {threshold}+</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-red-500/40" />
              <span className="text-[10px] text-gray-600 font-condensed">Under</span>
            </div>
            <Badge className="ml-auto bg-mint/10 text-mint border-mint/20 font-condensed font-bold text-[11px]">
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
            <div className="text-3xl font-black text-white font-condensed tabular-nums">{item.value}</div>
            <div className="text-[10px] text-gray-700 mt-1.5 font-condensed tracking-widest uppercase">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
