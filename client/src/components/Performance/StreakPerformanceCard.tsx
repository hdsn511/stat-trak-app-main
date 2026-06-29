import { useEffect, useState } from 'react'
import { performanceApi, PerformanceApi, StreakTierStats } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import PerformanceSection from './PerformanceSection'

const NBA_STATS = ['pts', 'reb', 'ast', 'fg3m']

function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

const EXPECTED: Record<string, number> = {
  '10/10': 0.9,
  '9/10':  0.8,
  '8/10':  0.7,
  '7/10':  0.6,
}

function TierCard({ t }: { t: StreakTierStats }) {
  const is10 = t.tier === '10/10'
  const hasData = t.total > 0
  const expected = EXPECTED[t.tier] ?? 0
  const beating = t.hitRate != null && t.hitRate >= expected
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
        !hasData ? 'text-gray-700' : beating ? 'text-over' : 'text-under'
      )}>
        {hasData ? fmtPct(t.hitRate) : '—'}
      </div>

      <div className="text-[9px] text-gray-700 font-condensed">
        expected {fmtPct(expected)}
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

function mergeTiers(allResults: StreakTierStats[][]): StreakTierStats[] {
  const map = new Map<string, StreakTierStats>()
  for (const rows of allResults) {
    for (const t of rows) {
      const existing = map.get(t.tier)
      if (!existing) {
        map.set(t.tier, { ...t })
      } else {
        existing.hits   += t.hits
        existing.misses += t.misses
        existing.total  += t.total
        existing.hitRate = existing.total > 0 ? existing.hits / existing.total : null
      }
    }
  }
  const ORDER = ['10/10', '9/10', '8/10', '7/10']
  return ORDER.map(k => map.get(k) ?? { tier: k as StreakTierStats['tier'], hits: 0, misses: 0, total: 0, hitRate: null })
}

export default function StreakPerformanceCard({
  days,
  bare = false,
  api = performanceApi,
  stats = NBA_STATS,
}: {
  days: number
  bare?: boolean
  api?: PerformanceApi
  stats?: string[]
}) {
  const [tiers, setTiers] = useState<StreakTierStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all(stats.map(s => api.getStreakPerformance(days, s).then(r => r.tiers)))
      .then(results => setTiers(mergeTiers(results)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [days, api, stats])

  const inner = (
    <>
      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-28 bg-[#141414] rounded-xl" />)}
        </div>
      )}
      {error && (
        <div className="px-4 py-6 text-center text-[11px] text-gray-700 font-condensed">{error}</div>
      )}
      {!loading && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {tiers.map(t => <TierCard key={t.tier} t={t} />)}
        </div>
      )}
    </>
  )

  if (bare) return inner
  return (
    <PerformanceSection title="Streak Tiers" subtitle="all stats · next-game continuation rate">
      {inner}
    </PerformanceSection>
  )
}
