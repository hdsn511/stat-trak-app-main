import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import ModuleCard from '@/ember/components/ModuleCard'
import CardRecord from '@/ember/components/CardRecord'
import { EmptyState } from '@/ember/components/EntityState'
import PlayerAvatar from '@/ember/components/PlayerAvatar'
import TeamLogo from '@/ember/components/TeamLogo'
import { useEntityData } from '@/ember/useEntityData'
import { createLeagueApi, type ProjectPick, type ProjectsResponse } from '@/services/api'
import { formatGameDate, formatGameTime } from '@/ember/game/format'
import { gamePath, playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function describe(p: ProjectPick): string {
  if (p.kind === 'moneyline') return 'TO WIN'
  return `${p.side === 'under' ? 'UNDER' : 'OVER'} ${p.line} ${p.stat_label}`
}

/** The case for the pick in one line: the numbers behind it, not a verdict. */
function reason(p: ProjectPick): string {
  const c = p.context
  if (p.kind === 'moneyline') {
    const elo = c.elo_agrees == null ? null : c.elo_agrees ? 'RATINGS AGREE' : 'RATINGS DISAGREE'
    return [`BOOK ${pct(p.book_prob ?? p.model_prob)}`, elo].filter(Boolean).join(' · ')
  }
  const parts = [
    c.avg20 != null ? `L20 AVG ${c.avg20}` : null,
    c.avg5 != null ? `L5 ${c.avg5}` : null,
    c.hit10 != null ? `${Math.round(c.hit10 * 10)}/10 ${p.side === 'under' ? 'UNDER' : 'OVER'}` : null,
    c.b2b ? 'BACK-TO-BACK' : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

/** "[logo] TOR @ [logo] LAC" */
function Matchup({ league, game }: { league: string; game: ProjectPick['game'] }) {
  if (!game.away || !game.home) return <span>{game.matchup}</span>
  return (
    <span className="inline-flex items-center gap-[5px]">
      <TeamLogo league={league} abbr={game.away} size={14} />
      {game.away}
      <span className="text-[#665F5D]">@</span>
      <TeamLogo league={league} abbr={game.home} size={14} />
      {game.home}
    </span>
  )
}

function Row({ league, pick }: { league: string; pick: ProjectPick }) {
  const when = [formatGameDate(pick.game.date), formatGameTime(pick.game.time)].filter(Boolean).join(' · ')
  const to = pick.kind === 'prop' ? playerPath(league, pick.entity_id) : gamePath(league, pick.game.id)
  return (
    <Link
      to={to}
      className="grid grid-cols-[40px_1fr_60px_60px] gap-[10px] items-center px-[18px] py-[10px] border-t border-[#221D1A] hover:bg-[#211C1A]"
    >
      {pick.kind === 'prop' ? (
        <PlayerAvatar league={league} extId={pick.ext_id} name={pick.name} accent={teamAccent(league, pick.team ?? '')} size={36} />
      ) : (
        <TeamLogo league={league} abbr={pick.team ?? ''} size={36} />
      )}
      <div className="min-w-0">
        <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] truncate flex items-center gap-[6px]">
          {pick.kind === 'prop' && pick.team && <TeamLogo league={league} abbr={pick.team} size={14} />}
          <span className="truncate">{pick.name}</span>
          <span className="font-martian font-normal text-[11px] text-[#FF6B3D] tracking-[0.5px] shrink-0">{describe(pick)}</span>
        </div>
        <div className="font-martian text-[11px] text-[#C9C2BE] tracking-[0.5px] mt-[3px] truncate">{reason(pick)}</div>
        <div className="font-martian text-[11px] text-[#8A827E] tracking-[0.5px] mt-[2px] truncate flex items-center gap-[6px]">
          <Matchup league={league} game={pick.game} />
          <span>· {when}</span>
        </div>
      </div>
      <span className="font-martian font-bold text-[13px] text-[#EFEBE9] text-right tabular-nums">{pct(pick.model_prob)}</span>
      <span className="font-martian text-[12px] text-[#C9C2BE] text-right tabular-nums">{pct(pick.implied_prob)}</span>
    </Link>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="grid grid-cols-[40px_1fr_60px_60px] gap-[10px] px-[18px] py-2 font-martian text-[10px] text-[#8A827E] tracking-[1px]">
        <span className="col-span-2">{label}</span>
        <span className="text-right">HIT</span>
        <span className="text-right">PRICE</span>
      </div>
      {children}
    </div>
  )
}

const band = (b: { min: number; max: number }) => `${Math.round(b.min * 100)}-${Math.round(b.max * 100)}%`

export default function PicksCard({ league, className = '' }: { league: 'nba' | 'nfl'; className?: string }) {
  const load = useCallback(() => createLeagueApi(league).getProjects(), [league])
  const { data, loading, error } = useEntityData<ProjectsResponse>(load)

  let body
  if (loading) {
    body = <EmptyState compact label="LOADING PICKS…" />
  } else if (error || !data) {
    body = <EmptyState compact label={`PICKS UNAVAILABLE${error ? `: ${error}` : ''}`} />
  } else if (data.upcoming_games === 0) {
    body = <EmptyState compact label="NO UPCOMING GAMES ON THE SLATE" />
  } else {
    body = (
      <>
        <Section label={`BEST WINNER · ${band(data.bands.moneyline)}`}>
          {data.moneyline ? (
            <Row league={league} pick={data.moneyline} />
          ) : (
            <EmptyState compact label="NO FAVORITE IN THE BAND ON THE SLATE" />
          )}
        </Section>
        <Section label={`BEST PLAYER PROPS · ${band(data.bands.prop)}`}>
          {data.props.length > 0 ? (
            data.props.map((p) => <Row key={p.id} league={league} pick={p} />)
          ) : (
            <EmptyState compact label="NO PRICED PROPS ON THE SLATE YET" />
          )}
        </Section>
      </>
    )
  }

  return (
    <ModuleCard
      title="PICKS"
      headerRight={<CardRecord meta="STRAIGHTS · PRICED BY KALSHI" record={data?.record} />}
      className={className}
    >
      {body}
    </ModuleCard>
  )
}
