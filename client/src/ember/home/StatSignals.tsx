import { useNavigate } from 'react-router-dom'
import LeaguePill from '@/ember/components/LeaguePill'
import { StatSignal } from '@/ember/data/homeFixtures'

interface StatSignalsProps {
  signals: StatSignal[]
}

export default function StatSignals({ signals }: StatSignalsProps) {
  const navigate = useNavigate()

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <span className="font-chakra italic font-bold text-[15px] tracking-[0.5px] text-[#EFEBE9]">
          <span className="text-[#FF6B3D]">{'// '}</span>
          STAT SIGNALS
        </span>
        <span className="font-martian text-[9px] text-[#665F5D] tracking-[1.5px] uppercase">
          LAST NIGHT · ALL LEAGUES
        </span>
      </div>
      <div
        className="grid gap-[14px] mt-[14px]"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
      >
        {signals.map((signal) => (
          <button
            key={signal.id}
            type="button"
            onClick={() => navigate('/sportquery')}
            className="bg-[#1B1715] border border-[#2C2624] hover:border-[#FF6B3D] rounded-lg px-5 py-[18px] text-left cursor-pointer"
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
          </button>
        ))}
      </div>
    </section>
  )
}
