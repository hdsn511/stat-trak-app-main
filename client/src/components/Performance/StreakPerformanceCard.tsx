import { useEffect, useState } from 'react'
import { performanceApi, StreakTierStats, StreakPerformanceSummary } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import PerformanceSection from './PerformanceSection'

type StatKey = 'pts' | 'reb' | 'ast' | 'fg3m'

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'pts',  label: 'PTS' },
  { key: 'reb',  label: 'REB' },
  { key: 'ast',  label: 'AST' },
  { key: 'fg3m', label: '3PM' },
]

function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

function TierCard({ t }: { t: StreakTierStats }) {
  const is10 = t.tier === '10/10'
  const hasData = t.total > 0
  return (
    <div className="flex flex-col gap-2 p-4 border border-[#161616] rounded-xl bg-[#0A0A0A]">
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-[10px] font-bold uppercase tracking-wider font-condensed',
          is10 ? 'text-over' : 'text-mint'
        )}>
          {t.tier}
        </span>
        <span className="text-[10px] text-gray-700 font-condensed">{t.total} games</span>
      </div>

      <div className={cn(
        'text-[22px] font-black font-mono tabular-nums leading-none',
        !hasData ? 'text-gray-700' : is10 ? 'text-over' : 'text-mint'
      )}>
        {hasData ? fmtPct(t.hitRate) : '—'}
      </div>

      <div className="text-[9px] text-gray-700 font-condensed">
        expected {is10 ? '~90%' : t.tier === '9/10' ? '~80%' : t.tier === '8/10' ? '~70%' : '~60%'}
      </div>

      <div className="h-px bg-[#161616] my-0.5" />

      <div className="flex items-center gap-1.5 font-mono tabular-nums text-[12px]">
        <span className="text-over font-bold">{t.hits}W</span>
        <span className="text-gray-700">-</span>
        <span className="text-under font-bold">{t.misses}L</span>
      </div>
    </div>
  )
}

export default function StreakPerformanceCard({ days, bare = false }: { days: number; bare?: boolean }) {
  const [stat, setStat] = useState<StatKey>('pts')
  const [data, setData] = useState<StreakPerformanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    performanceApi.getStreakPerformance(days, stat)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [days, stat])

  const inner = (
    <>
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

      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-28 bg-[#141414] rounded-xl" />)}
        </div>
      )}

      {error && (
        <div className="px-4 py-6 text-center text-[11px] text-gray-700 font-condensed">{error}</div>
      )}

      {!loading && !error && data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {data.tiers.map(tier => <TierCard key={tier.tier} t={tier} />)}
        </div>
      )}
    </>
  )

  if (bare) return inner
  return (
    <PerformanceSection title="Streak Tiers" subtitle="next-game continuation rate">
      {inner}
    </PerformanceSection>
  )
}
