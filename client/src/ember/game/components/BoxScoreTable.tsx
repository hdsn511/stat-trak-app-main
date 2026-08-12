import { Link } from 'react-router-dom'
import type { BoxGroup, TeamRef } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import { playerPath } from '@/lib/paths'
import { formatStat } from '../format'

interface BoxScoreTableProps {
  league: string
  group: BoxGroup
  home: TeamRef
  away: TeamRef
}

/**
 * One box-score section. Columns come from the server's league registry, so
 * this renders an NFL passing table and an NHL goalie table without knowing
 * anything about either sport.
 */
export default function BoxScoreTable({ league, group, home, away }: BoxScoreTableProps) {
  const abbrFor = (teamId: number) =>
    teamId === home.id ? home.abbreviation : teamId === away.id ? away.abbreviation : '—'

  // Name column flexes; every stat column is a fixed 46px so the header and
  // body stay aligned across rows.
  const gridTemplate = `minmax(120px,1fr) 38px repeat(${group.columns.length}, 46px)`

  return (
    <ModuleCard title={group.label} meta={`${group.rows.length} PLAYERS`}>
      <div className="overflow-x-auto">
        <div className="min-w-max">
          <div
            className="grid gap-2 items-center px-[18px] py-[9px] border-b border-[#27221F]"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">PLAYER</span>
            <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">TM</span>
            {group.columns.map((c) => (
              <span
                key={c.key}
                className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right"
              >
                {c.label}
              </span>
            ))}
          </div>

          {group.rows.map((row) => (
            <Link
              key={`${row.player_id}-${group.id}`}
              to={playerPath(league, row.player_id)}
              className="grid gap-2 items-center px-[18px] py-[9px] border-t border-[#221D1A] hover:bg-[#211C1A]"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="min-w-0">
                <div className="font-schibsted font-bold text-[12px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                  {row.name ?? `#${row.player_id}`}
                </div>
                {row.position && (
                  <div className="font-martian text-[8px] text-[#665F5D] mt-[2px]">
                    {row.position}
                  </div>
                )}
              </div>
              <span className="font-martian font-bold text-[9px] bg-[#2C2624] text-[#9A918F] rounded-[3px] px-[5px] py-[3px] text-center">
                {abbrFor(row.team_id)}
              </span>
              {group.columns.map((c, i) => (
                <span
                  key={c.key}
                  className={`font-martian text-[12px] text-right tabular-nums ${
                    i === 0 ? 'text-[#9A918F]' : 'font-bold text-[#EFEBE9]'
                  }`}
                >
                  {formatStat(c, row.values[c.key])}
                </span>
              ))}
            </Link>
          ))}
        </div>
      </div>
    </ModuleCard>
  )
}
