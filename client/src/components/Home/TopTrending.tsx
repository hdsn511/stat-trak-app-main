// client/src/components/Home/TopTrending.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp } from 'lucide-react'

export default function TopTrending() {
  const navigate = useNavigate()
  const [players, setPlayers] = useState<TrendingPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTopTrending()
      .then(data => setPlayers(data.slice(1, 10))) // skip #1 (used in PickOfTheDay)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-mint" />
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Top Trending</h2>
      </div>
      {loading && (
        <div className="space-y-2">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-14 w-full bg-surface" />)}
        </div>
      )}
      {!loading && players.map((player, i) => (
        <button
          key={`${player.playerId}-${player.statId}`}
          onClick={() => navigate(`/player/${player.playerId}`, { state: { player } })}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface border-b border-[#1E1E1E] last:border-0 transition-colors text-left group"
        >
          <span className="text-xs font-bold text-gray-600 w-5">#{i + 2}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white group-hover:text-mint transition-colors truncate">{player.playerName}</div>
            <div className="text-xs text-gray-500">{player.team} · {player.stat}</div>
          </div>
          <div className="text-right">
            <span className="text-sm font-bold text-mint">{player.rollingAvg.toFixed(1)}</span>
            <span className="text-xs text-gray-600 ml-1">avg</span>
          </div>
          <span className="text-xs text-gray-500 w-14 text-right">+{player.zScore.toFixed(2)}σ</span>
        </button>
      ))}
    </div>
  )
}
