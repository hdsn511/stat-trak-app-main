import { useState } from 'react'
import { cn } from '@/lib/utils'
import { TopPickPlayer, TopPickGame, TopPicksResponse } from '@/services/api'

type PropTab = 'player' | 'spread' | 'total'
type BucketTab = 50 | 60 | 70 | 80 | 90

const BUCKET_TABS: BucketTab[] = [50, 60, 70, 80, 90]
const PROP_TABS: { key: PropTab; label: string }[] = [
  { key: 'player', label: 'Player Props' },
  { key: 'spread', label: 'Spread' },
  { key: 'total',  label: 'Total' },
]

function inBucket(prob: number, bucket: BucketTab): boolean {
  // 90 bucket captures 90%+ instead of 90-99 only
  if (bucket === 90) return prob >= 0.9
  return prob >= bucket / 100 && prob < (bucket + 10) / 100
}

interface PropsTableProps {
  picks: TopPicksResponse | null
}

export default function PropsTable({ picks }: PropsTableProps) {
  const [propTab, setPropTab] = useState<PropTab>('player')
  const [bucket, setBucket] = useState<BucketTab>(50)

  const playerRows: TopPickPlayer[] = (picks?.player ?? [])
    .filter(p => inBucket(p.implied_prob, bucket))
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 10)

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
              'px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition-colors',
              bucket === b
                ? 'bg-mint text-black'
                : 'bg-[#141414] text-gray-600 hover:text-white border border-[#222]'
            )}
          >
            {b}
          </button>
        ))}
      </div>

      {/* Table */}
      {isEmpty ? (
        <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
          {bucket === 90
            ? 'No props at 90%+ today'
            : `No props in the ${bucket}–${bucket + 9}% range today`}
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
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
                <div>
                  <div className="text-[12px] font-semibold text-white font-condensed truncate">{p.player_name}</div>
                  <div className="text-[10px] text-gray-600 font-condensed">{p.team} · {p.stat_label}</div>
                </div>
                <span className="text-[12px] font-mono text-gray-300 self-center">{p.line}</span>
                <span className="text-[12px] font-mono text-gray-400 self-center">{Math.round(p.implied_prob * 100)}%</span>
                <span className="text-[12px] font-mono text-gray-300 self-center">{Math.round(p.hit_rate * 100)}%</span>
                <span className={cn('text-[12px] font-mono font-bold self-center', p.edge >= 0.1 ? 'text-mint' : 'text-gray-500')}>
                  +{Math.round(p.edge * 100)}%
                </span>
              </div>
            ))
            : (propTab === 'spread' ? spreadRows : totalRows).map((g, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] hover:bg-white/[0.02] transition-colors">
                <div>
                  <div className="text-[12px] font-semibold text-white font-condensed truncate">{g.away_team} @ {g.home_team}</div>
                  <div className="text-[10px] text-gray-600 font-condensed">{propTab === 'spread' ? 'Spread' : 'Total'}</div>
                </div>
                <span className="text-[12px] font-mono text-gray-300 self-center">{g.line ?? '—'}</span>
                <span className="text-[12px] font-mono text-gray-400 self-center">{g.implied_prob != null ? Math.round(g.implied_prob * 100) + '%' : '—'}</span>
                <span className="text-[12px] font-mono text-gray-300 self-center">{Math.round(g.hit_rate * 100)}%</span>
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
