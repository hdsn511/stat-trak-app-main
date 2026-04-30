import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nbaApi, PlayerStreakRow } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type StatKey = 'pts' | 'reb' | 'ast' | 'fg3m'

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'pts',  label: 'PTS' },
  { key: 'reb',  label: 'REB' },
  { key: 'ast',  label: 'AST' },
  { key: 'fg3m', label: '3PM' },
]

function fmtLine(v: number): string {
  return String(Math.round(v))
}

function MatchupChip({ rank }: { rank: number | null }) {
  if (rank == null) return null
  if (rank <= 10) {
    return (
      <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold font-condensed uppercase tracking-wide border bg-under/10 text-under border-under/20">
        TOUGH DEF | RANK {rank}
      </span>
    )
  }
  if (rank >= 21) {
    return (
      <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold font-condensed uppercase tracking-wide border bg-over/10 text-over border-over/20">
        WEAK DEF
      </span>
    )
  }
  return null
}

const COL_W = 'w-14'

export default function StreaksCard() {
  const [stat, setStat] = useState<StatKey>('pts')
  const [rows, setRows] = useState<PlayerStreakRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    nbaApi.getPlayerStreaks(stat)
      .then(res => setRows(res.rows.slice(0, 10)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [stat])

  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[#111]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">
            Streaks
          </span>
          <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest">
            Last 10 games
          </span>
        </div>
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
            {stat === t.key && (
              <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Column headers */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center px-4 py-2 border-b border-[#111]">
          <div className="flex-1 min-w-0" />
          <div className="flex flex-shrink-0 ml-3">
            <span className={cn('text-[9px] font-bold text-over/70 font-condensed uppercase tracking-widest text-right', COL_W)}>
              100%
            </span>
            <span className={cn('text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest text-right', COL_W)}>
              90%
            </span>
            <span className={cn('text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest text-right', COL_W)}>
              80%
            </span>
            <span className={cn('text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest text-right', COL_W)}>
              70%
            </span>
          </div>
        </div>
      )}

      {loading && (
        <div className="p-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[60px] bg-[#141414] rounded" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
          No streaks found
        </div>
      )}

      {!loading && rows.map((row, i) => (
        <Link
          key={row.player_id}
          to={`/player/${row.player_id}`}
          className="flex items-center px-4 py-3 border-b border-[#0F0F0F] last:border-0 hover:bg-white/[0.03] transition-colors group"
        >
          {/* Left: rank + player + opponent */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-[10px] text-gray-700 font-mono w-4 flex-shrink-0 group-hover:text-mint transition-colors">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white font-condensed truncate group-hover:text-mint transition-colors">
                {row.player_name}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-gray-600 font-condensed">
                  {row.team}
                  {row.opponent ? (
                    <> vs <span className="text-gray-500">{row.opponent.team}</span></>
                  ) : ''}
                </span>
                <MatchupChip rank={row.opponent?.league_rank ?? null} />
              </div>
            </div>
          </div>

          {/* Right: tier numbers aligned to column headers */}
          <div className="flex flex-shrink-0 ml-3">
            <span className={cn('text-[15px] font-black text-over font-mono tabular-nums text-right leading-none', COL_W)}>
              {fmtLine(row.line_100)}+
            </span>
            <span className={cn('text-[15px] font-bold text-white font-mono tabular-nums text-right leading-none', COL_W)}>
              {fmtLine(row.line_90)}+
            </span>
            <span className={cn('text-[15px] font-bold text-white/50 font-mono tabular-nums text-right leading-none', COL_W)}>
              {fmtLine(row.line_80)}+
            </span>
            <span className={cn('text-[15px] font-bold text-white/30 font-mono tabular-nums text-right leading-none', COL_W)}>
              {fmtLine(row.line_70)}+
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
