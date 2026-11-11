import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import type { Matchup } from '@/services/api'
import PlayerAvatar from './PlayerAvatar'
import TeamLogo from './TeamLogo'
import LeaguePill from './LeaguePill'
import { MatchupNote, StatTag } from './PropVisuals'

/** A tag on a row's fourth line: `strong` is a boxed ember tag, otherwise plain muted text. */
export function RowTag({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`font-martian text-[10px] uppercase whitespace-nowrap py-[2px] ${
        strong ? 'text-[#FF6B3D] border border-[rgba(255,107,61,0.4)] rounded-[3px] px-[6px]' : 'text-[#A8A09C]'
      }`}
    >
      {children}
    </span>
  )
}

/**
 * The row Trending Players and Streak Watch share. The player block is four
 * fixed-height lines (name + stat, team, matchup, tags) whatever is in them, so
 * every row on both cards is the same height and the two cards line up row for
 * row. Columns come from the .sugg-row container query in index.css.
 */
export default function SuggestionRow({
  league,
  leagueLabel,
  showLeague,
  playerId,
  extId,
  name,
  team,
  label,
  opponent,
  matchup,
  tags,
  ticket,
  viz,
  mark,
}: {
  league: string
  leagueLabel: string
  showLeague: boolean
  playerId: number
  extId?: string | null
  name: string
  team: string
  label: string
  opponent?: string | null
  matchup?: Matchup | null
  /** Fourth line: the card's tags (trend chips, streak depth), after the league pill when shown. */
  tags: ReactNode
  ticket: ReactNode
  /** The chart column; hidden when the card is too narrow for it. */
  viz: ReactNode
  mark: ReactNode
}) {
  return (
    <Link
      to={playerPath(league, playerId)}
      className="sugg-row grid items-center gap-[12px] px-5 py-4 hover:bg-[#211C1A]"
    >
      <div className="min-w-0 flex items-center gap-3">
        <PlayerAvatar league={league} extId={extId} name={name} accent={teamAccent(league, team)} size={42} />
        <div className="min-w-0 flex-1 grid grid-rows-[20px_16px_16px_20px] gap-y-[3px] items-center">
          <div className="flex items-center gap-[6px] min-w-0">
            <span className="font-schibsted font-bold text-[15px] text-[#EFEBE9] truncate">{name}</span>
            <StatTag label={label} />
          </div>
          <div className="flex items-center gap-[5px] font-martian text-[11px] text-[#C9C2BE] min-w-0">
            <TeamLogo league={league} abbr={team} size={13} />
            {team}
          </div>
          <div className="truncate min-w-0">
            <MatchupNote league={league} opponent={opponent} matchup={matchup} label={label} compact />
          </div>
          {/* Wraps into a clipped second line: a tag that doesn't fit drops out whole
              instead of being cut mid-word. */}
          <div className="flex flex-wrap items-center gap-x-[6px] gap-y-[8px] h-[20px] overflow-hidden min-w-0">
            {showLeague && <LeaguePill league={leagueLabel} />}
            {tags}
          </div>
        </div>
      </div>
      {ticket}
      <div className="sugg-viz">{viz}</div>
      {mark}
    </Link>
  )
}
