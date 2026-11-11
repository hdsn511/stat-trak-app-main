import { Fragment, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { gamePath } from '@/lib/paths'
import type { TeamFormSummary } from '@/services/api'
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
  /** Scheduled start (ISO). */
  time?: string | null
  awayForm?: TeamFormSummary | null
  homeForm?: TeamFormSummary | null
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
/** Pointer travel before a press becomes a drag (and the click is swallowed). */
const DRAG_THRESHOLD_PX = 5

/**
 * Drifts a scroll container sideways, endlessly: the content is rendered twice
 * and the position wraps at the halfway point, in both directions. It stops only
 * while the cursor is over it or a finger is on it, and starts again the moment
 * that ends. It can be grabbed and dragged with the mouse, swiped on touch, and
 * wheel-scrolled. Under prefers-reduced-motion it doesn't drift, but can still be
 * dragged and scrolled.
 */
function useAutoScroll(ref: React.RefObject<HTMLDivElement>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const drift = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let last = performance.now()
    let hovering = false
    let touching = false
    let pos = el.scrollLeft
    // Mouse drag state.
    let dragId: number | null = null
    let dragStartX = 0
    let dragStartPos = 0
    let dragged = false

    const half = () => el.scrollWidth / 2
    /** Keep the position inside [0, half) so the loop never hits an edge. */
    const wrap = (p: number) => {
      const h = half()
      if (h <= 0) return p
      return ((p % h) + h) % h
    }
    const setPos = (p: number) => {
      pos = wrap(p)
      el.scrollLeft = pos
    }

    const onEnter = () => (hovering = true)
    const onLeave = () => {
      hovering = false
      last = performance.now()
    }
    const onTouchStart = () => (touching = true)
    const onTouchEnd = () => {
      touching = false
      pos = wrap(el.scrollLeft)
      last = performance.now()
    }
    // Wheel and swipe scroll natively; adopt where they land, and loop at the edges.
    const onScroll = () => {
      if (dragId != null) return
      // Our own drift write (scrollLeft may round it): keep the precise position.
      if (Math.abs(el.scrollLeft - pos) < 1.5) return
      const h = half()
      if (h > 0 && (el.scrollLeft <= 0 || el.scrollLeft >= h)) el.scrollLeft = wrap(el.scrollLeft)
      pos = el.scrollLeft
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      dragId = e.pointerId
      dragStartX = e.clientX
      dragStartPos = el.scrollLeft
      dragged = false
    }
    const onPointerMove = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return
      const dx = e.clientX - dragStartX
      if (!dragged && Math.abs(dx) < DRAG_THRESHOLD_PX) return
      if (!dragged) {
        dragged = true
        el.setPointerCapture(e.pointerId)
        el.style.cursor = 'grabbing'
      }
      setPos(dragStartPos - dx)
    }
    const endDrag = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return
      dragId = null
      el.style.cursor = ''
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    // A drag that started on a chip must not also open the game.
    const onClickCapture = (e: MouseEvent) => {
      if (!dragged) return
      e.preventDefault()
      e.stopPropagation()
      dragged = false
    }
    // Links are natively draggable; that would hijack the grab.
    const onDragStart = (e: DragEvent) => e.preventDefault()

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      if (drift && !hovering && !touching && dragId == null) setPos(pos + DRIFT_PX_PER_SEC * dt)
      raf = requestAnimationFrame(tick)
    }

    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('click', onClickCapture, true)
    el.addEventListener('dragstart', onDragStart)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('click', onClickCapture, true)
      el.removeEventListener('dragstart', onDragStart)
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
              onGameClick ? (
                <button key={g.id} type="button" onClick={() => onGameClick(g)} className={CHIP}>
                  <ChipBody g={g} />
                </button>
              ) : (
                <div key={g.id} className={CHIP}>
                  <ChipBody g={g} />
                </div>
              )
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
        // user can wheel it, grab and drag it, or swipe it at any time.
        <div ref={scroller} className={`flex-1 min-w-0 overflow-x-auto no-scrollbar select-none ${moving ? 'cursor-grab' : ''}`}>
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
