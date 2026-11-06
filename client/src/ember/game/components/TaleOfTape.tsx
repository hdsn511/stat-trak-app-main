import type { GameInsights, GameTapeRow, GameTapeSide, TeamRef } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import TeamLogo from '@/ember/components/TeamLogo'
import { teamAccent } from '@/lib/teamBrand'
import { BAD, GOOD } from './insightTones'

/** Which side wins a row: 'away' | 'home' | null for a tie or a missing side. */
function edge(row: GameTapeRow): 'away' | 'home' | null {
  const a = row.away?.value
  const h = row.home?.value
  if (a == null || h == null || a === h) return null
  const awayBetter = row.better === 'higher' ? a > h : a < h
  return awayBetter ? 'away' : 'home'
}

function fmt(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
}

function Cell({ side, align, tone, count }: {
  side: GameTapeSide | null
  align: 'left' | 'right'
  tone: 'good' | 'bad' | null
  count: number
}) {
  if (!side) {
    return <div className={`px-3 py-[9px] font-martian text-[12px] text-[#665F5D] ${align === 'right' ? 'text-right' : ''}`}>—</div>
  }
  const color = tone === 'good' ? GOOD : tone === 'bad' ? BAD : '#EFEBE9'
  const bg = tone === 'good' ? 'rgba(63,191,127,0.10)' : tone === 'bad' ? 'rgba(255,107,92,0.08)' : 'transparent'
  // Rank chip: league-wide context independent of this matchup.
  const third = count / 3
  const rankColor = side.rank <= third ? GOOD : side.rank > count - third ? BAD : '#A8A09C'
  const value = (
    <span className="font-martian font-bold text-[15px] tabular-nums" style={{ color }}>
      {fmt(side.value)}
    </span>
  )
  const rank = (
    <span
      className="font-martian text-[10px] tabular-nums rounded-[3px] px-[5px] py-[1px] border"
      style={{ color: rankColor, borderColor: `${rankColor}55` }}
      title={`Rank ${side.rank} of ${count} (1 = best) · ${side.vs_league >= 0 ? '+' : ''}${Math.round(side.vs_league * 100)}% vs league`}
    >
      #{side.rank}
    </span>
  )
  return (
    <div
      className={`flex items-center gap-2 px-3 py-[9px] ${align === 'right' ? 'justify-end' : 'justify-start'}`}
      style={{ background: bg }}
    >
      {align === 'right' ? (
        <>
          {rank}
          {value}
        </>
      ) : (
        <>
          {value}
          {rank}
        </>
      )}
    </div>
  )
}

function Table({ title, caption, rows, count }: { title: string; caption: string; rows: GameTapeRow[]; count: number }) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_minmax(150px,210px)_1fr] items-center border-t border-[#27221F] bg-[#171311]">
        <span />
        <div className="text-center py-[7px]">
          <div className="font-martian text-[10px] text-[#EFEBE9] tracking-[1.5px]">{title}</div>
          <div className="font-martian text-[9px] text-[#8A827E] tracking-[0.5px] mt-[2px]">{caption}</div>
        </div>
        <span />
      </div>
      {rows.map((r) => {
        const e = edge(r)
        return (
          <div key={r.key} className="grid grid-cols-[1fr_minmax(150px,210px)_1fr] items-stretch border-t border-[#221D1A]">
            <Cell side={r.away} align="right" count={count} tone={e === 'away' ? 'good' : e === 'home' ? 'bad' : null} />
            <div className="flex items-center justify-center px-2 font-martian text-[10px] text-[#C9C2BE] tracking-[1px] text-center border-x border-[#221D1A]">
              {r.label}
              {r.better === 'higher' && title === 'DEFENSE' && <span className="text-[#8A827E] ml-1">↑</span>}
            </div>
            <Cell side={r.home} align="left" count={count} tone={e === 'home' ? 'good' : e === 'away' ? 'bad' : null} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * Tale of the tape: away | metric | home, per game, season to date. The side
 * that wins the row is green and the other red; the rank chip is the league
 * context (1 = best, green top third, red bottom third).
 */
export default function TaleOfTape({ league, insights, home, away }: {
  league: string
  insights: GameInsights
  home: TeamRef
  away: TeamRef
}) {
  const head = (team: TeamRef, align: 'left' | 'right', gp: number) => (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
      style={{ borderTop: `3px solid ${teamAccent(league, team.abbreviation)}` }}
    >
      <TeamLogo league={league} abbr={team.abbreviation} size={30} />
      <div>
        <div className="font-chakra italic font-bold text-[18px] leading-none text-[#EFEBE9]">{team.abbreviation}</div>
        <div className="font-martian text-[10px] text-[#A8A09C] mt-[3px] tracking-[0.5px]">
          {align === 'right' ? 'AWAY' : 'HOME'} · {gp} GP
        </div>
      </div>
    </div>
  )
  const since = new Date(`${insights.season_since}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  return (
    <ModuleCard title="TALE OF THE TAPE" meta={`PER GAME · SINCE ${since} · #RANK OF ${insights.team_count}`}>
      <div className="max-w-[860px] mx-auto">
      <div className="grid grid-cols-[1fr_minmax(150px,210px)_1fr] items-end">
        {head(away, 'right', insights.games_sampled.away)}
        <div className="text-center pb-3 font-martian text-[10px] text-[#8A827E] tracking-[1px]">VS</div>
        {head(home, 'left', insights.games_sampled.home)}
      </div>
      <Table title="DEFENSE" caption="WHAT EACH TEAM ALLOWS · LOWER IS BETTER" rows={insights.defense} count={insights.team_count} />
      <Table title="OFFENSE" caption="WHAT EACH TEAM PRODUCES" rows={insights.offense} count={insights.team_count} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-[18px] py-[10px] border-t border-[#27221F] font-martian text-[10px] text-[#8A827E] tracking-[0.5px]">
        <span><span style={{ color: GOOD }}>■</span> WINS THE ROW</span>
        <span><span style={{ color: BAD }}>■</span> LOSES THE ROW</span>
        <span>↑ = MORE IS BETTER (DEFENSE MADE THE PLAY)</span>
      </div>
      </div>
    </ModuleCard>
  )
}
