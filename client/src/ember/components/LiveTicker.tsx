import { Fragment, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { gamePath } from '@/lib/paths'
import LeaguePill from './LeaguePill'
import TeamLogo from './TeamLogo'

export type TickerGame = {
  id: string
  /** Database game id. Null when the slate row has no matching DB game. */
  dbId?: number | null
  /** League slug, for routing. */
  slug?: string
  league?: string
  /** Slate date; may not be today when the server fell back to the next one. */
  date?: string | null
  away: string
  home: string
  awayScore?: number
  homeScore?: number
  status: string
  live?: boolean
}

interface LiveTickerProps {
  label: string
  games: TickerGame[]
  /** Shown in place of the games when the slate is empty. */
  emptyLabel?: string
  /** Overrides the default link-to-game behaviour (SportQuery uses this). */
  onGameClick?: (g: TickerGame) => void
}

const WRAPPER =
  'flex items-center gap-[14px] pl-[28px] border-b border-b-[#3A2A22] overflow-hidden shrink-0'
const STRIPES =
  'repeating-linear-gradient(90deg, transparent 0, transparent 7px, rgba(255,107,61,0.03) 7px, rgba(255,107,61,0.03) 8px)'
const CHIP =
  'flex items-center gap-2 bg-[#1B1715] border border-[#2C2624] hover:border-[#FF6B3D] rounded px-[10px] py-[6px] cursor-pointer whitespace-nowrap shrink-0'

const TODAY = () => new Date().toISOString().slice(0, 10)

/** "NOV 8" — short enough to sit inside a ticker chip. */
function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

function ChipBody({ g }: { g: TickerGame }) {
  // Leagues are rarely on the same slate, so a chip from another day says so.
  const offDay = g.date && g.date !== TODAY()
  return (
    <>
      {g.league && <LeaguePill league={g.league} />}
      {offDay && (
        <span className="font-martian text-[10px] text-[#968E8A] tracking-[0.5px]">
          {shortDate(g.date!)}
        </span>
      )}
      {g.live && <span className="w-[6px] h-[6px] rounded-full bg-[#FF6B3D] shrink-0" />}
      {g.slug && <TeamLogo league={g.slug} abbr={g.away} size={18} />}
      <span className="font-martian font-bold text-[13px] text-[#EFEBE9]">{g.away}</span>
      {g.awayScore !== undefined && (
        <span className="font-martian font-bold text-[13px] text-[#EFEBE9]">{g.awayScore}</span>
      )}
      <span className="font-martian text-[11px] text-[#A8A09C]">@</span>
      {g.slug && <TeamLogo league={g.slug} abbr={g.home} size={18} />}
      <span className="font-martian font-bold text-[13px] text-[#EFEBE9]">{g.home}</span>
      {g.homeScore !== undefined && (
        <span className="font-martian font-bold text-[13px] text-[#EFEBE9]">{g.homeScore}</span>
      )}
      <span
        className={`font-martian font-medium text-[11px] ${g.live ? 'text-[#FF6B3D]' : 'text-[#A8A09C]'}`}
      >
        {g.status}
      </span>
    </>
  )
}

function LaneDivider() {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      className="block w-[2px] h-[22px] rounded-full shrink-0"
      style={{
        background: 'linear-gradient(180deg, transparent, #FF6B3D 30%, #FF6B3D 70%, transparent)',
      }}
    />
  )
}

/** Games grouped by league, in first-seen order, so each league reads as one lane. */
function groupByLeague(games: TickerGame[]): [string, TickerGame[]][] {
  const lanes = new Map<string, TickerGame[]>()
  for (const g of games) {
    const key = g.league ?? ''
    lanes.set(key, [...(lanes.get(key) ?? []), g])
  }
  return [...lanes.entries()]
}

const DRIFT_PX_PER_SEC = 22
const RESUME_AFTER_MS = 2500

/**
 * Slowly drifts a scroll container sideways. Pauses while the pointer is over
 * it or the user is scrolling/touching, resumes after a short idle, and wraps
 * at the halfway point (the content is rendered twice). Does nothing under
 * prefers-reduced-motion.
 */
function useAutoScroll(ref: React.RefObject<HTMLDivElement>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let last = performance.now()
    let hovering = false
    let pausedUntil = 0
    let pos = el.scrollLeft

    const pause = () => {
      pausedUntil = performance.now() + RESUME_AFTER_MS
    }
    const onEnter = () => (hovering = true)
    const onLeave = () => {
      hovering = false
      pause()
    }
    const onUser = () => {
      pause()
      pos = el.scrollLeft
    }

    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (!hovering && now > pausedUntil) {
        pos += DRIFT_PX_PER_SEC * dt
        const half = el.scrollWidth / 2
        if (half > 0 && pos >= half) pos -= half
        el.scrollLeft = pos
      }
      raf = requestAnimationFrame(tick)
    }

    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    el.addEventListener('wheel', onUser, { passive: true })
    el.addEventListener('touchstart', onUser, { passive: true })
    el.addEventListener('pointerdown', onUser)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      el.removeEventListener('wheel', onUser)
      el.removeEventListener('touchstart', onUser)
      el.removeEventListener('pointerdown', onUser)
    }
  }, [ref, enabled])
}

export default function LiveTicker({ label, games, emptyLabel, onGameClick }: LiveTickerProps) {
  const lanes = groupByLeague(games)
  const scroller = useRef<HTMLDivElement>(null)
  // Scroll only when there is enough to overflow; a short slate stays put.
  const moving = games.length > 4
  useAutoScroll(scroller, moving)
  const renderLanes = (copy: number) =>
    lanes.map(([league, items], laneIdx) => (
      <Fragment key={`${copy}-${league}`}>
        {/* Vertical rule centred between lanes: equal space either side and
            vertically centred by the row's items-center. */}
        {(laneIdx > 0 || copy > 0) && <LaneDivider />}
        <div className="flex items-center gap-[10px] shrink-0">
          {items.map((g) =>
            // A game without a database id can't be opened, and an explicit
            // handler takes precedence over navigation.
            !onGameClick && g.dbId && g.slug ? (
              <Link key={g.id} to={gamePath(g.slug, g.dbId)} className={CHIP}>
                <ChipBody g={g} />
              </Link>
            ) : (
              <button key={g.id} type="button" onClick={() => onGameClick?.(g)} className={CHIP}>
                <ChipBody g={g} />
              </button>
            )
          )}
        </div>
      </Fragment>
    ))

  return (
    <div className={WRAPPER} style={{ backgroundImage: STRIPES }}>
      <span className="font-martian font-medium text-[11px] text-[#FF6B3D] tracking-[1.5px] shrink-0">
        {label}
      </span>

      {games.length === 0 && emptyLabel && (
        <span className="font-martian text-[11px] text-[#8A827E] tracking-[1.5px] shrink-0 py-[14px]">
          {emptyLabel}
        </span>
      )}

      {games.length > 0 && (
        // A real scroll container: the drift is a slow scrollLeft nudge, so the
        // user can wheel, drag-scroll or swipe it themselves at any time.
        <div ref={scroller} className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <div className="flex w-max items-center gap-[18px] py-[9px]">
            {renderLanes(0)}
            {/* Duplicate so the drift can wrap without a visible jump. */}
            {moving && (
              <div aria-hidden className="contents">
                {renderLanes(1)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
