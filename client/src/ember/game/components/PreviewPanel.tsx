import { Link } from 'react-router-dom'
import type { GamePreview, PreviewPlayer, TeamRef } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import { playerPath } from '@/lib/paths'
import { formatStat } from '../format'

interface PreviewPanelProps {
  league: string
  preview: GamePreview
  home: TeamRef
  away: TeamRef
}

function Side({
  league,
  team,
  players,
  columns,
  className = '',
}: {
  league: string
  team: TeamRef
  players: PreviewPlayer[]
  columns: GamePreview['columns']
  className?: string
}) {
  const gridTemplate = `minmax(110px,1fr) repeat(${columns.length}, 44px)`

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3 px-[18px] py-3 border-b border-[#27221F]">
        <span className="font-chakra italic font-bold text-[13px] text-[#EFEBE9] tracking-[0.5px]">
          {team.abbreviation}
        </span>
        <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">{team.name}</span>
      </div>

      {players.length === 0 ? (
        <div className="px-[18px] py-8 text-center font-martian text-[9px] text-[#443E3B] tracking-[1.5px]">
          NO SEASON DATA
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            <div
              className="grid gap-2 px-[18px] py-2 border-b border-[#221D1A]"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <span />
              {columns.map((c) => (
                <span
                  key={c.key}
                  className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right"
                >
                  {c.label}
                </span>
              ))}
            </div>
            {players.map((p) => (
              <Link
                key={p.player_id}
                to={playerPath(league, p.player_id)}
                className="grid gap-2 items-center px-[18px] py-[9px] border-t border-[#221D1A] hover:bg-[#211C1A]"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="min-w-0">
                  <div className="font-schibsted font-bold text-[12px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                    {p.name}
                  </div>
                  <div className="font-martian text-[8px] text-[#665F5D] mt-[2px]">
                    {p.position} · {p.vs_opp_games > 0 ? `${p.vs_opp_games} VS OPP` : `${p.games_played} GP`}
                  </div>
                </div>
                {columns.map((c) => (
                  <span
                    key={c.key}
                    className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right tabular-nums"
                  >
                    {formatStat(c, p.values[c.key])}
                  </span>
                ))}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Pre-game view of each side's leading players. Averages are versus this
 * opponent when the two teams have met, otherwise season-wide — `stat_context`
 * says which, so the numbers are never ambiguous.
 */
export default function PreviewPanel({ league, preview, home, away }: PreviewPanelProps) {
  return (
    <ModuleCard
      title={`PROJECTED ${preview.label}`}
      meta={preview.stat_context.toUpperCase()}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Side
          league={league}
          team={away}
          players={preview.away}
          columns={preview.columns}
          className="md:border-r md:border-[#27221F]"
        />
        <Side league={league} team={home} players={preview.home} columns={preview.columns} />
      </div>
    </ModuleCard>
  )
}
