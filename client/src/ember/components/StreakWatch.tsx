import { Link } from 'react-router-dom'
import LeaguePill from './LeaguePill'
import ModuleCard from './ModuleCard'

export type StreakRow = {
  name: string
  league?: string
  team: string
  label: string
  games: boolean[]
  count: number
}

interface StreakWatchProps {
  rows: StreakRow[]
  meta: string
  showLeague?: boolean
  footerLink?: { label: string; to: string }
  className?: string
}

export default function StreakWatch({
  rows,
  meta,
  showLeague = false,
  footerLink,
  className = '',
}: StreakWatchProps) {
  return (
    <ModuleCard title="STREAK WATCH" meta={meta} className={className}>
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex items-center gap-3 px-[18px] py-[13px] border-b border-[#221D1A] last:border-b-0"
        >
          {showLeague && row.league && <LeaguePill league={row.league} />}
          <div className="min-w-0 flex-1">
            <div className="font-schibsted font-bold text-[13px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
              {row.name}
            </div>
            <div className="font-martian text-[9px] text-[#9A918F] mt-[2px]">
              {row.team} · {row.label}
            </div>
          </div>
          <div className="flex gap-[3px] shrink-0">
            {row.games.map((hit, i) => (
              <span
                key={i}
                className={`w-[7px] h-[14px] rounded-[1.5px] ${hit ? 'bg-[#FF6B3D]' : 'bg-[#3A322E]'}`}
              />
            ))}
          </div>
          <span className="font-martian font-bold text-[20px] text-[#EFEBE9] text-right w-[32px] shrink-0">
            {row.count}
          </span>
        </div>
      ))}
      {footerLink && (
        <Link
          to={footerLink.to}
          className="block font-martian font-bold text-[10px] text-[#FF6B3D] tracking-[1px] px-[18px] py-3"
        >
          {footerLink.label}
        </Link>
      )}
    </ModuleCard>
  )
}
