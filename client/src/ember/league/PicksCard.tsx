import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import ModuleCard from '@/ember/components/ModuleCard'
import CardRecord from '@/ember/components/CardRecord'
import { EmptyState } from '@/ember/components/EntityState'
import PlayerAvatar from '@/ember/components/PlayerAvatar'
import TeamLogo from '@/ember/components/TeamLogo'
import { useEntityData } from '@/ember/useEntityData'
import { createLeagueApi, type GradedStraight, type ProjectPick, type ProjectsResponse } from '@/services/api'
import { formatGameDate, formatGameTime } from '@/ember/game/format'
import { gamePath, playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import { ImpliedOddsNote, ResultMark } from '@/ember/components/PropVisuals'
import { PickWhy, WhyToggle } from '@/ember/components/PickWhy'

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

const COLS = 'grid-cols-[40px_1fr_60px_60px_52px]'

/** HIT − IMPLIED in percentage points, from the two numbers the row shows. */
function Edge({ pick }: { pick: ProjectPick }) {
  const pts = Math.round((pick.model_prob - pick.implied_prob) * 1000) / 10
  const color = pts > 0 ? '#3FBF7F' : pts < 0 ? '#FF6B5C' : '#A8A09C'
  return (
    <span
      className="font-martian font-bold text-[14px] text-right tabular-nums"
      style={{ color }}
      title={pts < 0 ? 'Model rates this below the Kalshi price' : 'Model rates this above the Kalshi price'}
    >
      {pts > 0 ? '+' : ''}
      {pts.toFixed(1)}
    </span>
  )
}

function Row({ league, pick }: { league: string; pick: ProjectPick }) {
  const when = [formatGameDate(pick.game.date), formatGameTime(pick.game.time)].filter(Boolean).join(' · ')
  const to = pick.kind === 'prop' ? playerPath(league, pick.entity_id, { stat: pick.stat_label, line: pick.line, window: 10 }) : gamePath(league, pick.game.id)
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-[#221D1A]">
    <Link
      to={to}
      className={`grid ${COLS} gap-[10px] items-center px-[18px] py-[10px] hover:bg-[#211C1A] transition-colors`}
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
          <span className="shrink-0 font-normal"><WhyToggle open={open} onToggle={() => setOpen(!open)} /></span>
        </div>
        <div className="font-martian text-[11px] text-[#C9C2BE] tracking-[0.5px] mt-[3px] truncate">{reason(pick)}</div>
        <div className="font-martian text-[11px] text-[#8A827E] tracking-[0.5px] mt-[2px] truncate flex items-center gap-[6px]">
          <Matchup league={league} game={pick.game} />
          <span>· {when}</span>
        </div>
      </div>
      <span className="font-martian font-bold text-[15px] text-[#EFEBE9] text-right tabular-nums">{pct(pick.model_prob)}</span>
      <span className="font-martian text-[14px] text-[#C9C2BE] text-right tabular-nums">{pct(pick.implied_prob)}</span>
      <Edge pick={pick} />
    </Link>
    {open && <PickWhy pick={pick} />}
    </div>
  )
}

const help = 'cursor-help underline decoration-dotted decoration-[#4A4340] underline-offset-[3px]'

function Section({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`grid ${COLS} gap-[10px] px-[18px] py-2 font-martian text-[10px] text-[#8A827E] tracking-[1px]`}>
        <span className="col-span-2"><span className={help} title={hint}>{label}</span></span>
        <span className="text-right"><span className={help} title="Model's chance this pick lands">HIT</span></span>
        <span className="text-right"><span className={help} title="Kalshi price read as a chance (62¢ = 62%)">IMPLIED</span></span>
        <span className="text-right"><span className={help} title="HIT − IMPLIED in % points. Green: model above market. Red: below.">EDGE</span></span>
      </div>
      {children}
    </div>
  )
}

const units = (u: number) => `${u >= 0 ? '+' : ''}${u.toFixed(2)}u`

/** One graded pick from the last slate: who, what was picked, the result, what it paid, W/L. */
function GradedRow({ league, r }: { league: string; r: GradedStraight }) {
  const to = r.kind === 'prop' ? playerPath(league, r.entity_id, { stat: r.stat_label, line: r.line, window: 10 }) : gamePath(league, r.entity_id)
  const what = r.kind === 'moneyline' ? 'TO WIN' : `${r.side === 'under' ? 'UNDER' : 'OVER'} ${r.line} ${r.stat_label}`
  return (
    <Link to={to} className="grid grid-cols-[28px_1fr_auto_44px_56px_30px] gap-3 items-center px-[18px] py-[8px] border-t border-[#221D1A] hover:bg-[#211C1A] transition-colors">
      {r.kind === 'prop' ? (
        <PlayerAvatar league={league} extId={r.ext_id} name={r.name} accent={teamAccent(league, r.team ?? '')} size={26} />
      ) : (
        <TeamLogo league={league} abbr={r.team ?? ''} size={26} />
      )}
      <span className="min-w-0 font-schibsted font-bold text-[14px] text-[#EFEBE9] truncate">{r.name}</span>
      <span className="font-martian text-[11px] text-[#FF6B3D] tracking-[0.5px] whitespace-nowrap">{what}</span>
      <span className="font-martian text-[14px] font-bold text-[#EFEBE9] tabular-nums text-right" title="Actual result">
        {r.kind === 'prop' ? r.actual ?? '—' : ''}
      </span>
      <span
        className="font-martian text-[13px] font-bold tabular-nums text-right"
        style={{ color: r.units >= 0 ? '#3FBF7F' : '#FF6B5C' }}
        title={r.price != null ? `1u at ${Math.round(r.price * 100)}¢` : undefined}
      >
        {units(r.units)}
      </span>
      <ResultMark hit={r.did_hit} actual={r.actual ?? undefined} />
    </Link>
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
        <Section
          label={`BEST WINNER · ${band(data.bands.moneyline)}`}
          hint={`The favourite the model rates most likely to win, among those it gives a ${band(data.bands.moneyline)} chance`}
        >
          {data.moneyline ? (
            <Row league={league} pick={data.moneyline} />
          ) : (
            <EmptyState compact label="NO FAVORITE IN THE BAND ON THE SLATE" />
          )}
        </Section>
        <Section
          label={`BEST PLAYER PROPS · ${band(data.bands.prop)}`}
          hint={`Player lines the model gives a ${band(data.bands.prop)} chance of landing`}
        >
          {data.props.length > 0 ? (
            data.props.map((p) => <Row key={p.id} league={league} pick={p} />)
          ) : (
            <EmptyState compact label="NO PRICED PROPS ON THE SLATE YET" />
          )}
        </Section>
        {/* Swaps only happen before each game starts, so this is the card's final pre-game state. */}
        <details className="border-t border-[#221D1A] group">
          <summary className="cursor-pointer select-none flex items-center gap-2 px-[18px] py-[10px] font-martian text-[10px] text-[#8A827E] tracking-[1px] hover:text-[#EFEBE9]">
            <span>CHANGES TODAY ({data.changes?.length ?? 0})</span>
            <span className="ml-auto text-[#FF6B3D] group-open:hidden">SHOW</span>
            <span className="ml-auto text-[#FF6B3D] hidden group-open:inline">HIDE</span>
          </summary>
          <div className="px-[18px] pb-[8px] font-martian text-[10px] text-[#8A827E]">
            Picks added to or dropped from the card before their game started. Only the card at game start is graded.
          </div>
          {(data.changes ?? []).length === 0 && <EmptyState compact label="NO SWAPS YET TODAY" />}
          {(data.changes ?? []).map((c) => (
            <div key={`${c.id}-${c.at}`} className="flex items-center gap-3 px-[18px] py-[8px] border-t border-[#221D1A]">
              <span className="font-martian text-[10px] text-[#8A827E] tabular-nums w-[58px] shrink-0">{formatGameTime(c.at)}</span>
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
        {data.yesterday && data.yesterday.rows.length > 0 && (
          // The last graded slate: the card's own receipts, one click away.
          <details className="border-t border-[#221D1A] group">
            <summary className="cursor-pointer select-none flex items-center gap-2 px-[18px] py-[10px] font-martian text-[10px] text-[#8A827E] tracking-[1px] hover:text-[#EFEBE9]">
              <span>{`YESTERDAY'S PICKS · ${formatGameDate(data.yesterday.date)}`}</span>
              <span className="font-bold text-[12px] text-[#EFEBE9] tabular-nums">
                {`${data.yesterday.record.w}-${data.yesterday.record.l}`}
              </span>
              <span
                className="font-bold text-[12px] tabular-nums"
                style={{ color: data.yesterday.record.units >= 0 ? '#3FBF7F' : '#FF6B5C' }}
              >
                {units(data.yesterday.record.units)}
              </span>
              <span className="ml-auto text-[#FF6B3D] group-open:hidden">SHOW</span>
              <span className="ml-auto text-[#FF6B3D] hidden group-open:inline">HIDE</span>
            </summary>
            <div className="animate-fade-up">
              {data.yesterday.rows.map((r) => (
                <GradedRow key={r.id} league={league} r={r} />
              ))}
            </div>
          </details>
        )}
        <ImpliedOddsNote model />
      </>
    )
  }

  return (
    <ModuleCard
      title="PICKS"
      headerRight={<CardRecord
          meta="STRAIGHTS · PRICED BY KALSHI"
          record={data?.record}
          label="RECORD"
          title="Every pick on the card at game start, graded. Units: 1u flat per straight at its Kalshi price."
        />}
      className={className}
    >
      {body}
    </ModuleCard>
  )
}
