import type { GameH2HEntry, GameInsights, GameTapeRow, GameTapeSide, TeamRef } from '@/services/api'
import { edge, keyMatchups, type KeyMatchup } from './tape'
import { HeadToHead } from './SidePanels'
import ModuleCard from '@/ember/components/ModuleCard'
import TeamLogo from '@/ember/components/TeamLogo'
import { teamAccent } from '@/lib/teamBrand'
import { formatGameDateYear } from '../format'

function fmt(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
}

function MatchupLine({ m, away, home, league, index }: { m: KeyMatchup; away: TeamRef; home: TeamRef; league: string; index: number }) {
  const off = m.offense === 'away' ? away : home
  const def = m.offense === 'away' ? home : away
  const winner = m.verdict === 'offense' ? off : m.verdict === 'defense' ? def : null
  // Team colour only as a dot: a red team's colour would otherwise read as "bad".
  const dot = winner ? teamAccent(league, winner.abbreviation) : '#665F5D'
  const tag = m.verdict === 'even' ? 'EVEN' : `${winner!.abbreviation} EDGE`
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-[#2C2624] bg-[#1F1A18] px-[12px] py-[10px] animate-fade-up"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span
        className="inline-flex items-center gap-[6px] font-martian font-bold text-[10px] tracking-[1px] rounded-[3px] px-[7px] py-[3px] shrink-0 border border-[#3A3330] text-[#EFEBE9]"
      >
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: dot }} />
        {tag}
      </span>
      <span className="font-schibsted text-[14px] text-[#D8D2CE] leading-snug">
        <b className="text-[#EFEBE9]">{off.abbreviation}</b> offense, #{m.offRank} in {m.stat}, meets{' '}
        <b className="text-[#EFEBE9]">{def.abbreviation}</b> defense, #{m.defRank} at stopping it.
      </span>
    </div>
  )
}

/** The synthesis: who wins more rows, the lanes with the biggest mismatch, and the series. */
function TheRead({ league, insights, away, home, headToHead }: {
  league: string
  insights: GameInsights
  away: TeamRef
  home: TeamRef
  headToHead: GameH2HEntry[]
}) {
  const rows = [...insights.defense, ...insights.offense]
  const awayWins = rows.filter((r) => edge(r) === 'away').length
  const homeWins = rows.filter((r) => edge(r) === 'home').length
  const lead = awayWins === homeWins ? null : awayWins > homeWins ? away : home
  const lanes = keyMatchups(insights)
  const last = headToHead[0]
  const hHome = headToHead.filter((e) => e.winner_team_id === home.id).length
  const hAway = headToHead.length - hHome
  return (
    <div className="px-[18px] py-[14px] border-b border-[#27221F] flex flex-col gap-[10px]">
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1.5px]">THE READ</div>
      <p className="font-schibsted text-[15px] leading-snug text-[#EFEBE9]">
        {lead
          ? `${lead.abbreviation} wins ${Math.max(awayWins, homeWins)} of ${rows.length} categories on the season numbers.`
          : `Dead even: each side wins ${awayWins} of ${rows.length} categories.`}
        {headToHead.length > 0 && last && (
          <span className="text-[#A8A09C]">
            {` Series ${away.abbreviation} ${hAway}–${hHome} ${home.abbreviation}; last met ${formatGameDateYear(last.game_date)}, ${last.away_team.abbreviation} ${last.away_score} @ ${last.home_team.abbreviation} ${last.home_score}.`}
          </span>
        )}
      </p>
      {lanes.length > 0 && (
        <div className="grid gap-[8px] lg:grid-cols-3">
          {lanes.map((m, i) => (
            <MatchupLine key={`${m.offense}-${m.stat}`} index={i} m={m} away={away} home={home} league={league} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One side of a row as a bar growing out from the centre label. Length is league
 * standing (rank 1 = full), so both sides share a scale whatever the stat's units.
 */
function Bar({ side, align, wins, count }: {
  side: GameTapeSide | null
  align: 'left' | 'right'
  wins: boolean
  count: number
}) {
  if (!side) return <div className={`font-martian text-[13px] text-[#665F5D] ${align === 'right' ? 'text-right' : ''}`}>—</div>
  const pct = ((count - side.rank + 1) / count) * 100
  const value = (
    <span className={`font-martian font-bold text-[17px] tabular-nums w-[52px] shrink-0 ${align === 'right' ? 'text-right' : ''}`} style={{ color: wins ? '#EFEBE9' : '#8A827E' }}>
      {fmt(side.value)}
    </span>
  )
  const rank = (
    <span className="font-martian text-[11px] tabular-nums w-[30px] shrink-0 text-[#A8A09C]" title={`Rank ${side.rank} of ${count} (1 = best) · ${side.vs_league >= 0 ? '+' : ''}${Math.round(side.vs_league * 100)}% vs league`}>
      #{side.rank}
    </span>
  )
  return (
    <div className={`flex items-center gap-[8px] ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <div className={`flex-1 h-[10px] rounded-full bg-[#221D1A] overflow-hidden flex ${align === 'right' ? 'justify-end' : ''}`}>
        <div
          className="h-full rounded-full animate-bar-grow-x"
          style={{
            width: `${pct}%`,
            background: wins ? '#3FBF7F' : '#3A3330',
            transformOrigin: align === 'right' ? 'right' : 'left',
          }}
        />
      </div>
      {rank}
      {value}
    </div>
  )
}

function Lanes({ title, caption, rows, count }: {
  title: string
  caption: string
  rows: GameTapeRow[]
  count: number
}) {
  return (
    <div className="px-[18px] py-[12px]">
      <div className="text-center mb-[8px]">
        <span className="font-martian text-[11px] text-[#EFEBE9] tracking-[1.5px]">{title}</span>
        <span className="font-martian text-[10px] text-[#8A827E] tracking-[0.5px] ml-2">{caption}</span>
      </div>
      <div className="flex flex-col gap-[8px]">
        {rows.map((r) => {
          const e = edge(r)
          return (
            <div key={r.key} className="grid grid-cols-[1fr_110px_1fr] items-center gap-3">
              <Bar side={r.away} align="right" wins={e === 'away'} count={count} />
              <div className="text-center font-martian text-[11px] text-[#C9C2BE] tracking-[1px]">{r.label}</div>
              <Bar side={r.home} align="left" wins={e === 'home'} count={count} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Tale of the tape: a written read up top, then each category as two bars
 * growing out from the label. Bar length = league standing; green on the side
 * that wins the row, grey on the side that loses.
 */
export default function TaleOfTape({ league, insights, home, away, headToHead = [] }: {
  league: string
  insights: GameInsights
  home: TeamRef
  away: TeamRef
  headToHead?: GameH2HEntry[]
}) {
  const head = (team: TeamRef, align: 'left' | 'right', gp: number) => (
    <div className={`flex items-center gap-3 px-4 py-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo league={league} abbr={team.abbreviation} size={34} />
      <div>
        <div className="font-chakra italic font-bold text-[22px] leading-none text-[#EFEBE9]">{team.abbreviation}</div>
        <div className="font-martian text-[10px] text-[#A8A09C] mt-[3px] tracking-[0.5px]">
          {align === 'right' ? 'AWAY' : 'HOME'} · {gp} GP
        </div>
      </div>
    </div>
  )
  const since = new Date(`${insights.season_since}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  return (
    <ModuleCard title="TALE OF THE TAPE" meta={`PER GAME · SINCE ${since} · #RANK OF ${insights.team_count}`}>
      <TheRead league={league} insights={insights} away={away} home={home} headToHead={headToHead} />
      <div className="max-w-[880px] w-full mx-auto">
        <div className="grid grid-cols-[1fr_110px_1fr] items-center gap-3 px-[18px]">
          {head(away, 'right', insights.games_sampled.away)}
          <div className="text-center font-martian text-[10px] text-[#8A827E] tracking-[1px]">VS</div>
          {head(home, 'left', insights.games_sampled.home)}
        </div>
        <Lanes title="DEFENSE" caption="WHAT EACH TEAM ALLOWS PER GAME · #1 = STINGIEST" rows={insights.defense} count={insights.team_count} />
        <Lanes title="OFFENSE" caption="WHAT EACH TEAM PRODUCES" rows={insights.offense} count={insights.team_count} />
        <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 px-[18px] pb-[12px] font-martian text-[10px] text-[#8A827E] tracking-[0.5px]">
          <span>LONGER BAR = BETTER LEAGUE RANK (#1 = FULL), NOT A BIGGER NUMBER</span>
          <span>GREEN = WINS THE ROW · GREY = LOSES IT</span>
        </div>
      </div>
      <HeadToHead embedded league={league} entries={headToHead} home={home} away={away} />
    </ModuleCard>
  )
}
