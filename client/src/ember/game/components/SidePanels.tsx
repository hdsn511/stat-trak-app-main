import { Link } from 'react-router-dom'
import type { GameH2HEntry, GameInjury, TeamRef } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import { gamePath, playerPath } from '@/lib/paths'
import { formatGameDate } from '../format'

const STATUS_STYLE: Record<GameInjury['status'], string> = {
  out: 'text-[#FF6B5C] border-[rgba(255,107,92,0.4)] bg-[rgba(255,107,92,0.08)]',
  gtd: 'text-[#FFB020] border-[rgba(255,176,32,0.4)] bg-[rgba(255,176,32,0.08)]',
  questionable: 'text-[#FFB020] border-[rgba(255,176,32,0.4)] bg-[rgba(255,176,32,0.08)]',
}

export function InjuryList({ league, injuries }: { league: string; injuries: GameInjury[] }) {
  if (injuries.length === 0) return null

  return (
    <ModuleCard title="AVAILABILITY" meta={`${injuries.length} LISTED`}>
      <div className="max-h-[360px] overflow-y-auto">
        {injuries.map((inj) => (
          <Link
            key={inj.player_id}
            to={playerPath(league, inj.player_id)}
            className="flex items-center gap-3 px-[18px] py-[11px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
          >
            <div className="min-w-0 flex-1">
              <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                {inj.name ?? `#${inj.player_id}`}
              </div>
              <div className="font-martian text-[10px] text-[#A8A09C] mt-[2px]">
                {[inj.team, inj.position].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <span
              className={`font-martian font-bold text-[10px] tracking-[1px] border rounded-[3px] px-[7px] py-[3px] shrink-0 ${STATUS_STYLE[inj.status]}`}
            >
              {inj.status.toUpperCase()}
            </span>
          </Link>
        ))}
      </div>
    </ModuleCard>
  )
}

interface HeadToHeadProps {
  league: string
  entries: GameH2HEntry[]
  home: TeamRef
  away: TeamRef
}

export function HeadToHead({ league, entries, home, away }: HeadToHeadProps) {
  if (entries.length === 0) return null

  const homeWins = entries.filter((e) => e.winner_team_id === home.id).length
  const awayWins = entries.length - homeWins

  return (
    <ModuleCard
      title="HEAD TO HEAD"
      meta={`${away.abbreviation} ${awayWins}–${homeWins} ${home.abbreviation}`}
    >
      <div className="max-h-[360px] overflow-y-auto">
        {entries.map((e) => {
          const awayWon = e.winner_team_id === e.away_team.id
          return (
            <Link
              key={e.game_id}
              to={gamePath(league, e.game_id)}
              className="flex items-center gap-3 px-[18px] py-[10px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
            >
              <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px] w-[74px] shrink-0">
                {formatGameDate(e.game_date)}
              </span>
              <span
                className={`font-martian font-bold text-[13px] ${awayWon ? 'text-[#EFEBE9]' : 'text-[#A8A09C]'}`}
              >
                {e.away_team.abbreviation} {e.away_score}
              </span>
              <span className="font-martian text-[11px] text-[#8A827E]">@</span>
              <span
                className={`font-martian font-bold text-[13px] ${!awayWon ? 'text-[#EFEBE9]' : 'text-[#A8A09C]'}`}
              >
                {e.home_team.abbreviation} {e.home_score}
              </span>
            </Link>
          )
        })}
      </div>
    </ModuleCard>
  )
}
