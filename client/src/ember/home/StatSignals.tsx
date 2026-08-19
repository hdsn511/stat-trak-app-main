import { Link } from 'react-router-dom'
import LeaguePill from '@/ember/components/LeaguePill'
import type { StatSignal } from './signals'

interface StatSignalsProps {
  signals: StatSignal[]
  meta?: string
}

export default function StatSignals({
  signals,
  meta = 'LATEST · ALL LEAGUES',
}: StatSignalsProps) {
  // Nothing to say is better than three empty cards.
  if (signals.length === 0) return null

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <span className="font-chakra italic font-bold text-[15px] tracking-[0.5px] text-[#EFEBE9]">
          <span className="text-[#FF6B3D]">{'// '}</span>
          STAT SIGNALS
        </span>
        <span className="font-martian text-[9px] text-[#665F5D] tracking-[1.5px] uppercase">
          {meta}
        </span>
      </div>
      <div
        className="grid gap-[14px] mt-[14px]"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
      >
        {signals.map((signal) => (
          <Link
            key={signal.id}
            to={signal.to}
            className="bg-[#1B1715] border border-[#2C2624] hover:border-[#FF6B3D] rounded-lg px-5 py-[18px] text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-chakra italic font-bold text-[26px] leading-none text-[#FF6B3D]">
                {signal.stat}
              </span>
              <LeaguePill league={signal.league} />
            </div>
            <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] mt-[14px]">
              {signal.name}
            </div>
            <div className="font-schibsted text-[11.5px] text-[#9A918F] mt-[6px]">
              {signal.context}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
