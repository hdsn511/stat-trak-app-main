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

function zColor(z: number) {
  if (z >= 1.5) return 'text-[#2AFFC8]'
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
        <Skeleton className="h-16 w-64 bg-[#141414]" />
        <Skeleton className="h-32 w-full bg-[#141414]" />
        <Skeleton className="h-48 w-full bg-[#141414]" />
      </div>
    )
  }

  if (!profile) {
    return <div className="p-6 text-gray-400">Player not found</div>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back + Player header */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[#141414] border border-[#1E1E1E] flex items-center justify-center text-lg font-bold text-[#2AFFC8]">
            {profile.player.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{profile.player.name}</h1>
            <p className="text-sm text-gray-400 mt-0.5">{profile.player.team} · {profile.player.position}</p>
          </div>
        </div>
      </div>

      {/* Z-Score strip */}
      <div className="grid grid-cols-4 gap-3">
        {STATS.map(stat => {
          const z = profile.zScores[stat] ?? 0
          const avg = profile.rollingAvgs[stat]
          const isActive = activeStat === stat
          return (
            <button
              key={stat}
              onClick={() => setActiveStat(stat)}
              className={`p-3 rounded-xl border transition-all text-left ${
                isActive
                  ? 'border-[#2AFFC8] bg-[#2AFFC8]/10'
                  : 'border-[#1E1E1E] bg-[#141414] hover:border-gray-600'
              }`}
            >
              <div className="text-xs text-gray-500 mb-1">{STAT_LABELS[stat]}</div>
              <div className={`text-xl font-bold ${isActive ? 'text-[#2AFFC8]' : zColor(z)}`}>
                {avg != null ? avg.toFixed(1) : '—'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                z: {z != null ? (z > 0 ? '+' : '') + z.toFixed(2) : '—'}
              </div>
            </button>
          )
        })}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Line:</span>
          <input
            type="number"
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-20 bg-[#141414] border border-[#1E1E1E] rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-[#2AFFC8] transition-colors"
          />
          <span className="text-xs text-gray-500">+</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Games:</span>
          {[5, 10, 15, 20].map(n => (
            <button
              key={n}
              onClick={() => setGameWindow(n)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                gameWindow === n
                  ? 'bg-[#2AFFC8] text-black'
                  : 'bg-[#141414] text-gray-400 hover:text-white border border-[#1E1E1E]'
              }`}
            >
              L{n}
            </button>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      {chartGames.length > 0 && (
        <div className="bg-[#141414] border border-[#1E1E1E] rounded-xl p-4">
          <div className="flex items-end gap-1.5 h-48">
            {chartGames.map((game, i) => {
              const val = getStatVal(game, activeStat)
              const pct = (val / maxVal) * 100
              const isOver = val >= threshold
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center gap-1 h-full justify-end group relative"
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      isOver ? 'bg-[#2AFFC8]/80 hover:bg-[#2AFFC8]' : 'bg-red-500/70 hover:bg-red-500'
                    }`}
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-[10px] text-gray-600 group-hover:text-gray-300">
                    G{i + 1}
                  </span>
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block bg-black border border-[#1E1E1E] rounded px-2 py-1 text-xs text-white whitespace-nowrap z-10">
                    {val} {STAT_LABELS[activeStat]}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="w-3 h-0.5 bg-[#2AFFC8]" />
            <span className="text-xs text-gray-500">Line: {threshold}+</span>
            <Badge className="ml-auto bg-[#2AFFC8]/10 text-[#2AFFC8] border-[#2AFFC8]/20">
              {hitRate}% hit rate
            </Badge>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Hit Rate', value: `${hitRate}%` },
          { label: `L${gameWindow} Avg`, value: avg.toFixed(1) },
          { label: 'Best Game', value: chartGames.length ? Math.max(...chartGames.map(g => getStatVal(g, activeStat))) : '—' },
        ].map(item => (
          <div key={item.label} className="bg-[#141414] border border-[#1E1E1E] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">{item.value}</div>
            <div className="text-xs text-gray-500 mt-1">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
