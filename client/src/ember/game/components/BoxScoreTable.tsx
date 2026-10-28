import { useState } from 'react'
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
  // One team at a time: a combined list ran past 30 rows. Defaults to whichever
  // team actually has rows so a one-sided group never opens empty.
  const teams = [away, home]
  const countFor = (t: TeamRef) => group.rows.filter((r) => r.team_id === t.id).length
  const [teamId, setTeamId] = useState<number>(countFor(away) > 0 ? away.id : home.id)
  const rows = group.rows.filter((r) => r.team_id === teamId)

  const gridTemplate = `minmax(120px,1fr) 38px repeat(${group.columns.length}, 46px)`

  return (
    <ModuleCard title={group.label} meta={`${rows.length} PLAYERS`}>
      <div className="flex gap-2 px-[18px] py-[10px] border-b border-[#27221F]">
        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={teamId === t.id}
            onClick={() => setTeamId(t.id)}
            className={`font-martian font-bold text-[12px] tracking-[1px] px-[14px] py-[6px] rounded-md cursor-pointer transition-colors ${
              teamId === t.id
                ? 'bg-[#EFE9E0] text-[#14100F]'
                : 'border border-[#2C2624] text-[#C9C2BE] hover:text-[#EFEBE9]'
            }`}
          >
            {t.abbreviation} · {countFor(t)}
          </button>
        ))}
      </div>
      <div className="overflow-auto max-h-[440px]">
        <div className="min-w-max">
          <div
            className="grid gap-2 items-center px-[18px] py-[9px] border-b border-[#27221F] sticky top-0 bg-[#1B1715] z-10"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">PLAYER</span>
            <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">TM</span>
            {group.columns.map((c) => (
              <span
                key={c.key}
                className="font-martian text-[10px] text-[#A8A09C] tracking-[1px] text-right"
              >
                {c.label}
              </span>
            ))}
          </div>

          {rows.map((row) => (
            <Link
              key={`${row.player_id}-${group.id}`}
              to={playerPath(league, row.player_id)}
              className="grid gap-2 items-center px-[18px] py-[9px] border-t border-[#221D1A] hover:bg-[#211C1A]"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="min-w-0">
                <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                  {row.name ?? `#${row.player_id}`}
                </div>
                {row.position && (
                  <div className="font-martian text-[10px] text-[#A8A09C] mt-[2px]">
                    {row.position}
                  </div>
                )}
              </div>
              <span className="font-martian font-bold text-[11px] bg-[#2C2624] text-[#C9C2BE] rounded-[3px] px-[5px] py-[3px] text-center">
                {abbrFor(row.team_id)}
              </span>
              {group.columns.map((c, i) => (
                <span
                  key={c.key}
                  className={`font-martian text-[14px] text-right tabular-nums ${
                    i === 0 ? 'text-[#C9C2BE]' : 'font-bold text-[#EFEBE9]'
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
