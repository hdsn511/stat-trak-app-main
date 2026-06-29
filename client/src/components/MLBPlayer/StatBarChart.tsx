import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export interface ChartBar {
  value: number
  opponent?: string
  date?: string
  gameId?: number
  isHome?: boolean
}

interface StatBarChartProps {
  /** Bars in display order (oldest → newest, left → right). */
  bars: ChartBar[]
  threshold: number
  statLabel: string
  onBarClick?: (gameId: number) => void
}

/**
 * The hero of the MLB player view: a game-by-game bar chart with an over/under
 * threshold line. Bars clearing the line read green (the bet hit), bars under
 * read red. Value labels sit above every bar so exact figures never need a
 * hover (baseball counting stats are small integers). Each bar is keyboard
 * focusable and links to its box score.
 */
export default function StatBarChart({ bars, threshold, statLabel, onBarClick }: StatBarChartProps) {
  const maxVal = useMemo(
    () => Math.max(...bars.map(b => b.value), threshold, 1),
    [bars, threshold]
  )

  const hitRate = useMemo(() => {
    if (!bars.length) return 0
    const hits = bars.filter(b => b.value >= threshold).length
    return Math.round((hits / bars.length) * 100)
  }, [bars, threshold])

  if (!bars.length) {
    return (
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-8 text-center">
        <div className="text-[13px] text-gray-600 font-condensed">No games in this filter</div>
        <div className="text-[11px] text-gray-700 font-condensed mt-1">Try a wider window or clear the venue filter</div>
      </div>
    )
  }

  const thresholdPct = (threshold / maxVal) * 100
  const summary = `${statLabel} over last ${bars.length} games. ${hitRate}% cleared the ${threshold} line.`

  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-4 sm:p-5">
      {/* Chart area with threshold line */}
      <div className="relative h-52 sm:h-60 mb-1" role="img" aria-label={summary}>
        {/* Threshold line */}
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{ bottom: `${Math.min(thresholdPct, 96)}%` }}
        >
          <div className="border-t border-dashed border-mint/40 relative">
            <span className="absolute -top-3.5 right-0 text-[9px] text-mint/70 font-condensed font-bold bg-[#0D0D0D] px-1">
              {threshold}
            </span>
          </div>
        </div>

        {/* Bars */}
        <div className="absolute inset-0 flex items-end gap-1 sm:gap-1.5">
          {bars.map((bar, i) => {
            const pct = (bar.value / maxVal) * 100
            const isOver = bar.value >= threshold
            const hasGame = bar.gameId != null
            const label = `${bar.opponent ? (bar.isHome ? 'vs ' : '@ ') + bar.opponent : `game ${i + 1}`}: ${bar.value} ${statLabel}, ${isOver ? 'over' : 'under'} ${threshold}`
            return (
              <button
                key={i}
                type="button"
                disabled={!hasGame}
                onClick={() => hasGame && onBarClick?.(bar.gameId!)}
                aria-label={label}
                className={cn(
                  'flex-1 h-full flex flex-col justify-end items-stretch group relative rounded-sm',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint/60',
                  hasGame ? 'cursor-pointer' : 'cursor-default'
                )}
              >
                {/* Value label */}
                <span
                  className={cn(
                    'text-[9px] sm:text-[10px] font-mono font-bold tabular-nums text-center mb-0.5 leading-none',
                    isOver ? 'text-mint/90' : 'text-gray-500'
                  )}
                >
                  {bar.value}
                </span>
                <div
                  className={cn(
                    'w-full rounded-t animate-bar-grow motion-reduce:animate-none transition-colors',
                    isOver
                      ? 'bg-green-500/80 group-hover:bg-green-500'
                      : 'bg-red-500/70 group-hover:bg-red-500'
                  )}
                  style={{
                    height: `${Math.max(pct, 2)}%`,
                    animationDelay: `${i * 22}ms`,
                  }}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* Game labels */}
      <div className="flex gap-1 sm:gap-1.5 mb-3">
        {bars.map((bar, i) => (
          <div key={i} className="flex-1 text-center min-w-0">
            <div className="text-[8px] sm:text-[9px] text-gray-600 font-condensed font-bold truncate">
              {bar.opponent ? `${bar.isHome ? '' : '@'}${bar.opponent}` : `G${i + 1}`}
            </div>
            {bar.date && (
              <div className="text-[7px] sm:text-[8px] text-gray-800 font-condensed truncate">
                {new Date(bar.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 pt-2 border-t border-[#141414]">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-green-500/80" />
          <span className="text-[10px] text-gray-600 font-condensed">Cleared {threshold}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-red-500/70" />
          <span className="text-[10px] text-gray-600 font-condensed">Under</span>
        </div>
        <Badge className="ml-auto bg-mint/10 text-mint border-mint/20 font-mono font-bold text-[11px] tabular-nums">
          {hitRate}% hit rate
        </Badge>
      </div>
    </div>
  )
}
