import { useEffect, useState } from 'react'
import { nbaApi, PlayerStreakRow } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type StatKey = 'pts' | 'reb' | 'ast' | 'fg3m'
type WindowKey = 3 | 5 | 10

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'pts',  label: 'PTS' },
  { key: 'reb',  label: 'REB' },
  { key: 'ast',  label: 'AST' },
  { key: 'fg3m', label: '3PM' },
]
const WINDOW_TABS: WindowKey[] = [3, 5, 10]

export default function StreaksCard() {
  const [stat, setStat] = useState<StatKey>('pts')
  const [window, setWindow] = useState<WindowKey>(5)
  const [rows, setRows] = useState<PlayerStreakRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    nbaApi.getPlayerStreaks(stat, window)
      .then(res => setRows(res.rows.slice(0, 10)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [stat, window])

  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-[#111]">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Streaks</span>
      </div>

      {/* Stat tabs */}
      <div className="flex border-b border-[#111]">
        {STAT_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setStat(t.key)}
            className={cn(
              'flex-1 py-2.5 text-[11px] font-bold font-condensed tracking-wide uppercase transition-colors relative',
              stat === t.key ? 'text-white' : 'text-gray-600 hover:text-gray-400'
            )}
          >
            {t.label}
            {stat === t.key && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />}
          </button>
        ))}
      </div>

      {/* Window tabs */}
      <div className="flex gap-1 px-4 py-2.5 border-b border-[#111]">
        <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest self-center mr-1">Last</span>
        {WINDOW_TABS.map(w => (
          <button
            key={w}
            onClick={() => setWindow(w)}
            className={cn(
              'w-9 h-7 rounded-lg text-[11px] font-bold font-mono transition-colors',
              window === w
                ? 'bg-mint text-black'
                : 'bg-[#141414] text-gray-600 hover:text-white border border-[#222]'
            )}
          >
            {w}
          </button>
        ))}
      </div>

      {loading && (
        <div className="p-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 bg-[#141414] rounded" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">No streaks found</div>
      )}

      {!loading && rows.map((row, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10px] text-gray-700 font-mono w-4 flex-shrink-0">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white font-condensed truncate">{row.player_name}</div>
              <div className="text-[10px] text-gray-600 font-condensed">{row.team}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <span className="text-[11px] text-gray-500 font-mono">{row.rolling_avg.toFixed(1)} avg</span>
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-black text-mint font-mono">{row.streak_count}</span>
              <span className="text-[9px] text-gray-600 font-condensed uppercase">streak</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
