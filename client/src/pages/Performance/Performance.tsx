import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '@/components/Sidebar/Sidebar'
import PerformanceSection from '@/components/Performance/PerformanceSection'
import StreakPerformanceCard from '@/components/Performance/StreakPerformanceCard'
import { Skeleton } from '@/components/ui/skeleton'
import { performanceApi, PerformanceSummary, BucketStats, SegmentStats, PickOutcome } from '@/services/api'
import { cn } from '@/lib/utils'

const PERIOD_OPTIONS = [
  { label: 'TODAY', days: 1   },
  { label: '7D',    days: 7   },
  { label: '30D',   days: 30  },
  { label: '90D',   days: 90  },
]

function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

function fmtEdge(v: number | null): string {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${Math.round(v * 100)}%`
}

function RecordBadge({ hits, misses, pending }: { hits: number; misses: number; pending: number }) {
  return (
    <div className="flex items-center gap-1.5 font-mono tabular-nums text-[12px]">
      <span className="text-over font-bold">{hits}W</span>
      <span className="text-gray-700">-</span>
      <span className="text-under font-bold">{misses}L</span>
      {pending > 0 && (
        <>
          <span className="text-gray-700">-</span>
          <span className="text-gray-500">{pending}P</span>
        </>
      )}
    </div>
  )
}

function SegmentCard({ label, stats }: { label: string; stats: SegmentStats }) {
  const edgeVsExpected = null // no expected rate for general segments
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border-b border-[#0F0F0F] last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-condensed">{label}</span>
        <span className={cn('text-[13px] font-black font-mono', stats.hitRate != null && stats.hitRate >= 0.6 ? 'text-over' : 'text-gray-400')}>
          {fmtPct(stats.hitRate)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <RecordBadge hits={stats.hits} misses={stats.misses} pending={stats.pending} />
        <span className="text-[10px] text-gray-700 font-condensed">{stats.total} picks</span>
      </div>
    </div>
  )
}

function BucketCard({ b }: { b: BucketStats }) {
  const edge = b.edgeVsMarket
  const hasData = b.settled > 0
  return (
    <div className="flex flex-col gap-2 p-4 border border-[#161616] rounded-xl bg-[#0A0A0A]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider font-condensed">{b.label}</span>
        <span className={cn(
          'text-[11px] font-bold font-condensed uppercase tracking-wide border px-1.5 py-0.5 rounded',
          !hasData ? 'text-gray-700 border-[#222] bg-[#111]' :
          edge != null && edge >= 0.05 ? 'text-over border-over/20 bg-over/5' :
          edge != null && edge <= -0.05 ? 'text-under border-under/20 bg-under/5' :
          'text-gray-500 border-[#222] bg-[#111]'
        )}>
          {hasData ? fmtEdge(edge) : '—'} edge
        </span>
      </div>

      <div className="text-[22px] font-black font-mono tabular-nums leading-none text-white">
        {hasData ? fmtPct(b.hitRate) : '—'}
      </div>
      <div className="text-[9px] text-gray-700 font-condensed">
        expected {fmtPct(b.expectedRate)}
      </div>

      <div className="h-px bg-[#161616] my-1" />

      <RecordBadge hits={b.hits} misses={b.misses} pending={b.pending} />
      <div className="text-[9px] text-gray-700 font-condensed">{b.total} picks total</div>
    </div>
  )
}

function OutcomeIcon({ didHit }: { didHit: boolean | null }) {
  if (didHit === null) return <span className="text-[10px] text-gray-600 font-mono">PEND</span>
  return didHit
    ? <span className="text-[11px] font-bold text-over">W</span>
    : <span className="text-[11px] font-bold text-under">L</span>
}

function PickHistoryRow({ pick }: { pick: PickOutcome }) {
  const isPlayer = pick.prop_type === 'player'
  const nameEl = isPlayer && pick.player_id ? (
    <Link
      to={`/player/${pick.player_id}`}
      className="text-[12px] font-semibold text-white hover:text-mint transition-colors font-condensed truncate"
    >
      {pick.player_name ?? '—'}
      {pick.is_potd && (
        <span className="ml-1.5 text-[8px] font-bold text-push border border-push/20 bg-push/10 px-1 py-0.5 rounded font-condensed uppercase">
          POTD
        </span>
      )}
    </Link>
  ) : (
    <span className="text-[12px] font-semibold text-white font-condensed truncate">
      {isPlayer ? (pick.player_name ?? '—') : pick.prop_type}
    </span>
  )

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-4 py-2.5 border-b border-[#0A0A0A] last:border-0 hover:bg-white/[0.01] items-center">
      <div className="min-w-0">
        {nameEl}
        <div className="text-[10px] text-gray-600 font-condensed">
          {pick.game_date}
          {pick.stat_label && ` · ${pick.stat_label}`}
          {pick.team && ` · ${pick.team}`}
        </div>
      </div>
      <span className="text-[11px] font-mono text-gray-400 tabular-nums">
        {pick.line != null ? `${pick.line}+` : '—'}
      </span>
      <span className="text-[11px] font-mono text-gray-600 tabular-nums">
        {pick.implied_prob != null ? `${Math.round(pick.implied_prob * 100)}%` : '—'}
      </span>
      <span className={cn(
        'text-[11px] font-mono tabular-nums font-bold',
        pick.edge != null && pick.edge >= 0.1 ? 'text-mint' : 'text-gray-500'
      )}>
        {pick.edge != null ? fmtEdge(pick.edge) : '—'}
      </span>
      <span className="text-[10px] font-mono text-gray-600 tabular-nums">
        {pick.actual_result != null ? pick.actual_result : '—'}
      </span>
      <OutcomeIcon didHit={pick.did_hit} />
    </div>
  )
}

type PickFilter = 'all' | 'hit' | 'miss' | 'pending'

export default function Performance() {
  const [days, setDays] = useState(1)
  const [data, setData] = useState<PerformanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [pickFilter, setPickFilter] = useState<PickFilter>('all')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = (d: number, silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    performanceApi.getSummary(d)
      .then(res => { setData(res); setLastUpdated(new Date()) })
      .catch(e => setError(e.message))
      .finally(() => { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    fetchData(days)

    // Poll every 60s on TODAY view — picks get reconciled as games finish
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (days === 1) {
      intervalRef.current = setInterval(() => fetchData(days, true), 60_000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [days])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Page header + period selector */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.2em] font-condensed">
                Performance
              </h1>
              {days === 1 && (
                <span className="flex items-center gap-1 text-[9px] text-over font-condensed uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-over animate-pulse-live" />
                  live
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-700 font-condensed mt-0.5">
              {lastUpdated
                ? `updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : data ? `${data.period.from} → ${data.period.to}` : ''}
            </p>
          </div>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[11px] font-bold font-condensed transition-colors',
                  days === opt.days
                    ? 'bg-mint text-black'
                    : 'bg-[#141414] text-gray-600 hover:text-white border border-[#222]'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-28 bg-[#0D0D0D] rounded-2xl" />
            <Skeleton className="h-48 bg-[#0D0D0D] rounded-2xl" />
            <Skeleton className="h-96 bg-[#0D0D0D] rounded-2xl" />
          </div>
        )}

        {error && (
          <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* ── Overall summary */}
            <PerformanceSection title="Overall" subtitle={`${data.overall.total} picks`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#111]">
                {[
                  { label: 'Hit Rate',   value: fmtPct(data.overall.hitRate),   sub: `${data.overall.settled} settled` },
                  { label: 'Record',     value: `${data.overall.hits}–${data.overall.misses}`, sub: `${data.overall.pending} pending` },
                  { label: 'Player Props', value: fmtPct(data.playerProps.hitRate), sub: `${data.playerProps.total} picks` },
                  { label: 'Game Props',   value: fmtPct(data.gameProps.hitRate),   sub: `${data.gameProps.total} picks` },
                ].map(item => (
                  <div key={item.label} className="flex flex-col gap-1 px-4 py-4">
                    <span className="text-[9px] font-bold text-gray-700 uppercase tracking-widest font-condensed">{item.label}</span>
                    <span className="text-[20px] font-black text-white font-mono tabular-nums leading-none">{item.value}</span>
                    <span className="text-[10px] text-gray-700 font-condensed">{item.sub}</span>
                  </div>
                ))}
              </div>
            </PerformanceSection>

            {/* ── Bucket breakdown */}
            <PerformanceSection title="By Market Bucket" subtitle="vs expected hit rate">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
                {data.buckets.map(b => <BucketCard key={b.bucket} b={b} />)}
              </div>
            </PerformanceSection>

            {/* ── Streak tier performance */}
            <StreakPerformanceCard days={days} />

            {/* ── Segments */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PerformanceSection title="Pick of the Day" subtitle="top safe pick per slate">
                <SegmentCard label="POTD Record" stats={data.potd} />
              </PerformanceSection>

              <PerformanceSection title="By Pick Type">
                {/* Placeholder for additional segments — add new SegmentCards here */}
                <SegmentCard label="Safe Picks" stats={data.playerProps} />
                <SegmentCard label="Game Props" stats={data.gameProps} />
              </PerformanceSection>
            </div>

            {/* ── Pick history */}
            {(() => {
              const FILTERS: { key: PickFilter; label: string; count: (picks: PickOutcome[]) => number }[] = [
                { key: 'all',     label: 'All',     count: ps => ps.length },
                { key: 'hit',     label: 'Hit',     count: ps => ps.filter(p => p.did_hit === true).length },
                { key: 'miss',    label: 'Miss',    count: ps => ps.filter(p => p.did_hit === false).length },
                { key: 'pending', label: 'Pending', count: ps => ps.filter(p => p.did_hit === null).length },
              ]
              const filtered = data.recentPicks.filter(p => {
                if (pickFilter === 'hit')     return p.did_hit === true
                if (pickFilter === 'miss')    return p.did_hit === false
                if (pickFilter === 'pending') return p.did_hit === null
                return true
              })
              return (
                <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
                  {/* Header row with tabs */}
                  <div className="flex items-center border-b border-[#111]">
                    <span className="px-4 text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed shrink-0">
                      Pick History
                    </span>
                    <div className="flex ml-2">
                      {FILTERS.map(f => {
                        const count = f.count(data.recentPicks)
                        const isActive = pickFilter === f.key
                        return (
                          <button
                            key={f.key}
                            onClick={() => setPickFilter(f.key)}
                            className={cn(
                              'flex items-center gap-1.5 px-3 py-3.5 text-[10px] font-bold font-condensed uppercase tracking-wide relative transition-colors',
                              isActive ? 'text-white' : 'text-gray-600 hover:text-gray-400'
                            )}
                          >
                            <span className={cn(
                              f.key === 'hit' ? 'text-over' :
                              f.key === 'miss' ? 'text-under' :
                              f.key === 'pending' ? 'text-gray-500' : '',
                              !isActive && 'opacity-60'
                            )}>
                              {f.label}
                            </span>
                            <span className="text-gray-700 text-[9px] font-mono">{count}</span>
                            {isActive && (
                              <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex-1 flex justify-end pr-4">
                      <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest">most recent first</span>
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
                      No picks in this period
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-4 py-2 border-b border-[#111]">
                        {['Player / Prop', 'Line', 'Mkt', 'Edge', 'Result', ''].map(h => (
                          <span key={h} className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed">{h}</span>
                        ))}
                      </div>
                      {filtered.map(p => <PickHistoryRow key={p.id} pick={p} />)}
                    </>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </main>
    </div>
  )
}
