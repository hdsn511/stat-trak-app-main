import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import ModuleCard from '@/ember/components/ModuleCard'
import { EmptyState } from '@/ember/components/EntityState'
import { useEntityData } from '@/ember/useEntityData'
import { createLeagueApi, type ProjectPick, type ProjectsResponse } from '@/services/api'
import { formatGameDate, formatGameTime } from '@/ember/game/format'
import { gamePath, playerPath } from '@/lib/paths'

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

function Row({ league, pick }: { league: string; pick: ProjectPick }) {
  const when = [formatGameDate(pick.game.date), formatGameTime(pick.game.time)].filter(Boolean).join(' · ')
  const to = pick.kind === 'prop' ? playerPath(league, pick.entity_id) : gamePath(league, pick.game.id)
  return (
    <Link
      to={to}
      className="grid grid-cols-[1fr_64px_64px] gap-[10px] items-center px-[18px] py-[10px] border-t border-[#221D1A] hover:bg-[#211C1A]"
    >
      <div className="min-w-0">
        <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] truncate">
          {pick.name}{' '}
          <span className="font-martian font-normal text-[11px] text-[#FF6B3D] tracking-[0.5px]">{describe(pick)}</span>
        </div>
        <div className="font-martian text-[11px] text-[#C9C2BE] tracking-[0.5px] mt-[3px] truncate">{reason(pick)}</div>
        <div className="font-martian text-[11px] text-[#8A827E] tracking-[0.5px] mt-[2px] truncate">
          {pick.game.matchup} · {when}
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
      <div className="grid grid-cols-[1fr_64px_64px] gap-[10px] px-[18px] py-2 font-martian text-[10px] text-[#8A827E] tracking-[1px]">
        <span>{label}</span>
        <span className="text-right">HIT</span>
        <span className="text-right">PRICE</span>
      </div>
      {children}
    </div>
  )
}

const band = (b: { min: number; max: number }) => `${Math.round(b.min * 100)}-${Math.round(b.max * 100)}%`

export default function ProjectsCard({ league }: { league: 'nba' | 'nfl' }) {
  const load = useCallback(() => createLeagueApi(league).getProjects(), [league])
  const { data, loading, error } = useEntityData<ProjectsResponse>(load)

  let body
  if (loading) {
    body = <EmptyState compact label="LOADING PROJECTS…" />
  } else if (error || !data) {
    body = <EmptyState compact label={`PROJECTS UNAVAILABLE${error ? `: ${error}` : ''}`} />
  } else if (data.upcoming_games === 0) {
    body = <EmptyState compact label="NO UPCOMING GAMES ON THE SLATE" />
  } else {
    body = (
      <>
        <Section label={`BEST PLAYER PROPS · ${band(data.bands.prop)}`}>
          {data.props.length > 0 ? (
            data.props.map((p) => <Row key={p.id} league={league} pick={p} />)
          ) : (
            <EmptyState compact label="NO PRICED PROPS ON THE SLATE YET" />
          )}
        </Section>
        <Section label={`BEST WINNER · ${band(data.bands.moneyline)}`}>
          {data.moneyline ? (
            <Row league={league} pick={data.moneyline} />
          ) : (
            <EmptyState compact label="NO FAVORITE IN THE BAND ON THE SLATE" />
          )}
        </Section>
      </>
    )
  }

  return (
    <ModuleCard title="Projects" meta="STRAIGHTS · PRICED BY KALSHI">
      {body}
    </ModuleCard>
  )
}
