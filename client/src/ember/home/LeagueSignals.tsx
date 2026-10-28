import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import LeaguePill from '@/ember/components/LeaguePill'
import ModuleCard from '@/ember/components/ModuleCard'
import type {
  LeagueSignals as LeagueSignalsData,
  SignalKind,
  SignalViz,
  StatSignal,
} from './signals'

const KIND_LABEL: Record<SignalKind, string> = {
  hot: 'HOT',
  rising: 'RISING',
  streak: 'STREAK',
  live: 'LIVE',
  final: 'FINAL',
  next: 'MATCHUP',
}

const KIND_COLOR: Record<SignalKind, string> = {
  hot: '#FF6B3D',
  rising: '#FF6B3D',
  streak: '#E9B949',
  live: '#3FBF7F',
  final: '#8A827E',
  next: '#6FA8DC',
}

interface LeagueSignalsProps {
  lanes: LeagueSignalsData[]
  /** Leagues with no game near today, named so their absence is explained. */
  offSeason?: string[]
  loading?: boolean
}

const RESULT_COLOR: Record<string, string> = { W: '#3FBF7F', L: '#FF6B5C', T: '#8A827E' }

/** Season vs recent as two bars on one scale, with the numbers beside them. */
function TrendViz({ viz }: { viz: Extract<SignalViz, { kind: 'trend' }> }) {
  const max = Math.max(viz.season, viz.recent, 0.1)
  const row = (label: string, value: number, color: string) => (
    <div className="flex items-center gap-2">
      <span className="font-martian text-[10px] text-[#A8A09C] w-[26px]">{label}</span>
      <div className="flex-1 h-[5px] rounded-full bg-[#2C2624] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / max) * 100}%`, background: color }}
        />
      </div>
      <span className="font-martian text-[11px] text-[#D8D2CE] tabular-nums w-[34px] text-right">
        {value}
      </span>
    </div>
  )
  return (
    <div className="flex flex-col gap-[5px] w-[150px]">
      {row('SZN', viz.season, '#665F5D')}
      {row('NOW', viz.recent, '#FF6B3D')}
    </div>
  )
}

/** One square per game in the sample, filled for the ones that cleared the line. */
function PipsViz({ viz }: { viz: Extract<SignalViz, { kind: 'pips' }> }) {
  return (
    <div className="flex gap-[3px] w-[150px] justify-end">
      {Array.from({ length: Math.max(viz.total, viz.filled) }, (_, i) => (
        <span
          key={i}
          className="w-[8px] h-[16px] rounded-[2px]"
          style={{ background: i < viz.filled ? '#E9B949' : '#2C2624' }}
        />
      ))}
    </div>
  )
}

/** Last results as coloured dots, newest first, one line per team. */
function FormViz({ viz }: { viz: Extract<SignalViz, { kind: 'form' }> }) {
  return (
    <div className="flex flex-col gap-[5px] w-[150px]">
      {viz.rows.map((r) => (
        <div key={r.team} className="flex items-center gap-2">
          <span className="font-martian text-[11px] text-[#C9C2BE] w-[34px]">{r.team}</span>
          <div className="flex gap-[4px]">
            {r.results.split('').map((c, i) => (
              <span
                key={i}
                title={c === 'W' ? 'Win' : c === 'L' ? 'Loss' : 'Tie'}
                className="w-[9px] h-[9px] rounded-full"
                style={{ background: RESULT_COLOR[c] ?? '#8A827E' }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Viz({ viz }: { viz?: SignalViz }) {
  if (!viz) return null
  if (viz.kind === 'trend') return <TrendViz viz={viz} />
  if (viz.kind === 'pips') return <PipsViz viz={viz} />
  return <FormViz viz={viz} />
}

function SignalRow({ s, showLeague }: { s: StatSignal; showLeague: boolean }) {
  const color = KIND_COLOR[s.kind]
  return (
    <Link
      to={s.to}
      className="grid grid-cols-[96px_1fr] md:grid-cols-[96px_1fr_150px] items-center gap-5 px-[18px] py-[14px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      {/* Same size for every headline so rows scan as one column. */}
      <div className="min-w-0">
        <div className="font-chakra italic font-bold text-[22px] leading-none text-[#EFEBE9] whitespace-nowrap tabular-nums">
          {s.stat}
        </div>
        <div className="font-martian text-[10px] text-[#A8A09C] tracking-[0.5px] mt-[7px] whitespace-nowrap overflow-hidden text-ellipsis">
          {s.statLabel}
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {showLeague && <LeaguePill league={s.league.toUpperCase()} />}
          <span className="font-martian font-bold text-[10px] tracking-[1px]" style={{ color }}>
            {KIND_LABEL[s.kind]}
          </span>
        </div>
        <div className="font-schibsted font-bold text-[15px] text-[#EFEBE9] mt-[5px] whitespace-nowrap overflow-hidden text-ellipsis">
          {s.name}
        </div>
        <div className="font-schibsted text-[13px] text-[#C9C2BE] mt-[3px] whitespace-nowrap overflow-hidden text-ellipsis">
          {s.context}
        </div>
      </div>

      <div className="hidden md:flex justify-end">
        <Viz viz={s.viz} />
      </div>
    </Link>
  )
}

const TAB =
  'font-martian font-bold text-[11px] tracking-[1px] px-[12px] py-[7px] rounded-md cursor-pointer transition-colors whitespace-nowrap ' +
  'text-[#C9C2BE] hover:text-[#EFEBE9] data-[state=active]:bg-[#EFE9E0] data-[state=active]:text-[#14100F]'

export default function LeagueSignals({
  lanes,
  offSeason = [],
  loading = false,
}: LeagueSignalsProps) {
  const [tab, setTab] = useState('all')

  // ALL interleaves the leagues (best signal from each first) so no sport
  // buries the others.
  const merged = useMemo(() => {
    const out: StatSignal[] = []
    const depth = Math.max(0, ...lanes.map((l) => l.signals.length))
    for (let i = 0; i < depth; i++) {
      for (const lane of lanes) if (lane.signals[i]) out.push(lane.signals[i]!)
    }
    return out
  }, [lanes])

  if (lanes.length === 0) {
    return (
      <section>
        <div className="font-martian text-[11px] text-[#A8A09C] tracking-[1.5px]">
          {loading ? 'LOADING SIGNALS…' : 'NO LEAGUES IN SEASON RIGHT NOW'}
        </div>
      </section>
    )
  }

  const active = lanes.some((l) => l.league === tab) ? tab : 'all'

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

      <TabsPrimitive.Root value={active} onValueChange={setTab} className="mt-[14px]">
        <ModuleCard
          title="SIGNAL FEED"
          meta={`${merged.length} LIVE SIGNAL${merged.length === 1 ? '' : 'S'}`}
          headerRight={
            <TabsPrimitive.List
              aria-label="Filter signals by league"
              className="flex items-center gap-1 p-1 rounded-lg bg-[#14110F] border border-[#26211E]"
            >
              <TabsPrimitive.Trigger value="all" className={TAB}>
                ALL
              </TabsPrimitive.Trigger>
              {lanes.map((lane) => (
                <TabsPrimitive.Trigger key={lane.league} value={lane.league} className={TAB}>
                  {lane.label}
                  <span className="ml-[6px] opacity-60">{lane.gamesCount}</span>
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
          }
        >
          <TabsPrimitive.Content value="all">
            {merged.map((s) => (
              <SignalRow key={s.id} s={s} showLeague />
            ))}
          </TabsPrimitive.Content>
          {lanes.map((lane) => (
            <TabsPrimitive.Content key={lane.league} value={lane.league}>
              {lane.signals.length === 0 ? (
                <div className="px-[18px] py-6 font-martian text-[11px] text-[#A8A09C] tracking-[1px]">
                  NO SIGNALS YET — DATA ARRIVES AFTER THE NEXT SLATE
                </div>
              ) : (
                lane.signals.map((s) => <SignalRow key={s.id} s={s} showLeague={false} />)
              )}
              <Link
                to={`/${lane.league}`}
                className="block px-[18px] py-3 border-t border-[#27221F] font-martian font-bold text-[11px] text-[#FF6B3D] tracking-[1.5px] hover:text-[#FFD9C9]"
              >
                {`OPEN ${lane.label} →`}
              </Link>
            </TabsPrimitive.Content>
          ))}
        </ModuleCard>
      </TabsPrimitive.Root>
    </section>
  )
}
