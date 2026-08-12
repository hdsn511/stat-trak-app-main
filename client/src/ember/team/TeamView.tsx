import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { TeamDetail, TeamGameEntry, TeamRecord } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import { EmptyState } from '@/ember/components/EntityState'
import { gamePath, playerPath } from '@/lib/paths'
import { formatGameDate, formatRecord } from '@/ember/game/format'

const RESULT_COLOR: Record<'W' | 'L' | 'T', string> = {
  W: 'text-[#4ADE80]',
  L: 'text-[#FF6B5C]',
  T: 'text-[#9A918F]',
}

function RecordCell({ label, record }: { label: string; record: TeamRecord }) {
  return (
    <div className="px-[18px] py-[14px] text-center">
      <div className="font-martian font-bold text-[18px] text-[#EFEBE9] tabular-nums">
        {formatRecord(record)}
      </div>
      <div className="font-martian text-[8px] text-[#665F5D] tracking-[1px] mt-[5px]">{label}</div>
    </div>
  )
}

function GameRow({ league, game }: { league: string; game: TeamGameEntry }) {
  const opp = game.is_home ? game.away_team : game.home_team
  const played = game.result != null

  return (
    <Link
      to={gamePath(league, game.id)}
      className="grid grid-cols-[74px_18px_1fr_auto_28px] gap-3 items-center px-[18px] py-[10px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
    >
      <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">
        {formatGameDate(game.game_date)}
      </span>
      <span className="font-martian text-[9px] text-[#443E3B]">{game.is_home ? 'vs' : '@'}</span>
      <span className="font-schibsted font-bold text-[12px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
        {opp.abbreviation}
      </span>
      {played ? (
        <span className="font-martian text-[11px] text-[#9A918F] tabular-nums">
          {game.team_score}–{game.opp_score}
        </span>
      ) : (
        <span className="font-martian text-[9px] text-[#FF6B3D] tracking-[1px]">UPCOMING</span>
      )}
      <span
        className={`font-martian font-bold text-[11px] text-center ${
          game.result ? RESULT_COLOR[game.result] : 'text-[#443E3B]'
        }`}
      >
        {game.result ?? '–'}
      </span>
    </Link>
  )
}

/** Rows shown before the schedule needs a "show all". A full season is 80+. */
const SCHEDULE_PREVIEW = 20

export default function TeamView({ data }: { data: TeamDetail }) {
  const { league, team, record } = data
  const [allGames, setAllGames] = useState(false)

  const upcoming = data.games.filter((g) => g.result == null)
  const played = data.games.filter((g) => g.result != null)
  // Next games first, then most recent results.
  const ordered = [...upcoming].reverse().concat(played)
  const shown = allGames ? ordered : ordered.slice(0, SCHEDULE_PREVIEW)

  return (
    <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-[14px] px-8 pt-6 pb-11">
      {/* Identity */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-chakra italic font-bold text-[clamp(24px,3.2vw,36px)] tracking-[-1px] leading-none text-[#EFEBE9]">
            {team.name}
          </div>
          <div className="font-martian text-[10px] text-[#9A918F] mt-[7px] tracking-[0.5px]">
            {[team.abbreviation, league.toUpperCase(), `${formatRecord(record.overall)} OVERALL`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>

      <ModuleCard title="RECORD" meta="SEASON TO DATE">
        <div
          className="grid divide-x divide-[#27221F]"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}
        >
          <RecordCell label="OVERALL" record={record.overall} />
          <RecordCell label="HOME" record={record.home} />
          <RecordCell label="AWAY" record={record.away} />
          <RecordCell label="LAST 10" record={record.last10} />
        </div>
      </ModuleCard>

      <div className="grid gap-[14px] lg:grid-cols-[1fr_380px] items-start">
        <ModuleCard
          title="SCHEDULE"
          meta={`${played.length} PLAYED · ${upcoming.length} UPCOMING`}
        >
          {data.games.length === 0 ? (
            <EmptyState label="NO GAMES FOUND THIS SEASON" compact />
          ) : (
            shown.map((g) => <GameRow key={g.id} league={league} game={g} />)
          )}
          {ordered.length > SCHEDULE_PREVIEW && (
            <button
              type="button"
              onClick={() => setAllGames((v) => !v)}
              className="block w-full text-center p-3 border-t border-[#27221F] font-martian font-bold text-[10px] text-[#FF6B3D] tracking-[1.5px] hover:text-[#FFD9C9] cursor-pointer"
            >
              {allGames
                ? `SHOW ${SCHEDULE_PREVIEW} ↑`
                : `SHOW ALL ${ordered.length} GAMES ↓`}
            </button>
          )}
        </ModuleCard>

        <ModuleCard title="ROSTER" meta={`${data.roster.length} ACTIVE`}>
          {data.roster.length === 0 ? (
            <EmptyState label="NO ACTIVE PLAYERS LISTED" compact />
          ) : (
            data.roster.map((p) => (
              <Link
                key={p.id}
                to={playerPath(league, p.id)}
                className="flex items-center gap-3 px-[18px] py-[9px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
              >
                <span className="font-schibsted font-bold text-[12px] text-[#EFEBE9] flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
                  {p.name}
                </span>
                <span className="font-martian text-[9px] text-[#665F5D] shrink-0">
                  {p.position}
                </span>
              </Link>
            ))
          )}
        </ModuleCard>
      </div>
    </div>
  )
}
