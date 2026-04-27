import { GameDetail } from '@/services/api'

interface Props { data: GameDetail }

export default function UpcomingView({ data }: Props) {
  return (
    <div className="space-y-4">
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#111]">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Today's Lines</span>
        </div>

        {data.props.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">No lines posted for this game yet</div>
        )}

        {data.props.slice(0, 10).map((prop, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-[#0F0F0F] last:border-0">
            <div className="min-w-0">
              <div className="text-[11px] text-gray-400 font-condensed truncate">{prop.market_ticker}</div>
              <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">
                {prop.prop_type}{prop.stat ? ` · ${prop.stat.toUpperCase()}` : ''}
              </div>
            </div>
            <div className="flex gap-3 flex-shrink-0">
              {prop.line != null && <span className="text-[11px] font-mono text-gray-300">{prop.line}</span>}
              {prop.implied_prob != null && (
                <span className="text-[11px] font-mono text-gray-500">{Math.round(prop.implied_prob * 100)}%</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
