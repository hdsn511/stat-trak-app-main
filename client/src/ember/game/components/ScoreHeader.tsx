import TeamLogo from '@/ember/components/TeamLogo'
import { teamAccent } from '@/lib/teamBrand'
import { Link } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { GameDetail, GameH2HEntry, GameProp, TeamRecord } from '@/services/api'
import { teamPath } from '@/lib/paths'
import { formatGameDate, formatGameDateYear, formatGameTime, formatRecord } from '../format'

interface ScoreHeaderProps {
  league: string
  game: GameDetail['game']
  rest: GameDetail['rest']
  lines?: GameDetail['lines']
  /** Season records, once the insights have loaded. */
  records?: { away: TeamRecord | null; home: TeamRecord | null }
  gameProps?: GameProp[]
  headToHead?: GameH2HEntry[]
  /** Current Kalshi price from the picks pipeline; preferred over daily_lines, whose winner rows can be days old. */
  winnerPrice?: { team: string | null; implied_prob: number } | null
}

/** Kalshi's win price per team, read from the winner tickers (…-POR / …-MIN); the rows carry no team id. */
function kalshiWin(props: GameProp[] | undefined, abbr: string): number | null {
  const p = props?.find((x) => x.prop_type === 'winner' && x.market_ticker.toUpperCase().endsWith(`-${abbr.toUpperCase()}`))
  return p?.implied_prob ?? null
}

/** One fact in the at-a-glance row: caption, one bold value, one line of context. */
function Fact({ caption, value, sub, tip }: { caption: string; value: ReactNode; sub?: ReactNode; tip?: string }) {
  return (
    <div className={`text-center min-w-[96px] ${tip ? 'cursor-help' : ''}`} title={tip}>
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">{caption}</div>
      <div className="font-martian font-bold text-[18px] text-[#EFEBE9] mt-[5px] tabular-nums leading-none whitespace-nowrap">{value}</div>
      {sub && <div className="font-martian text-[10px] text-[#8A827E] mt-[5px] tracking-[0.5px] whitespace-nowrap">{sub}</div>}
    </div>
  )
}

function TeamBlock({
  league,
  team,
  align,
  label,
  record,
}: {
  league: string
  team: { id: number; abbreviation: string; name: string }
  align: 'left' | 'right'
  label: string
  record?: TeamRecord | null
}) {
  return (
    <Link
      to={teamPath(league, team.id)}
      className={`group min-w-0 flex items-center gap-4 ${
        align === 'right' ? 'flex-row-reverse text-right' : 'text-left'
      }`}
    >
      <TeamLogo league={league} abbr={team.abbreviation} size={64} className="hidden sm:block" />
      <div className="min-w-0">
        <div className="font-chakra italic font-bold text-[clamp(22px,3vw,34px)] tracking-[-1px] leading-none text-[#EFEBE9] group-hover:text-[#FF6B3D]">
          {team.abbreviation}
        </div>
        <div className="font-martian text-[11px] text-[#C9C2BE] mt-[5px] whitespace-nowrap overflow-hidden text-ellipsis">
          {team.name}
        </div>
        <div className="font-martian text-[11px] text-[#A8A09C] mt-[3px] tracking-[1px]">
          {label}
          {record && <span className="text-[#EFEBE9] font-bold">{` · ${formatRecord(record)}`}</span>}
        </div>
        <div
          className={`h-[3px] w-10 rounded-full mt-2 ${align === 'right' ? 'ml-auto' : ''}`}
          style={{ background: teamAccent(league, team.abbreviation) }}
        />
      </div>
    </Link>
  )
}

/**
 * Pinned header behaviour: once the page is scrolled, the facts row folds away the
 * instant the pointer leaves (no delay) and unfolds on hover or keyboard focus.
 * The folded height is given back as negative margin so the page never jumps.
 */
function useHoverFold() {
  const [hovered, setHovered] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [factsH, setFactsH] = useState(0)
  const factsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Capture phase: the page scrolls inside a container, not the window.
    const on = (e: Event) => {
      const t = e.target as HTMLElement | Document
      const top = t instanceof Document ? t.documentElement.scrollTop : t.scrollTop
      setScrolled(top > 24)
    }
    window.addEventListener('scroll', on, true)
    return () => window.removeEventListener('scroll', on, true)
  }, [])
  // Measures every render on purpose; setFactsH bails out when the height is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (factsRef.current) setFactsH(factsRef.current.scrollHeight)
  })
  const folded = scrolled && !hovered
  const handlers = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocusCapture: () => setHovered(true),
    onBlurCapture: () => setHovered(false),
  }
  return { folded, handlers, factsRef, factsH }
}

export default function ScoreHeader({ league, game, rest, lines, records, gameProps, headToHead = [], winnerPrice }: ScoreHeaderProps) {
  const { home_team: home, away_team: away, home_score: hs, away_score: as_ } = game
  const final = game.is_completed && hs != null && as_ != null
  const tip = formatGameTime(game.game_time, true)

  const s = lines?.spread_home ?? null
  const signed = (v: number) => (v > 0 ? `+${v}` : `−${Math.abs(v)}`)
  const awayWin = kalshiWin(gameProps, away.abbreviation)
  const homeWin = kalshiWin(gameProps, home.abbreviation)
  const h2hHome = headToHead.filter((e) => e.winner_team_id === home.id).length
  const h2hAway = headToHead.length - h2hHome
  const last = headToHead[0]
  const { folded, handlers, factsRef, factsH } = useHoverFold()
  const facts: ReactNode[] = []
  if (!final && s != null) {
    facts.push(
      <Fact key="spread" caption="SPREAD" sub={lines?.provider?.toUpperCase()}
        value={s === 0 ? 'PICK' : s < 0 ? `${home.abbreviation} ${signed(s)}` : `${away.abbreviation} ${signed(-s)}`}
        tip={s === 0 ? "No favourite: a pick'em" : `Favourite must win by more than ${Math.abs(s)}`} />
    )
  }
  if (!final && lines?.total != null) {
    facts.push(<Fact key="total" caption="TOTAL" value={lines.total} sub="OVER / UNDER" tip={`Combined score line: over or under ${lines.total}`} />)
  }
  if (!final && winnerPrice?.team) {
    facts.push(
      <Fact key="win" caption="KALSHI WIN" value={`${winnerPrice.team} ${Math.round(winnerPrice.implied_prob * 100)}%`}
        sub="LATEST PRICE" tip="Kalshi's price to win, read as a chance" />
    )
  } else if (!final && (awayWin != null || homeWin != null)) {
    const fav = (homeWin ?? 0) >= (awayWin ?? 0) ? { t: home.abbreviation, p: homeWin } : { t: away.abbreviation, p: awayWin }
    const dog = fav.t === home.abbreviation ? { t: away.abbreviation, p: awayWin } : { t: home.abbreviation, p: homeWin }
    facts.push(
      <Fact key="win" caption="KALSHI WIN" value={`${fav.t} ${Math.round((fav.p ?? 0) * 100)}%`}
        sub={dog.p != null ? `${dog.t} ${Math.round(dog.p * 100)}%` : undefined} tip="Kalshi's price to win, read as a chance" />
    )
  }
  if (headToHead.length > 0 && last) {
    const lead = h2hHome === h2hAway ? `${h2hAway}-${h2hHome}` : h2hHome > h2hAway ? `${home.abbreviation} ${h2hHome}-${h2hAway}` : `${away.abbreviation} ${h2hAway}-${h2hHome}`
    facts.push(
      <Fact key="series" caption={`LAST ${headToHead.length} MEETINGS`} value={lead}
        sub={`${formatGameDateYear(last.game_date)}: ${last.away_team.abbreviation} ${last.away_score}-${last.home_score} ${last.home_team.abbreviation}`} />
    )
  }
  if (rest.away_days != null || rest.home_days != null) {
    facts.push(
      <Fact key="rest" caption="REST" value={`${rest.away_days ?? '—'}D · ${rest.home_days ?? '—'}D`}
        sub={`${away.abbreviation} · ${home.abbreviation}`} tip="Days since each team's last game (1D = back-to-back)" />
    )
  }

  const score = (v: number, winning: boolean) => (
    <div
      className={`font-martian font-bold text-[clamp(30px,4vw,46px)] leading-none ${
        winning ? 'text-[#EFEBE9]' : 'text-[#A8A09C]'
      }`}
    >
      {v}
    </div>
  )

  return (
    <div
      {...handlers}
      className="sticky top-0 z-20 bg-[#1B1715] border border-[#2C2624] rounded-lg px-[22px] py-5"
      style={{ marginBottom: folded && facts.length > 0 ? -(factsH + 16) : 0 }}
    >
      <div className="flex items-center justify-center gap-[clamp(12px,3vw,36px)] flex-wrap">
        <div className="flex-1 min-w-[96px] flex justify-end">
          <TeamBlock league={league} team={away} align="right" label="AWAY" record={records?.away} />
        </div>

        {final ? score(as_, as_ >= hs) : null}

        <div className="text-center min-w-[92px] shrink-0">
          <div className="font-martian font-medium text-[12px] text-[#FF6B3D] tracking-[1px]">
            {final ? 'FINAL' : (tip ?? 'SCHEDULED')}
          </div>
          <div className="font-martian text-[10px] text-[#A8A09C] mt-[5px] tracking-[1px]">
            {formatGameDate(game.game_date)}
          </div>
          {/* 'other' is the ESPN ingest's placeholder for NHL and NFL — it
              says nothing, so it isn't worth a chip. */}
          {game.game_type && !['regular', 'other'].includes(game.game_type) && (
            <div className="font-martian text-[10px] text-[#FF6B3D] mt-[3px] tracking-[1px] uppercase">
              {game.game_type}
            </div>
          )}
        </div>

        {final ? score(hs, hs >= as_) : null}

        <div className="flex-1 min-w-[96px] flex justify-start">
          <TeamBlock league={league} team={home} align="left" label="HOME" record={records?.home} />
        </div>
      </div>

      {/* At a glance, the ESPN gamecast row: the market's view (spread, total,
          Kalshi win price) pre-game, then series and rest, which matter either way. */}
      {facts.length > 0 && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none ${
            folded ? 'grid-rows-[0fr] opacity-0 pointer-events-none' : 'grid-rows-[1fr] opacity-100'
          }`}
        >
          <div className="overflow-hidden">
            <div ref={factsRef} className="flex flex-wrap items-start justify-center gap-x-10 gap-y-4 mt-4 pt-4 border-t border-[#27221F]">
              {facts}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
