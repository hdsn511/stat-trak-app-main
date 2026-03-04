import { useState, useEffect, useCallback } from 'react'
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
] as const

const WINDOWS = [5, 10, 15, 20] as const

type StatId = typeof STATS[number]['id']

function zBadgeClass(z: number) {
  if (z >= 1.5) return 'bg-[#2AFFC8]/10 text-[#2AFFC8] border-[#2AFFC8]/20'
  if (z >= 0.5) return 'bg-green-500/10 text-green-400 border-green-500/20'
  return 'bg-gray-500/10 text-gray-400 border-gray-500/20'
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
        <SlidersHorizontal size={16} className="text-[#2AFFC8]" />
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Trend Finder</h2>
      </div>

      {/* Stat selector */}
      <div className="flex flex-wrap gap-2">
        {STATS.map(s => (
          <button
            key={s.id}
            onClick={() => setStat(s.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              stat === s.id
                ? 'bg-[#2AFFC8] text-black'
                : 'bg-[#141414] border border-[#1E1E1E] text-gray-400 hover:text-white'
            }`}
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
            className="w-24 bg-[#141414] border border-[#1E1E1E] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 outline-none focus:border-[#2AFFC8] transition-colors"
          />
          <span className="text-xs text-gray-500">+</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Games:</span>
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                window === w
                  ? 'bg-[#2AFFC8] text-black'
                  : 'bg-[#141414] text-gray-400 hover:text-white border border-[#1E1E1E]'
              }`}
            >
              L{w}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full bg-[#141414]" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && players.length === 0 && (
        <div className="py-8 text-center text-gray-600 text-sm">
          No players match these filters
        </div>
      )}

      {/* Results */}
      {!loading && players.map((player, i) => (
        <button
          key={`${player.playerId}-${player.statId}-${i}`}
          onClick={() => navigate(`/player/${player.playerId}`, { state: { player } })}
          className="w-full flex items-center gap-4 p-4 bg-[#141414] border border-[#1E1E1E] rounded-xl hover:border-[#2AFFC8]/40 hover:bg-[#2AFFC8]/5 transition-all text-left"
        >
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-[#1E1E1E] flex items-center justify-center text-sm font-bold text-[#2AFFC8] flex-shrink-0">
            {player.playerName?.split(' ').map(n => n[0]).join('') ?? '?'}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white truncate">{player.playerName}</div>
            <div className="text-xs text-gray-500">{player.team} · {player.position}</div>
          </div>

          {/* Avg */}
          <div className="text-right flex-shrink-0">
            <div className="text-lg font-bold text-white">{player.rollingAvg.toFixed(1)}</div>
            <div className="text-xs text-gray-500">avg {statLabel(player.stat)}</div>
          </div>

          {/* Z-score badge */}
          <Badge className={`flex-shrink-0 ${zBadgeClass(player.zScore)}`}>
            {player.zScore > 0 ? '+' : ''}{player.zScore.toFixed(2)}σ
          </Badge>
        </button>
      ))}
    </div>
  )
}
