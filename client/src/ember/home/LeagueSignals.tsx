import { Link } from 'react-router-dom'
import LeaguePill from '@/ember/components/LeaguePill'
import ModuleCard from '@/ember/components/ModuleCard'
import type { LeagueSignals as LeagueSignalsData, SignalKind, SignalViz } from './signals'

const KIND_LABEL: Record<SignalKind, string> = {
  hot: 'HOT',
  rising: 'RISING',
  streak: 'STREAK',
  live: 'LIVE',
  final: 'FINAL',
  next: 'NEXT',
}

/** What each badge means, on hover: the headline number alone doesn't say. */
const KIND_TIP: Record<SignalKind, string> = {
  hot: "Biggest jump of the player's recent average over their season average",
  rising: 'Recent average climbing above the season average',
  streak: 'Games in a row at or above this line',
  live: 'Game in progress',
  final: 'Final score margin',
  next: "Next game's scoring edge: each team's season margin (scored − allowed per game), favourite minus underdog",
}

const KIND_COLOR: Record<SignalKind, string> = {
  hot: 'text-[#FF6B3D] border-[#FF6B3D]/40',
  rising: 'text-[#FF6B3D] border-[#FF6B3D]/40',
  streak: 'text-[#E9B949] border-[#E9B949]/40',
  live: 'text-[#3FBF7F] border-[#3FBF7F]/40',
  final: 'text-[#C9C2BE] border-[#3A3330]',
  next: 'text-[#C9C2BE] border-[#3A3330]',
}

/** Headline-number colour and accent bar per kind, so a lane scans by colour before it is read. */
const KIND_NUM: Record<SignalKind, string> = {
  hot: 'text-[#FF6B3D]',
  rising: 'text-[#FF6B3D]',
  streak: 'text-[#E9B949]',
  live: 'text-[#3FBF7F]',
  final: 'text-[#EFEBE9]',
  next: 'text-[#EFEBE9]',
}
const KIND_BAR: Record<SignalKind, string> = {
  hot: 'bg-[#FF6B3D]',
  rising: 'bg-[#FF6B3D]',
  streak: 'bg-[#E9B949]',
  live: 'bg-[#3FBF7F]',
  final: 'bg-[#3A3330]',
  next: 'bg-[#3A3330]',
}

/**
 * One slot per game, in the order played (oldest left, newest right). Slots are
 * fixed in number so a long run never shrinks them to dots.
 */
function Segments({ slots }: { slots: string[] }) {
  return (
    <div className="flex-1 flex gap-[2px]">
      {slots.map((color, i) => (
        <span key={i} className={`h-[14px] flex-1 min-w-0 rounded-[4px] ${color}`} />
      ))}
    </div>
  )
}

const OFF = 'bg-[#2A2420]'

/** The evidence behind the number, drawn small: recent-vs-season bars, streak pips, or last-5 form. */
function Viz({ viz }: { viz: SignalViz }) {
  if (viz.kind === 'trend') {
    const max = Math.max(viz.season, viz.recent, 0.01)
    const bar = (label: string, v: number, color: string) => (
      <div className="flex items-center gap-2">
        <span className="w-[32px] font-martian text-[11px] tracking-[0.5px] text-[#8A827E]">{label}</span>
        <div className="flex-1 h-[5px] rounded-full bg-[#2A2420]">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max((v / max) * 100, 3)}%` }} />
        </div>
        <span className="w-[40px] text-right font-martian text-[12px] tabular-nums text-[#C9C2BE]">{v}</span>
      </div>
    )
    return (
      <div className="mt-[9px] flex flex-col gap-[5px]">
        {bar('SZN', viz.season, 'bg-[#5A514C]')}
        {bar('NOW', viz.recent, 'bg-[#FF6B3D]')}
      </div>
    )
  }
  // Same label · bar · value rhythm as the trend bars, so every viz lines up.
  if (viz.kind === 'pips') {
    return (
      <div className="mt-[9px] flex items-center gap-2" aria-label={`${viz.filled} of ${viz.total}`}>
        <span className="w-[32px] font-martian text-[11px] tracking-[0.5px] text-[#8A827E]">L{viz.total}</span>
        <Segments slots={Array.from({ length: viz.total }, (_, i) => (i >= viz.total - viz.filled ? 'bg-[#E9B949]' : OFF))} />
        <span className="w-[40px] text-right font-martian text-[12px] tabular-nums text-[#C9C2BE]">{viz.filled}/{viz.total}</span>
      </div>
    )
  }
  return (
    <div className="mt-[9px] flex flex-col gap-[5px]">
      {viz.rows.map((r) => {
        const total = r.results.length
        const w = r.results.split('').filter((c) => c === 'W').length
        const l = r.results.split('').filter((c) => c === 'L').length
        // The API lists newest first; draw oldest → newest like the streak row.
        const slots = r.results.split('').reverse().map((c) => (c === 'W' ? 'bg-[#3FBF7F]' : c === 'L' ? 'bg-[#FF6B5C]' : 'bg-[#6A615C]'))
        return (
          <div key={r.team} className="flex items-center gap-2" title={`${r.team}: won ${w} of last ${total}`}>
            <span className="w-[32px] font-martian text-[11px] tracking-[0.5px] text-[#8A827E]">{r.team}</span>
            <Segments slots={slots} />
            <span className="w-[40px] text-right font-martian text-[12px] tabular-nums text-[#C9C2BE]">{w}–{l}</span>
            <span className="-ml-1 font-martian text-[11px] text-[#8A827E]">L{total}</span>
          </div>
        )
      })}
    </div>
  )
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
          <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">{meta}</span>
          <Link
            to={`/${lane.league}`}
            className="font-martian text-[10px] text-[#C9C2BE] hover:text-[#FF6B3D] tracking-[1px]"
          >
            {`${lane.label} →`}
          </Link>
        </div>
      }
    >
      {lane.signals.length === 0 && (
        <div className="px-[18px] py-6 font-martian text-[11px] text-[#A8A09C] tracking-[1px]">
          NO SIGNALS YET — DATA ARRIVES AFTER THE NEXT SLATE
        </div>
      )}
      {lane.signals.map((s) => (
        <Link
          key={s.id}
          to={s.to}
          className="relative grid grid-cols-[100px_1fr_auto] items-center gap-x-5 px-[18px] py-[14px] min-h-[144px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
        >
          <span className={`absolute left-0 top-[14px] bottom-[14px] w-[3px] rounded-r ${KIND_BAR[s.kind]}`} />
          {/* Fixed-width headline cell with its own divider, so a wide value
              ("7:00 PM", "104–99") shrinks to fit instead of running into the
              name column. */}
          <div className="row-span-2 min-w-0 pr-5 border-r border-[#2C2624]" title={`${s.stat} ${s.statLabel}`}>
            <div
              className={`font-chakra italic font-bold leading-none ${KIND_NUM[s.kind]} whitespace-nowrap text-[22px] tabular-nums`}
            >
              {s.stat}
            </div>
            <div className="font-martian text-[10px] text-[#A8A09C] tracking-[0.5px] mt-[7px] whitespace-nowrap overflow-hidden text-ellipsis">
              {s.statLabel}
            </div>
          </div>
          <div className="min-w-0">
            <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
              {s.name}
            </div>
            {/* Two lines before clipping: the context is the "why", so cutting it at one line hid the point. */}
            <div className="font-schibsted text-[13px] leading-snug text-[#C9C2BE] mt-[4px] line-clamp-2" title={s.context}>
              {s.context}
            </div>
          </div>
          <span
            title={KIND_TIP[s.kind]}
            className={`cursor-help font-martian font-bold text-[10px] tracking-[1px] border rounded px-[7px] py-[3px] ${KIND_COLOR[s.kind]}`}
          >
            {KIND_LABEL[s.kind]}
          </span>
          {/* Under the name AND the badge, so the tiles get the lane's full width. */}
          {s.viz && (
            <div className="col-start-2 col-span-2 min-w-0">
              <Viz viz={s.viz} />
            </div>
          )}
        </Link>
      ))}
    </ModuleCard>
  )
}

export default function LeagueSignals({ lanes, offSeason = [], loading = false }: LeagueSignalsProps) {
  if (lanes.length === 0) {
    return (
      <section>
        <div className="font-martian text-[11px] text-[#A8A09C] tracking-[1.5px]">
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
        <span className="font-martian text-[11px] text-[#A8A09C] tracking-[1.5px] uppercase">
          IN SEASON NOW
        </span>
        {offSeason.length > 0 && (
          <span className="ml-auto flex items-center gap-2 font-martian text-[10px] text-[#8A827E] tracking-[1px]">
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
