import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp } from 'lucide-react'

const STAT_LABELS: Record<string, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM',
}

export default function TopTrending() {
  const navigate = useNavigate()
  const [players, setPlayers] = useState<TrendingPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTopTrending()
      .then(data => setPlayers(data.slice(1, 10)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const maxZ = players.length ? Math.max(...players.map(p => p.zScore), 1) : 3

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={13} className="text-mint" />
        <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-[0.2em] font-condensed">Top Trending</h2>
      </div>

      {loading && (
        <div className="space-y-1.5">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-12 w-full bg-[#0D0D0D]" />)}
        </div>
      )}

      {!loading && players.map((player, i) => (
        <button
          key={`${player.playerId}-${player.statId}`}
          onClick={() => navigate(`/player/${player.playerId}`, { state: { player } })}
          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#0F0F0F] border-b border-[#111] last:border-0 transition-colors text-left group rounded-lg"
        >
          {/* Rank */}
          <span className="text-[11px] font-black text-gray-800 font-condensed w-5 shrink-0 group-hover:text-mint transition-colors tabular-nums">
            {i + 2}
          </span>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-gray-400 group-hover:text-white transition-colors truncate leading-tight">
              {player.playerName}
            </div>
            <div className="text-[10px] text-gray-700 font-condensed tracking-wide mt-0.5">
              {player.team} · {STAT_LABELS[player.stat] ?? player.stat.toUpperCase()}
            </div>
          </div>

          {/* Z-bar + avg */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-14 h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
              <div
                className="h-full bg-mint/50 group-hover:bg-mint/80 rounded-full transition-all duration-300"
                style={{ width: `${Math.min((player.zScore / maxZ) * 100, 100)}%` }}
              />
            </div>
            <span className="text-[13px] font-black text-mint font-condensed w-10 text-right tabular-nums">
              {player.rollingAvg.toFixed(1)}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}
