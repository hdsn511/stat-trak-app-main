import { Link } from 'react-router-dom'
import type { GameInsightInjury, GameInsightNews, GameInsightTeam, TeamRef } from '@/services/api'
import TeamLogo from '@/ember/components/TeamLogo'
import { EmptyState } from '@/ember/components/EntityState'
import { playerPath, teamPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import { formatRecord } from '../format'
import { SubHead } from './insightUi'
import { BAD, EMBER, WARN } from './insightTones'

const STATUS_COLOR: Record<string, string> = {
  out: BAD,
  suspended: BAD,
  doubtful: BAD,
  questionable: WARN,
  'day-to-day': WARN,
  ir: '#8A827E',
  other: '#8A827E',
}

const NEWS_TAG: Record<GameInsightNews['kind'], { label: string; color: string }> = {
  injury: { label: 'HEALTH', color: BAD },
  trade: { label: 'ROSTER', color: WARN },
  news: { label: 'NEWS', color: '#A8A09C' },
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="font-martian font-bold text-[9px] tracking-[1px] rounded-[3px] px-[6px] py-[3px] border shrink-0 whitespace-nowrap"
      style={{ color, borderColor: `${color}66`, background: `${color}14` }}
    >
      {label}
    </span>
  )
}

function InjuryRow({ league, i }: { league: string; i: GameInsightInjury }) {
  const color = STATUS_COLOR[i.status] ?? '#8A827E'
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="font-schibsted font-bold text-[13px] text-[#EFEBE9] truncate">
          {i.name}
          {i.position && <span className="font-martian font-normal text-[10px] text-[#8A827E] ml-[6px]">{i.position}</span>}
        </div>
        {i.injury && <div className="font-martian text-[10px] text-[#A8A09C] mt-[1px] truncate">{i.injury}</div>}
      </div>
      <Chip label={i.status === 'ir' ? 'IR' : i.status_label || i.status.toUpperCase()} color={color} />
    </>
  )
  const cls = 'flex items-center gap-3 px-[18px] py-[7px] border-t border-[#221D1A]'
  return i.player_id ? (
    <Link to={playerPath(league, i.player_id)} className={`${cls} hover:bg-[#211C1A]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function ago(iso: string): string {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600_000)
  if (h < 1) return 'NOW'
  if (h < 24) return `${h}H AGO`
  return `${Math.round(h / 24)}D AGO`
}

function TeamColumn({ league, team, info, side }: {
  league: string
  team: TeamRef
  info: GameInsightTeam
  side: 'away' | 'home'
}) {
  const accent = teamAccent(league, team.abbreviation)
  // Long-term IR lists run long and rarely matter for tonight; they fold to a count.
  const active = info.injuries.filter((i) => i.status !== 'ir')
  const ir = info.injuries.length - active.length
  return (
    <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg overflow-hidden" style={{ borderTop: `3px solid ${accent}` }}>
      <Link
        to={teamPath(league, team.id)}
        className={`flex items-center gap-3 px-[18px] py-[12px] border-b border-[#27221F] hover:bg-[#211C1A] ${side === 'home' ? 'md:flex-row-reverse md:text-right' : ''}`}
      >
        <TeamLogo league={league} abbr={team.abbreviation} size={34} />
        <div className="min-w-0">
          <div className="font-chakra italic font-bold text-[17px] leading-none text-[#EFEBE9] truncate">{team.name}</div>
          <div className="font-martian text-[10px] text-[#A8A09C] mt-[4px] tracking-[1px]">
            {side.toUpperCase()}
            {info.record && ` · ${formatRecord(info.record)}`}
          </div>
        </div>
      </Link>

      <SubHead right={info.injury_source === 'espn' ? 'ESPN' : info.injury_source === 'availability' ? 'TEAM REPORT' : undefined}>
        INJURIES
      </SubHead>
      {active.length === 0 && ir === 0 ? (
        <EmptyState compact label={info.injury_source ? 'NOTHING REPORTED' : 'NO INJURY REPORT AVAILABLE'} />
      ) : (
        <div>
          {active.map((i) => (
            <InjuryRow key={`${i.name}:${i.status}`} league={league} i={i} />
          ))}
          {ir > 0 && (
            <div className="px-[18px] py-[7px] border-t border-[#221D1A] font-martian text-[10px] text-[#8A827E] tracking-[0.5px]">
              + {ir} ON INJURED RESERVE: {info.injuries.filter((i) => i.status === 'ir').map((i) => i.name).join(', ')}
            </div>
          )}
        </div>
      )}

      <SubHead right="LAST 7 DAYS">NEWS</SubHead>
      {info.news.length === 0 ? (
        <EmptyState compact label="NO TEAM-SPECIFIC STORIES THIS WEEK" />
      ) : (
        <div className="pb-1">
          {info.news.map((n) => {
            const tag = NEWS_TAG[n.kind]
            const inner = (
              <>
                <Chip label={tag.label} color={tag.color} />
                <span className="font-schibsted text-[13px] text-[#E2DDDA] leading-snug flex-1 min-w-0">{n.headline}</span>
                <span className="font-martian text-[9px] text-[#8A827E] shrink-0 whitespace-nowrap">{ago(n.published)}</span>
              </>
            )
            const cls = 'flex items-start gap-3 px-[18px] py-[8px] border-t border-[#221D1A]'
            return n.url ? (
              <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className={`${cls} hover:bg-[#211C1A]`}>
                {inner}
              </a>
            ) : (
              <div key={n.id} className={cls}>{inner}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Away team on the left, home on the right, each under its own colour. */
export default function TeamColumns({ league, away, home, awayInfo, homeInfo }: {
  league: string
  away: TeamRef
  home: TeamRef
  awayInfo: GameInsightTeam
  homeInfo: GameInsightTeam
}) {
  return (
    <div>
      <div className="font-chakra italic font-bold text-[13px] text-[#EFEBE9] mb-2 px-1">
        <span style={{ color: EMBER }}>{'// '}</span>TEAM REPORT
      </div>
      <div className="grid gap-[14px] items-start grid-cols-1 md:grid-cols-2">
        <TeamColumn league={league} team={away} info={awayInfo} side="away" />
        <TeamColumn league={league} team={home} info={homeInfo} side="home" />
      </div>
    </div>
  )
}
