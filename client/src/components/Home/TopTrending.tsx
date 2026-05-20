import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nbaApi, TrendingPlayer } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp } from 'lucide-react'

const STAT_LABELS: Record<string, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM',
}

const DRIVER_STYLES: Record<string, string> = {
  'USG ↑':      'bg-mint/10 text-mint border-mint/25',
  'MIN ↑':      'bg-blue-500/10 text-blue-300 border-blue-500/20',
  'FAST PACE':  'bg-purple-500/10 text-purple-300 border-purple-500/20',
  'INJURY BOOST': 'bg-yellow-500/10 text-yellow-300 border-yellow-500/25',
}

function DriverChip({ label }: { label: string }) {
  const style = DRIVER_STYLES[label] ?? 'bg-[#161616] text-gray-400 border-[#222]'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold font-condensed uppercase tracking-wider border ${style}`}
    >
      {label}
    </span>
  )
}

export default function TopTrending() {
  const [players, setPlayers] = useState<TrendingPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTopTrending()
      .then(data => setPlayers(data.slice(0, 10)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={13} className="text-mint" />
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">
            Top Trending
          </h2>
        </div>
        <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest">
          Last 10 games
        </span>
      </div>

      {loading && (
        <div className="space-y-1.5">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-[72px] w-full bg-[#0D0D0D]" />)}
        </div>
      )}

      {!loading && players.length === 0 && (
        <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
          No trending players
        </div>
      )}

      <div className="space-y-1">
        {!loading && players.map((player, i) => {
          const z = player.zScore
          const rolling = player.rollingAvg
          const season = player.seasonAvg
          const drivers = player.trendDrivers ?? []
          const statLabel = STAT_LABELS[player.stat] ?? player.stat.toUpperCase()

          return (
            <Link
              key={`${player.playerId}-${player.statId}`}
              to={`/player/${player.playerId}`}
              state={{ player }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-[#1E1E1E] hover:bg-[#0F0F0F] transition-colors group min-h-[72px]"
            >
              {/* Rank */}
              <span className="text-[11px] font-black text-gray-800 font-mono w-5 shrink-0 group-hover:text-mint transition-colors tabular-nums">
                {i + 1}
              </span>

              {/* Name + meta + drivers */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[13px] font-semibold text-gray-300 group-hover:text-white transition-colors truncate leading-tight">
                    {player.playerName}
                  </span>
                  <span className="text-[10px] text-gray-700 font-condensed tracking-wide shrink-0">
                    {player.team} · {statLabel}
                  </span>
                </div>

                {/* Stat line: season avg → L10 as a prop-line pill */}
                <div className="flex items-center gap-2 mt-1">
                  {season != null && (
                    <span className="text-[10px] text-gray-600 font-mono tabular-nums">
                      {season.toFixed(1)} avg
                    </span>
                  )}
                  {season != null && (
                    <span className="text-gray-800 text-[9px]">→</span>
                  )}
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-mint/20 bg-mint/5 text-[11px] font-bold text-mint font-mono tabular-nums">
                    {rolling.toFixed(1)}+ <span className="text-[9px] font-condensed text-mint/60 ml-1 uppercase tracking-wide">L10</span>
                  </span>
                </div>

                {/* Driver chips */}
                {drivers.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {drivers.map((d) => <DriverChip key={d} label={d} />)}
                  </div>
                )}
              </div>

              {/* Z-score badge */}
              <div className="shrink-0 flex flex-col items-end">
                <span
                  className={`text-[15px] font-black font-mono tabular-nums leading-none ${
                    z > 0 ? 'text-mint' : 'text-gray-500'
                  }`}
                >
                  {z > 0 ? '+' : ''}{z.toFixed(2)}
                </span>
                <span className="text-[8px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">
                  z-score
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
