import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Flame, ArrowRight } from 'lucide-react'

const STAT_LABELS: Record<string, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM',
}

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

  if (loading) return <Skeleton className="h-44 w-full bg-[#0F0F0F] rounded-2xl" />
  if (!pick) return null

  const statLabel = STAT_LABELS[pick.stat] ?? pick.stat.toUpperCase()
  const trendPct = Math.min((pick.zScore / 3) * 100, 100)

  return (
    <button
      onClick={() => navigate(`/player/${pick.playerId}`, { state: { player: pick } })}
      className="relative w-full overflow-hidden rounded-2xl border border-mint/20 text-left group transition-all hover:border-mint/40"
      style={{ background: 'linear-gradient(135deg, #0D1F18 0%, #0A0A0A 55%, #0A0C14 100%)' }}
    >
      {/* Radial glow from the right where the number lives */}
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{ background: 'radial-gradient(ellipse 55% 90% at 88% 50%, rgba(42,255,200,0.12) 0%, transparent 70%)' }}
      />

      <div className="relative flex items-center gap-5 p-5 pr-4">
        {/* Left column */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-4">
            <Flame size={11} className="text-mint" />
            <span className="text-[10px] font-black text-mint uppercase tracking-[0.18em] font-condensed">
              Pick of the Day
            </span>
          </div>

          <h2 className="text-[26px] font-black text-white font-condensed tracking-tight leading-none mb-1 group-hover:text-mint transition-colors truncate">
            {pick.playerName}
          </h2>
          <p className="text-xs text-gray-600 mb-5">{pick.team} · {pick.position}</p>

          {/* Trend strength bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-700 font-condensed uppercase tracking-wider">Trend Strength</span>
              <span className="text-[10px] font-bold text-mint font-condensed">+{pick.zScore.toFixed(2)}σ</span>
            </div>
            <div className="h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-mint/50 to-mint transition-all duration-700"
                style={{ width: `${trendPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right column — big number */}
        <div className="flex-shrink-0 flex flex-col items-end">
          <div className="text-[76px] font-black text-mint font-display leading-none text-glow-mint tabular-nums">
            {pick.rollingAvg.toFixed(1)}
          </div>
          <div className="text-[11px] text-gray-600 mt-0.5 font-condensed tracking-wide text-right">
            L{pick.windowSize} avg {statLabel}
          </div>
        </div>

        <ArrowRight
          size={15}
          className="flex-shrink-0 text-gray-700 group-hover:text-mint group-hover:translate-x-0.5 transition-all self-center ml-1"
        />
      </div>
    </button>
  )
}
