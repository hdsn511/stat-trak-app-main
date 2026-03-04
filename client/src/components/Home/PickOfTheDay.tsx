// client/src/components/Home/PickOfTheDay.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Flame } from 'lucide-react'

export default function PickOfTheDay() {
  const navigate = useNavigate()
  const [pick, setPick] = useState<TrendingPlayer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTopTrending()
      .then(players => setPick(players[0] ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Skeleton className="h-40 w-full bg-surface rounded-2xl" />
  if (!pick) return null

  return (
    <button
      onClick={() => navigate(`/player/${pick.playerId}`, { state: { player: pick } })}
      className="w-full p-6 bg-gradient-to-r from-mint/10 to-transparent border border-mint/20 rounded-2xl hover:border-mint/40 transition-all text-left group"
    >
      <div className="flex items-center gap-2 mb-3">
        <Flame size={14} className="text-mint" />
        <span className="text-xs font-semibold text-mint uppercase tracking-wider">Pick of the Day</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white group-hover:text-mint transition-colors">{pick.playerName}</h2>
          <p className="text-sm text-gray-400 mt-0.5">{pick.team} · {pick.position}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-mint">{pick.rollingAvg.toFixed(1)}</div>
          <div className="text-xs text-gray-500 mt-0.5">L{pick.windowSize} avg {pick.stat}</div>
          <Badge className="mt-1 bg-mint/10 text-mint border-mint/20">+{pick.zScore.toFixed(2)}σ</Badge>
        </div>
      </div>
    </button>
  )
}
