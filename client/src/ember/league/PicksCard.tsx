import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import ModuleCard from '@/ember/components/ModuleCard'
import CardRecord from '@/ember/components/CardRecord'
import { EmptyState } from '@/ember/components/EntityState'
import PlayerAvatar from '@/ember/components/PlayerAvatar'
import TeamLogo from '@/ember/components/TeamLogo'
import { useEntityData } from '@/ember/useEntityData'
import { createLeagueApi, type GradedStraight, type ProjectPick, type ProjectsResponse } from '@/services/api'
import { YesterdayDropdown, WinLoss } from '@/ember/components/YesterdayResults'
import { formatUnits } from '@/ember/data/results'
import { formatGameDate, formatGameTime } from '@/ember/game/format'
import { gamePath, playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import { ImpliedOddsNote } from '@/ember/components/PropVisuals'

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

/** STARTED / FINAL / VOID, for a pick whose game has tipped or that no longer counts. */
function PhaseTag({ pick }: { pick: ProjectPick }) {
  const label = pick.void ? `VOID · ${pick.void.toUpperCase()}` : pick.status === 'started' ? 'STARTED' : pick.status === 'final' ? 'FINAL' : null
  if (!label) return null
  return (
    <span
      className={`font-martian font-bold text-[10px] tracking-[0.5px] rounded-[3px] px-[5px] py-[1px] shrink-0 ${
        pick.void ? 'text-[#A8A09C] border border-[#3A3330]' : 'text-[#14100F] bg-[#FF6B3D]'
      }`}
    >
      {label}
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
          <PhaseTag pick={pick} />
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
        <span className="text-right">IMPLIED</span>
      </div>
      {children}
    </div>
  )
}

/** Yesterday's graded straights: what was picked, the result, and what it paid. */
function YesterdayPicks({ league, data }: { league: string; data: NonNullable<ProjectsResponse['yesterday']> }) {
  const { w, l, units } = data.record
  return (
    <YesterdayDropdown
      label="YESTERDAY'S PICKS"
      summary={
        <>
          {w}-{l}
          <span className={units >= 0 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}>{formatUnits(units)}</span>
        </>
      }
    >
      {data.rows.map((r) => (
        <GradedRow key={r.id} league={league} r={r} />
      ))}
    </YesterdayDropdown>
  )
}

function GradedRow({ league, r }: { league: string; r: GradedStraight }) {
  const to = r.kind === 'prop' ? playerPath(league, r.entity_id) : gamePath(league, r.entity_id)
  const what = r.kind === 'moneyline' ? 'TO WIN' : `${r.side === 'under' ? 'U' : 'O'} ${r.line} ${r.stat_label}`
  return (
    <Link to={to} className="flex items-center gap-3 px-[18px] py-[8px] border-t border-[#221D1A] hover:bg-[#211C1A]">
      {r.kind === 'prop' ? (
        <PlayerAvatar league={league} extId={r.ext_id} name={r.name} accent={teamAccent(league, r.team ?? '')} size={26} />
      ) : (
        <TeamLogo league={league} abbr={r.team ?? ''} size={26} />
      )}
      <span className="min-w-0 flex-1 font-schibsted text-[13px] text-[#EFEBE9] truncate">{r.name}</span>
      <span className="font-martian text-[11px] text-[#C9C2BE] tabular-nums whitespace-nowrap">{what}</span>
      <span className="font-martian text-[11px] text-[#C9C2BE] tabular-nums w-[34px] text-right">
        {r.kind === 'prop' ? r.actual : ''}
      </span>
      <span
        className={`font-martian text-[11px] tabular-nums w-[48px] text-right ${r.units >= 0 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}`}
      >
        {formatUnits(r.units)}
      </span>
      <WinLoss hit={r.did_hit} />
    </Link>
  )
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

/** When the card stops changing, or that it already has. */
function LockLine({ card }: { card: NonNullable<ProjectsResponse['card']> }) {
  if (!card.locks_at) return null
  return (
    <div className="px-[18px] py-2 border-b border-[#221D1A] font-martian text-[10px] tracking-[1px] text-[#A8A09C]">
      {card.locked ? (
        <span>
          <span className="text-[#EFEBE9] font-bold">CARD FINAL</span> · LOCKED {clock(card.locks_at)} ET, AN HOUR BEFORE THE
          FIRST TIP
        </span>
      ) : (
        <span>
          UPDATES UNTIL <span className="text-[#EFEBE9] font-bold">{clock(card.locks_at)} ET</span> · FINAL AN HOUR BEFORE
          THE FIRST TIP
        </span>
      )}
    </div>
  )
}

/** Every swap made on today's card, with when and why. */
function Changes({ changes }: { changes: NonNullable<ProjectsResponse['card']>['changes'] }) {
  if (changes.length === 0) return null
  const ins = changes.filter((c) => c.kind === 'in').length
  return (
    <YesterdayDropdown
      label="CHANGES TODAY"
      summary={
        <>
          {changes.length}
          <span className="font-normal text-[#A8A09C]">
            <span className="text-[#3FBF7F]">{ins} IN</span> · <span className="text-[#FF6B5C]">{changes.length - ins} OUT</span>
          </span>
        </>
      }
    >
      {changes.map((c) => (
        <div
          key={`${c.kind}-${c.pick.id}-${c.at}`}
          className="grid grid-cols-[64px_34px_1fr] gap-[10px] items-baseline px-[18px] py-[6px] border-t border-[#221D1A] font-martian text-[11px]"
        >
          <span className="text-[#8A827E] tabular-nums">{clock(c.at)}</span>
          <span className={`font-bold ${c.kind === 'out' ? 'text-[#FF6B5C]' : 'text-[#3FBF7F]'}`}>
            {c.kind === 'out' ? 'OUT' : 'IN'}
          </span>
          <span className="min-w-0 text-[#C9C2BE]">
            <span className="font-schibsted font-bold text-[13px] text-[#EFEBE9]">{c.pick.name}</span> {describe(c.pick)}
            {c.reason && <span className="text-[#A8A09C]"> — {c.reason}</span>}
          </span>
        </div>
      ))}
    </YesterdayDropdown>
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
  } else if (data.upcoming_games === 0 && data.props.length === 0 && !data.moneyline) {
    body = <EmptyState compact label="NO UPCOMING GAMES ON THE SLATE" />
  } else {
    body = (
      <>
        {data.card && <LockLine card={data.card} />}
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
        {data.changes && data.changes.length > 0 && (
          <details className="border-t border-[#221D1A] group">
            <summary className="cursor-pointer select-none px-[18px] py-[10px] font-martian text-[10px] text-[#8A827E] tracking-[1px] hover:text-[#EFEBE9]">
              CHANGES TODAY ({data.changes.length})
            </summary>
            {data.changes.map((c) => (
              <div key={`${c.id}-${c.at}`} className="flex items-center gap-3 px-[18px] py-[8px] border-t border-[#221D1A]">
                <span
                  className="font-martian font-bold text-[10px] tracking-[1px] w-[64px] shrink-0"
                  style={{ color: c.change === 'added' ? '#3FBF7F' : '#FF6B5C' }}
                >
                  {c.change === 'added' ? 'ADDED' : 'REMOVED'}
                </span>
                <span className="font-martian text-[12px] text-[#EFEBE9] truncate">
                  {c.name} <span className="text-[#FF6B3D]">{describe(c)}</span>
                </span>
              </div>
            ))}
          </details>
        )}
        <ImpliedOddsNote />
      </>
    )
  }

  return (
    <ModuleCard
      title="PICKS"
      headerRight={
        <CardRecord meta="STRAIGHTS · PRICED BY KALSHI" label="ALL-TIME" record={data?.record} units={data?.record.units} />
      }
      className={className}
    >
      {body}
      {data?.card && <Changes changes={data.card.changes} />}
      {data?.yesterday && <YesterdayPicks league={league} data={data.yesterday} />}
    </ModuleCard>
  )
}
