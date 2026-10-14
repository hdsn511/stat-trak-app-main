import { Link } from 'react-router-dom'
import LeaguePill from '@/ember/components/LeaguePill'
import ModuleCard from '@/ember/components/ModuleCard'
import type { LeagueSignals as LeagueSignalsData, SignalKind } from './signals'

const KIND_LABEL: Record<SignalKind, string> = {
  hot: 'HOT',
  rising: 'RISING',
  streak: 'STREAK',
  live: 'LIVE',
  final: 'FINAL',
  next: 'NEXT',
}

const KIND_COLOR: Record<SignalKind, string> = {
  hot: 'text-[#FF6B3D] border-[#FF6B3D]/40',
  rising: 'text-[#FF6B3D] border-[#FF6B3D]/40',
  streak: 'text-[#E9B949] border-[#E9B949]/40',
  live: 'text-[#3FBF7F] border-[#3FBF7F]/40',
  final: 'text-[#9A918F] border-[#3A3330]',
  next: 'text-[#9A918F] border-[#3A3330]',
}

interface LeagueSignalsProps {
  lanes: LeagueSignalsData[]
  /** Leagues with no game near today, named so their absence is explained. */
  offSeason?: string[]
  loading?: boolean
}

function LeagueLane({ lane }: { lane: LeagueSignalsData }) {
  const meta = [
    `${lane.gamesCount} GAME${lane.gamesCount === 1 ? '' : 'S'}`,
    lane.liveCount > 0 ? `${lane.liveCount} LIVE` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <ModuleCard
      title={`${lane.label} SIGNALS`}
      headerRight={
        <div className="flex items-center gap-3">
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">{meta}</span>
          <Link
            to={`/${lane.league}`}
            className="font-martian text-[8px] text-[#9A918F] hover:text-[#FF6B3D] tracking-[1px]"
          >
            {`${lane.label} →`}
          </Link>
        </div>
      }
    >
      {lane.signals.length === 0 && (
        <div className="px-[18px] py-6 font-martian text-[9px] text-[#665F5D] tracking-[1px]">
          NO SIGNALS YET — DATA ARRIVES AFTER THE NEXT SLATE
        </div>
      )}
      {lane.signals.map((s) => (
        <Link
          key={s.id}
          to={s.to}
          className="grid grid-cols-[84px_1fr_auto] items-center gap-4 px-[18px] py-[14px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
        >
          <div className="min-w-0">
            <div className="font-chakra italic font-bold text-[26px] leading-none text-[#EFEBE9] whitespace-nowrap">
              {s.stat}
            </div>
            <div className="font-martian text-[8px] text-[#665F5D] tracking-[0.5px] mt-[6px] whitespace-nowrap overflow-hidden text-ellipsis">
              {s.statLabel}
            </div>
          </div>
          <div className="min-w-0">
            <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
              {s.name}
            </div>
            <div className="font-schibsted text-[11.5px] text-[#9A918F] mt-[4px] whitespace-nowrap overflow-hidden text-ellipsis">
              {s.context}
            </div>
          </div>
          <span
            className={`font-martian font-bold text-[8px] tracking-[1px] border rounded px-[7px] py-[3px] ${KIND_COLOR[s.kind]}`}
          >
            {KIND_LABEL[s.kind]}
          </span>
        </Link>
      ))}
    </ModuleCard>
  )
}

export default function LeagueSignals({ lanes, offSeason = [], loading = false }: LeagueSignalsProps) {
  if (lanes.length === 0) {
    return (
      <section>
        <div className="font-martian text-[9px] text-[#665F5D] tracking-[1.5px]">
          {loading ? 'LOADING SIGNALS…' : 'NO LEAGUES IN SEASON RIGHT NOW'}
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <span className="font-chakra italic font-bold text-[15px] tracking-[0.5px] text-[#EFEBE9]">
          <span className="text-[#FF6B3D]">{'// '}</span>
          STAT SIGNALS
        </span>
        <span className="font-martian text-[9px] text-[#665F5D] tracking-[1.5px] uppercase">
          IN SEASON NOW
        </span>
        {offSeason.length > 0 && (
          <span className="ml-auto flex items-center gap-2 font-martian text-[8px] text-[#4A403C] tracking-[1px]">
            OFF-SEASON
            {offSeason.map((l) => (
              <LeaguePill key={l} league={l} />
            ))}
          </span>
        )}
      </div>
      {/* Three lanes sit three across; any other count splits into two. */}
      <div
        className={`grid gap-[14px] mt-[14px] ${
          lanes.length === 3 ? 'lg:grid-cols-3' : lanes.length > 1 ? 'lg:grid-cols-2' : ''
        }`}
      >
        {lanes.map((lane) => (
          <LeagueLane key={lane.league} lane={lane} />
        ))}
      </div>
    </section>
  )
}
