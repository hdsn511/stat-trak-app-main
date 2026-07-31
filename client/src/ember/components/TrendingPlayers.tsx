import LeaguePill from './LeaguePill'
import ModuleCard from './ModuleCard'

export type TrendingRow = {
  rank: number
  name: string
  league?: string
  team: string
  stat: string
  chips: string[]
  seasonVal: number
  l10Val: number
  delta: string
}

interface TrendingPlayersProps {
  rows: TrendingRow[]
  meta: string
  showLeague?: boolean
  className?: string
}

export default function TrendingPlayers({
  rows,
  meta,
  showLeague = false,
  className = '',
}: TrendingPlayersProps) {
  return (
    <ModuleCard title="TRENDING PLAYERS" meta={meta} className={className}>
      {rows.map((row) => {
        const max = Math.max(row.seasonVal, row.l10Val) || 1
        return (
          <div
            key={`${row.rank}-${row.name}`}
            className={`grid items-center gap-[14px] px-[18px] py-[14px] border-b border-[#221D1A] last:border-b-0 ${
              showLeague
                ? 'grid-cols-[26px_38px_1fr_auto_150px_52px]'
                : 'grid-cols-[26px_1fr_auto_150px_52px]'
            }`}
          >
            <span className="font-martian font-bold text-[12px] text-[#665F5D]">
              {String(row.rank).padStart(2, '0')}
            </span>
            {showLeague && row.league && <LeaguePill league={row.league} />}
            <div className="min-w-0">
              <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                {row.name}
              </div>
              <div className="font-martian text-[9px] text-[#9A918F] mt-[2px]">
                {row.team} · {row.stat}
              </div>
            </div>
            <div className="flex gap-[6px]">
              {row.chips.slice(0, 2).map((chip) => (
                <span
                  key={chip}
                  className="font-martian font-medium text-[8px] text-[#FF6B3D] uppercase border border-[rgba(255,107,61,0.5)] bg-[rgba(255,107,61,0.08)] rounded-[3px] px-[6px] py-[2px] whitespace-nowrap"
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-[5px] w-[150px]">
              <div className="flex items-center gap-[6px]">
                <div className="flex-1 h-1 rounded-[2px] bg-[#2C2624] overflow-hidden">
                  <div
                    className="h-full rounded-[2px] bg-[#665F5D]"
                    style={{ width: `${(row.seasonVal / max) * 100}%` }}
                  />
                </div>
                <span className="font-martian text-[9px] text-[#9A918F] w-[32px] text-right shrink-0">
                  {row.seasonVal}
                </span>
              </div>
              <div className="flex items-center gap-[6px]">
                <div className="flex-1 h-1 rounded-[2px] bg-[#2C2624] overflow-hidden">
                  <div
                    className="h-full rounded-[2px] bg-[#FF6B3D]"
                    style={{ width: `${(row.l10Val / max) * 100}%` }}
                  />
                </div>
                <span className="font-martian font-bold text-[10px] text-[#FF6B3D] w-[32px] text-right shrink-0">
                  {row.l10Val}
                </span>
              </div>
            </div>
            <span className="font-martian font-bold text-[13px] text-[#FF6B3D] text-right">
              {row.delta}
            </span>
          </div>
        )
      })}
    </ModuleCard>
  )
}
