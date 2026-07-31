import { useNavigate } from 'react-router-dom'
import { AskBar, ModuleCard, QueryChips } from '@/ember/components'
import { LeagueConfig } from '@/ember/league/leagueConfigs'

interface BarProps {
  width: number | string
  height?: number
  className?: string
}

/** Dim placeholder bar — the skeleton grammar's basic unit. */
function Bar({ width, height = 10, className = '' }: BarProps) {
  return (
    <span
      aria-hidden
      className={`block rounded-[3px] bg-[#221D1A] ${className}`}
      style={{ width, height }}
    />
  )
}

const rowDelay = (i: number) => ({ animationDelay: `${i * 120}ms` })

interface StandingsSkeletonTableProps {
  label: string
  rows: number
  className?: string
}

function StandingsSkeletonTable({ label, rows, className = '' }: StandingsSkeletonTableProps) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3 px-[18px] py-3 border-b border-[#27221F]">
        <span className="font-chakra italic font-bold text-[13px] text-[#EFEBE9] tracking-[0.5px]">
          {label}
        </span>
        <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] whitespace-nowrap">
          W–L · PCT · L10 · STRK
        </span>
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[26px_1fr_58px_44px_64px_34px] gap-[10px] items-center px-[18px] py-2 border-t border-[#221D1A] animate-pulse"
          style={rowDelay(i)}
        >
          <Bar width={14} />
          <Bar width={`${60 + (i % 3) * 5}%`} />
          <Bar width={34} className="justify-self-end" />
          <Bar width={28} className="justify-self-end" />
          <div className="w-full h-[4px] rounded-[2px] bg-[#2C2624]" />
          <Bar width={20} className="justify-self-end" />
        </div>
      ))}
    </div>
  )
}

function TrendingSkeleton() {
  return (
    <ModuleCard title="TRENDING PLAYERS" meta="AWAITING DATA">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[26px_1fr_auto_150px_52px] items-center gap-[14px] px-[18px] py-[14px] border-b border-[#221D1A] last:border-b-0 animate-pulse"
          style={rowDelay(i)}
        >
          <Bar width={18} />
          <div>
            <Bar width={`${50 + (i % 3) * 8}%`} />
            <Bar width="35%" height={7} className="mt-[5px]" />
          </div>
          <Bar width={52} height={14} />
          <div className="flex flex-col gap-[5px] w-[150px]">
            <div className="flex items-center gap-[6px]">
              <div className="flex-1 h-1 rounded-[2px] bg-[#2C2624]" />
              <Bar width={24} height={7} className="shrink-0" />
            </div>
            <div className="flex items-center gap-[6px]">
              <div className="flex-1 h-1 rounded-[2px] bg-[#2C2624]" />
              <Bar width={24} height={7} className="shrink-0" />
            </div>
          </div>
          <Bar width={36} className="justify-self-end" />
        </div>
      ))}
    </ModuleCard>
  )
}

function StreakSkeleton() {
  return (
    <ModuleCard title="STREAK WATCH" meta="AWAITING DATA">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-[18px] py-[13px] border-b border-[#221D1A] last:border-b-0 animate-pulse"
          style={rowDelay(i)}
        >
          <div className="min-w-0 flex-1">
            <Bar width={`${45 + (i % 3) * 10}%`} />
            <Bar width="35%" height={7} className="mt-[5px]" />
          </div>
          <div className="flex gap-[3px] shrink-0">
            {Array.from({ length: 10 }, (_, d) => (
              <span key={d} className="w-[7px] h-[14px] rounded-[1.5px] bg-[#221D1A]" />
            ))}
          </div>
          <Bar width={24} height={16} className="shrink-0" />
        </div>
      ))}
    </ModuleCard>
  )
}

interface LeaguePageProps {
  config: LeagueConfig
}

export default function LeaguePage({ config }: LeaguePageProps) {
  const navigate = useNavigate()
  const openQuery = (query: string) => navigate('/sportquery', { state: { query } })

  return (
    <>
      {/* Local ticker row — the shared LiveTicker can't express an empty state */}
      <div
        className="flex items-center gap-[10px] px-[28px] py-[9px] border-b border-[#221E1B] overflow-x-auto no-scrollbar shrink-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, transparent 0, transparent 7px, rgba(255,107,61,0.03) 7px, rgba(255,107,61,0.03) 8px)',
        }}
      >
        <span className="font-martian font-medium text-[9px] text-[#665F5D] tracking-[1.5px] shrink-0">
          {config.tickerLabel}
        </span>
        <span className="font-martian text-[9px] text-[#443E3B] tracking-[1.5px] shrink-0">
          NO GAMES INGESTED YET · ESPN PIPELINE PENDING
        </span>
      </div>

      <section className="relative overflow-hidden bg-[#EFE9E0] border-b border-[#E4E0D6] px-8 pt-[26px] pb-6">
        <span
          aria-hidden
          className="pointer-events-none select-none absolute -top-[58px] -right-[14px] font-chakra italic font-bold text-[170px] leading-none tracking-[-8px] text-[rgba(20,16,15,0.05)]"
        >
          {config.ghost}
        </span>
        <div className="relative flex flex-wrap items-center gap-6 max-w-[1280px] mx-auto">
          <div>
            <h1 className="font-chakra italic font-bold text-[30px] leading-none text-[#14100F]">
              {config.name}
              <span className="text-[#D9481F]">.</span>
            </h1>
            <p className="font-martian text-[10px] text-[#6B675C] tracking-[1px] mt-2">
              {config.metaLine}
            </p>
          </div>
          <div className="ml-auto w-full max-w-[640px]">
            <AskBar placeholder={config.askPlaceholder} onSubmit={openQuery} />
            <div className="mt-3 [&>div]:justify-end">
              <QueryChips variant="paper" chips={config.chips} onSelect={openQuery} />
            </div>
          </div>
        </div>
      </section>

      <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-[14px] px-8 pt-7 pb-11">
        <ModuleCard title="STANDINGS" meta="AWAITING DATA · ESPN PIPELINE">
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
          >
            <StandingsSkeletonTable
              label={config.conferenceLabels[0]}
              rows={config.standingsRows}
              className="md:border-r md:border-[#27221F]"
            />
            <StandingsSkeletonTable
              label={config.conferenceLabels[1]}
              rows={config.standingsRows}
            />
          </div>
        </ModuleCard>

        <div className="grid gap-[14px] lg:grid-cols-[1fr_380px]">
          <TrendingSkeleton />
          <StreakSkeleton />
        </div>

        <p className="text-center font-martian text-[9px] text-[#443E3B] tracking-[1.5px] p-[18px]">
          <span className="text-[#FF6B3D] opacity-60">{'// '}</span>
          {config.name} DATA MIGRATION IN PROGRESS — POWERED BY THE ESPN PIPELINE
        </p>
      </div>
    </>
  )
}
