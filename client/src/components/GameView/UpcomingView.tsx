import { GameDetail } from '@/services/api'

interface Props { data: GameDetail }

const STAT_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM',
  points: 'PTS', rebounds: 'REB', assists: 'AST', three_points_made: '3PM',
}

function PropRow({ prop }: { prop: GameDetail['props'][number] }) {
  const mktPct = prop.implied_prob != null ? Math.round(prop.implied_prob * 100) : null

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#0F0F0F] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-white font-condensed truncate">
          {prop.prop_type === 'player'
            ? (prop.player_name ?? `Player ${prop.entity_id}`)
            : prop.prop_type === 'spread' ? 'Spread'
            : prop.prop_type === 'total'  ? 'Total'
            : prop.prop_type.toUpperCase()}
        </div>
        {prop.prop_type === 'player' && prop.stat && (
          <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">
            {STAT_LABEL[prop.stat] ?? prop.stat.toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
        {prop.line != null && (
          <span className="text-[13px] font-black text-white font-mono tabular-nums">{prop.line}</span>
        )}
        {mktPct != null && (
          <span className="text-[10px] font-mono text-gray-600 tabular-nums w-9 text-right">{mktPct}%</span>
        )}
        {prop.source && (
          <span className="text-[8px] font-bold text-gray-700 font-condensed uppercase tracking-widest border border-[#222] rounded px-1 py-0.5">
            {prop.source}
          </span>
        )}
      </div>
    </div>
  )
}

function PropsSection({ title, props }: { title: string; props: GameDetail['props'] }) {
  if (props.length === 0) return null
  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111]">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">{title}</span>
      </div>
      {props.map((prop, i) => <PropRow key={i} prop={prop} />)}
    </div>
  )
}

export default function UpcomingView({ data }: Props) {
  const playerProps = data.props.filter(p => p.prop_type === 'player')
    .sort((a, b) => (b.implied_prob ?? 0) - (a.implied_prob ?? 0))
    .slice(0, 10)
  const spreadProps = data.props.filter(p => p.prop_type === 'spread')
  const totalProps  = data.props.filter(p => p.prop_type === 'total')
  const winnerProps = data.props.filter(p => p.prop_type === 'winner')

  const hasAny = data.props.length > 0

  return (
    <div className="space-y-4">
      {!hasAny && (
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl px-4 py-10 text-center">
          <div className="text-[11px] text-gray-700 font-condensed">No lines posted for this game yet</div>
        </div>
      )}
      <PropsSection title="Player Props" props={playerProps} />
      <PropsSection title="Spread" props={spreadProps} />
      <PropsSection title="Game Total" props={totalProps} />
      <PropsSection title="Moneyline" props={winnerProps} />
    </div>
  )
}
