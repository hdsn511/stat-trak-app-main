import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { SlidersHorizontal, ChevronRight } from 'lucide-react'

const STATS = [
  { id: 'points', label: 'PTS' },
  { id: 'rebounds', label: 'REB' },
  { id: 'assists', label: 'AST' },
  { id: 'threes', label: '3PM' },
] as const

const WINDOWS = [5, 10, 15, 20] as const

type StatId = typeof STATS[number]['id']

function zBadgeClass(z: number) {
  if (z >= 1.5) return 'bg-mint/10 text-mint border-mint/20'
  if (z >= 0.5) return 'bg-green-500/10 text-green-400 border-green-500/20'
  return 'bg-[#1A1A1A] text-gray-600 border-[#222]'
}

export default function TrendFinder() {
  const navigate = useNavigate()
  const [stat, setStat] = useState<StatId>('points')
  const [threshold, setThreshold] = useState('')
  const [window, setWindow] = useState<number>(10)
  const [players, setPlayers] = useState<TrendingPlayer[]>([])
  const [loading, setLoading] = useState(false)

  const fetchTrends = useCallback(async () => {
    setLoading(true)
    try {
      const t = parseFloat(threshold)
      const results = await nbaApi.getTrends({
        stat,
        window,
        threshold: t > 0 ? t : undefined,
      })
      setPlayers(results)
    } catch {
      setPlayers([])
    } finally {
      setLoading(false)
    }
  }, [stat, window, threshold])

  useEffect(() => {
    fetchTrends()
  }, [fetchTrends])

  const statLabel = (statId: string) =>
    STATS.find(s => s.id === statId)?.label ?? statId.toUpperCase()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={13} className="text-mint" />
        <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-[0.2em] font-condensed">Trend Finder</h2>
      </div>

      {/* Stat tabs */}
      <div className="flex border-b border-[#161616]">
        {STATS.map(s => (
          <button
            key={s.id}
            onClick={() => setStat(s.id)}
            className={`relative px-5 py-2.5 text-[13px] font-bold font-condensed tracking-widest uppercase transition-colors ${
              stat === s.id ? 'text-white' : 'text-gray-700 hover:text-gray-400'
            }`}
          >
            {s.label}
            {stat === s.id && (
              <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase">Line</span>
          <input
            type="number"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            placeholder="—"
            className="w-20 bg-[#0D0D0D] border border-[#1E1E1E] rounded-xl px-3 py-1.5 text-sm text-white placeholder-gray-800 outline-none focus:border-mint/30 transition-colors text-center font-bold tabular-nums"
          />
          <span className="text-[11px] text-gray-700 font-condensed">+</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 font-condensed tracking-widest uppercase mr-1">Last</span>
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`w-9 h-8 rounded-lg text-[13px] font-bold font-condensed tracking-wide transition-colors ${
                window === w
                  ? 'bg-mint text-black'
                  : 'bg-[#0D0D0D] text-gray-600 hover:text-white border border-[#1E1E1E]'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-[60px] w-full bg-[#0D0D0D] rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && players.length === 0 && (
        <div className="py-14 text-center">
          <div className="text-5xl font-black text-[#161616] font-condensed mb-2">— —</div>
          <p className="text-sm text-gray-700">No players match these filters</p>
        </div>
      )}

      {/* Results */}
      {!loading && players.map((player, i) => (
        <button
          key={`${player.playerId}-${player.statId}-${i}`}
          onClick={() => navigate(`/player/${player.playerId}`, { state: { player } })}
          className="w-full flex items-center gap-4 px-4 py-3.5 bg-[#0D0D0D] border border-[#161616] rounded-xl hover:border-mint/25 hover:bg-[#0D1A14] transition-all text-left group"
        >
          {/* Avatar */}
          <div className="w-9 h-9 rounded-xl bg-[#161616] flex items-center justify-center text-[11px] font-black text-mint flex-shrink-0 font-condensed group-hover:bg-mint/10 transition-colors">
            {player.playerName?.split(' ').map(n => n[0]).join('') ?? '?'}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-gray-300 truncate group-hover:text-white transition-colors">
              {player.playerName}
            </div>
            <div className="text-[10px] text-gray-700 font-condensed tracking-wide mt-0.5">
              {player.team} · {player.position}
            </div>
          </div>

          {/* Rolling avg */}
          <div className="text-right flex-shrink-0">
            <div className="text-[20px] font-black text-white font-condensed tabular-nums leading-none">
              {player.rollingAvg.toFixed(1)}
            </div>
            <div className="text-[10px] text-gray-700 font-condensed mt-0.5">
              avg {statLabel(player.stat)}
            </div>
          </div>

          {/* Z-score badge */}
          <Badge className={`flex-shrink-0 font-condensed font-bold text-[11px] ${zBadgeClass(player.zScore)}`}>
            {player.zScore > 0 ? '+' : ''}{player.zScore.toFixed(2)}σ
          </Badge>

          <ChevronRight size={13} className="text-gray-800 group-hover:text-mint flex-shrink-0 transition-colors" />
        </button>
      ))}
    </div>
  )
}
