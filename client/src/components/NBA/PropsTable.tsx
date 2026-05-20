import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { TopPickPlayer, TopPickGame, TopPicksResponse } from '@/services/api'

type PropTab = 'player' | 'spread' | 'total'
type BucketTab = 50 | 60 | 70 | 80

const BUCKET_TABS: BucketTab[] = [50, 60, 70, 80]
const PROP_TABS: { key: PropTab; label: string }[] = [
  { key: 'player', label: 'Player Props' },
  { key: 'spread', label: 'Spread' },
  { key: 'total',  label: 'Total' },
]

function inBucket(prob: number, bucket: BucketTab): boolean {
  const pct = Math.round(prob * 100)
  // 50% bucket accepts 47–59 (near-50/50 props round into this group)
  const lo = bucket === 50 ? 47 : bucket
  return pct >= lo && pct < bucket + 10
}

interface PropsTableProps {
  picks: TopPicksResponse | null
}

export default function PropsTable({ picks }: PropsTableProps) {
  const [propTab, setPropTab] = useState<PropTab>('player')
  const [bucket, setBucket] = useState<BucketTab>(70)

  // Auto-select the first bucket that has picks when data loads
  useEffect(() => {
    if (!picks?.player?.length) return
    const probs = picks.player.map(p => p.implied_prob)
    for (const b of [70, 80, 60, 50] as BucketTab[]) {
      if (probs.some(prob => inBucket(prob, b))) { setBucket(b); return }
    }
  }, [picks])

  // Count picks per bucket for tab labels
  const bucketCounts: Record<BucketTab, number> = { 50: 0, 60: 0, 70: 0, 80: 0 }
  for (const b of BUCKET_TABS) {
    bucketCounts[b] = (picks?.player ?? []).filter(p => inBucket(p.implied_prob, b)).length
  }

  const playerRows: TopPickPlayer[] = (picks?.player ?? [])
    .filter(p => inBucket(p.implied_prob, bucket))
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 20)

  const spreadRows: TopPickGame[] = (picks?.game ?? [])
    .filter(g => g.prop_type === 'spread' && g.implied_prob != null && inBucket(g.implied_prob!, bucket))
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 5)

  const totalRows: TopPickGame[] = (picks?.game ?? [])
    .filter(g => g.prop_type === 'total' && g.implied_prob != null && inBucket(g.implied_prob!, bucket))
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 5)

  const isEmpty =
    propTab === 'player' ? playerRows.length === 0 :
    propTab === 'spread' ? spreadRows.length === 0 :
    totalRows.length === 0

  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[#111]">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Props</span>
      </div>

      {/* Prop type tabs */}
      <div className="flex border-b border-[#111]">
        {PROP_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setPropTab(t.key)}
            className={cn(
              'px-4 py-2.5 text-[11px] font-bold font-condensed tracking-wide uppercase transition-colors relative',
              propTab === t.key ? 'text-white' : 'text-gray-600 hover:text-gray-400'
            )}
          >
            {t.label}
            {propTab === t.key && (
              <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Bucket tabs */}
      <div className="flex gap-1 px-4 py-2.5 border-b border-[#111]">
        <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest self-center mr-1">Mkt %</span>
        {BUCKET_TABS.map(b => (
          <button
            key={b}
            onClick={() => setBucket(b)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition-colors flex items-center gap-1',
              bucket === b
                ? 'bg-mint text-black'
                : 'bg-[#141414] text-gray-600 hover:text-white border border-[#222]'
            )}
          >
            {b}
            {bucketCounts[b] > 0 && (
              <span className={cn(
                'text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none',
                bucket === b ? 'bg-black/20 text-black' : 'bg-[#222] text-gray-500'
              )}>
                {bucketCounts[b]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {isEmpty ? (
        <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
          {`No props in the ${bucket}–${bucket + 9}% range today`}
        </div>
      ) : (
        <div>
          {/* Header row */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 border-b border-[#111]">
            {['Player / Game', 'Line', 'Mkt %', 'Model %', 'Edge'].map(h => (
              <span key={h} className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed">{h}</span>
            ))}
          </div>
          {propTab === 'player'
            ? playerRows.map((p, i) => (
              <Link
                key={i}
                to={`/player/${p.player_id}`}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.03] transition-colors group"
              >
                <div>
                  <div className="text-[12px] font-semibold text-white font-condensed truncate group-hover:text-mint transition-colors">{p.player_name}</div>
                  <div className="text-[10px] text-gray-600 font-condensed">{p.team} · {p.stat_label}</div>
                </div>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{p.line}</span>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{Math.round(p.implied_prob * 100)}%</span>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{Math.round(p.hit_rate * 100)}%</span>
                <span className={cn('text-[12px] font-mono font-bold self-center', p.edge >= 0.1 ? 'text-mint' : 'text-gray-500')}>
                  +{Math.round(p.edge * 100)}%
                </span>
              </Link>
            ))
            : (propTab === 'spread' ? spreadRows : totalRows).map((g, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
                <div>
                  <div className="text-[12px] font-semibold text-white font-condensed truncate">{g.away_team} @ {g.home_team}</div>
                  <div className="text-[10px] text-gray-600 font-condensed">{propTab === 'spread' ? 'Spread' : 'Total'}</div>
                </div>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">
                  {propTab === 'spread' && g.spread_team && g.line != null
                    ? `${g.spread_team} -${g.line}`
                    : g.line ?? '—'}
                </span>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{g.implied_prob != null ? Math.round(g.implied_prob * 100) + '%' : '—'}</span>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{Math.round(g.hit_rate * 100)}%</span>
                <span className={cn('text-[12px] font-mono font-bold self-center', g.edge >= 0.1 ? 'text-mint' : 'text-gray-500')}>
                  +{Math.round(g.edge * 100)}%
                </span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}
