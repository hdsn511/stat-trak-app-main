import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { TopPickPlayer, TopPickGame, TopPicksResponse } from '@/services/api'
import { playerPath } from '@/lib/playerPath'
import { formatSpreadLine } from '@/lib/formatSpread'

type PropTab = 'player' | 'winner' | 'spread' | 'total'
type BucketTab = 50 | 60 | 70 | 80

const BUCKET_TABS: BucketTab[] = [50, 60, 70, 80]
const PROP_TABS: { key: PropTab; label: string }[] = [
  { key: 'player', label: 'Player Props' },
  { key: 'winner', label: 'Moneyline' },
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
  /** League slug, used to route player rows to the right detail view. */
  slug?: string
}

export default function PropsTable({ picks, slug }: PropsTableProps) {
  const [propTab, setPropTab] = useState<PropTab>('player')
  const [bucket, setBucket] = useState<BucketTab>(70)

  // Auto-select the bucket holding the MOST picks (ties → higher bucket), so a
  // sparse slate's picks aren't hidden behind an empty default tab.
  useEffect(() => {
    if (!picks?.player?.length) return
    let best: BucketTab = 70, bestCount = -1
    for (const b of [80, 70, 60, 50] as BucketTab[]) {
      const c = picks.player.filter(p => inBucket(p.implied_prob, b)).length
      if (c > bestCount) { bestCount = c; best = b }
    }
    setBucket(best)
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

  // Game props (spread/total) are value bets that often sit below the 50% market
  // bucket (e.g. an underpriced over) — show all of them ranked by edge rather
  // than bucket-filtering, which is meant for player props.
  const gameByType = (t: TopPickGame['prop_type']): TopPickGame[] =>
    (picks?.game ?? []).filter(g => g.prop_type === t).sort((a, b) => b.edge - a.edge).slice(0, 10)
  const winnerRows = gameByType('winner')
  const spreadRows = gameByType('spread')
  const totalRows = gameByType('total')

  const isEmpty =
    propTab === 'player' ? playerRows.length === 0 :
    propTab === 'winner' ? winnerRows.length === 0 :
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

      {/* Market-% buckets apply only to player props (game props aren't
          bucket-filtered) — hide them on the ML / Spread / Total tabs. */}
      {propTab === 'player' && (
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
      )}

      {/* Table */}
      {isEmpty ? (
        <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
          {propTab === 'player'
            ? `No props in the ${bucket}–${bucket + 9}% range today`
            : `No ${PROP_TABS.find(t => t.key === propTab)?.label.toLowerCase()} picks today`}
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
                to={playerPath(slug, p.player_id)}
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
            : (propTab === 'winner' ? winnerRows : propTab === 'spread' ? spreadRows : totalRows).map((g, i) => {
              const label = propTab === 'winner' ? 'Moneyline' : propTab === 'spread' ? 'Spread' : 'Total'
              const lineDisplay =
                propTab === 'winner' ? (g.spread_team ? `${g.spread_team} ML` : 'ML')
                : propTab === 'spread' && g.spread_team && g.line != null ? formatSpreadLine(g.spread_team, g.line)
                : g.line ?? '—'
              return (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
                <div>
                  <div className="text-[12px] font-semibold text-white font-condensed truncate">{g.away_team} @ {g.home_team}</div>
                  <div className="text-[10px] text-gray-600 font-condensed">{label}</div>
                </div>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{lineDisplay}</span>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{g.implied_prob != null ? Math.round(g.implied_prob * 100) + '%' : '—'}</span>
                <span className="text-[12px] font-mono font-bold text-gray-300 self-center">{Math.round(g.hit_rate * 100)}%</span>
                <span className={cn('text-[12px] font-mono font-bold self-center', g.edge >= 0.1 ? 'text-mint' : 'text-gray-500')}>
                  +{Math.round(g.edge * 100)}%
                </span>
              </div>
              )
            })
          }
        </div>
      )}
    </div>
  )
}
