import { Link } from 'react-router-dom'
import type { GameDetail } from '@/services/api'
import { teamPath } from '@/lib/paths'
import { formatGameDate, formatGameTime } from '../format'

interface ScoreHeaderProps {
  league: string
  game: GameDetail['game']
  rest: GameDetail['rest']
}

function TeamBlock({
  league,
  team,
  align,
  label,
}: {
  league: string
  team: { id: number; abbreviation: string; name: string }
  align: 'left' | 'right'
  label: string
}) {
  return (
    <Link
      to={teamPath(league, team.id)}
      className={`group min-w-0 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <div className="font-chakra italic font-bold text-[clamp(22px,3vw,34px)] tracking-[-1px] leading-none text-[#EFEBE9] group-hover:text-[#FF6B3D]">
        {team.abbreviation}
      </div>
      <div className="font-martian text-[9px] text-[#9A918F] mt-[5px] whitespace-nowrap overflow-hidden text-ellipsis">
        {team.name}
      </div>
      <div className="font-martian text-[8px] text-[#665F5D] mt-[2px] tracking-[1px]">{label}</div>
    </Link>
  )
}

export default function ScoreHeader({ league, game, rest }: ScoreHeaderProps) {
  const { home_team: home, away_team: away, home_score: hs, away_score: as_ } = game
  const final = game.is_completed && hs != null && as_ != null
  const tip = formatGameTime(game.game_time)

  const score = (v: number, winning: boolean) => (
    <div
      className={`font-martian font-bold text-[clamp(30px,4vw,46px)] leading-none ${
        winning ? 'text-[#EFEBE9]' : 'text-[#665F5D]'
      }`}
    >
      {v}
    </div>
  )

  return (
    <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg px-[22px] py-5">
      <div className="flex items-center justify-center gap-[clamp(12px,3vw,36px)] flex-wrap">
        <div className="flex-1 min-w-[96px] flex justify-end">
          <TeamBlock league={league} team={away} align="right" label="AWAY" />
        </div>

        {final ? score(as_, as_ >= hs) : null}

        <div className="text-center min-w-[92px] shrink-0">
          <div className="font-martian font-medium text-[10px] text-[#FF6B3D] tracking-[1px]">
            {final ? 'FINAL' : (tip ?? 'SCHEDULED')}
          </div>
          <div className="font-martian text-[8px] text-[#665F5D] mt-[5px] tracking-[1px]">
            {formatGameDate(game.game_date)}
          </div>
          {/* 'other' is the ESPN ingest's placeholder for NHL and NFL — it
              says nothing, so it isn't worth a chip. */}
          {game.game_type && !['regular', 'other'].includes(game.game_type) && (
            <div className="font-martian text-[8px] text-[#FF6B3D] mt-[3px] tracking-[1px] uppercase">
              {game.game_type}
            </div>
          )}
        </div>

        {final ? score(hs, hs >= as_) : null}

        <div className="flex-1 min-w-[96px] flex justify-start">
          <TeamBlock league={league} team={home} align="left" label="HOME" />
        </div>
      </div>

      {(rest.away_days != null || rest.home_days != null) && (
        <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-[#27221F]">
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">
            {away.abbreviation} REST {rest.away_days ?? '—'}D
          </span>
          <span className="font-martian text-[8px] text-[#443E3B]">·</span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">
            {home.abbreviation} REST {rest.home_days ?? '—'}D
          </span>
        </div>
      )}
    </div>
  )
}
