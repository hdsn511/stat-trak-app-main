import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ACROSS_SPORTS, LIMITS, SPORTS, WHAT_YOU_CAN_DO } from './capabilities'
import type { LeagueSlug } from '@/config/leagues'

interface InfoPopoverProps {
  onAsk: (q: string) => void
}

// Hover opens it for a glance, click pins it open (touch has no hover), and
// the short close delay lets the pointer cross the gap into the panel.
const CLOSE_DELAY_MS = 180

export default function InfoPopover({ onAsk }: InfoPopoverProps) {
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [tab, setTab] = useState<LeagueSlug>('nba')
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const open = hovering || pinned
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null)

  // The chat column scrolls, so an absolutely positioned panel would be
  // clipped by it. Fixed positioning, computed from the button, escapes that;
  // the width and left edge are clamped so it never runs off a narrow viewport.
  useLayoutEffect(() => {
    if (!open || !root.current) return
    const place = () => {
      const r = root.current!.getBoundingClientRect()
      const width = Math.min(660, window.innerWidth - 32)
      const left = Math.max(16, Math.min(r.left, window.innerWidth - width - 16))
      setPlace({ left, top: r.bottom, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const enter = () => {
    cancelClose()
    setHovering(true)
  }
  const leave = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setHovering(false), CLOSE_DELAY_MS)
  }

  useEffect(() => () => cancelClose(), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false)
        setHovering(false)
      }
    }
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setPinned(false)
        setHovering(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const sport = SPORTS.find((s) => s.slug === tab) ?? SPORTS[0]!

  return (
    <div ref={root} className="relative inline-block" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setPinned((p) => !p)}
        className={`flex items-center gap-[7px] font-martian font-bold text-[11px] tracking-[1px] rounded-md px-[10px] py-[6px] border cursor-pointer ${
          open
            ? 'text-[#14100F] bg-[#FF6B3D] border-[#FF6B3D]'
            : 'text-[#C9C2BE] border-[#2C2624] hover:border-[#665F5D] hover:text-[#EFEBE9]'
        }`}
      >
        <span
          aria-hidden
          className="inline-flex items-center justify-center w-[13px] h-[13px] rounded-full border border-current text-[10px] leading-none"
        >
          i
        </span>
        WHAT CAN I ASK?
      </button>

      {open && place && (
        <div
          id={panelId}
          role="region"
          aria-label="What SportQuery can answer"
          className="fixed z-30 pt-2"
          style={{ left: place.left, top: place.top, width: place.width }}
        >
          <div
            className="bg-[#1B1715] border border-[#2C2624] rounded-lg shadow-[0_18px_48px_rgba(0,0,0,0.55)] overflow-y-auto"
            style={{ maxHeight: `calc(100vh - ${place.top}px - 24px)` }}
          >
            <div className="px-[18px] pt-[16px] pb-[12px] border-b border-[#27221F]">
              <div className="font-chakra italic font-bold text-[14px] text-[#EFEBE9]">
                <span className="text-[#FF6B3D]">{'// '}</span>
                WHAT SPORTQUERY KNOWS
              </div>
              <p className="font-schibsted text-[14px] text-[#C9C2BE] leading-[1.55] mt-[6px]">
                Ask in plain English. Every answer comes from the stats below — final games only,
                read-only.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-x-[22px] gap-y-[14px] px-[18px] py-[14px] border-b border-[#27221F]">
              {WHAT_YOU_CAN_DO.map((w) => (
                <div key={w.title}>
                  <div className="font-martian font-bold text-[10px] tracking-[1px] text-[#FF6B3D]">
                    {w.title.toUpperCase()}
                  </div>
                  <div className="font-schibsted text-[14px] text-[#D8D2CE] leading-[1.5] mt-[4px]">
                    {w.body}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-[18px] pt-[12px]">
              <div role="tablist" aria-label="Sport" className="flex gap-[6px]">
                {SPORTS.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    role="tab"
                    aria-selected={s.slug === tab}
                    onClick={() => setTab(s.slug)}
                    className={`font-martian font-bold text-[11px] tracking-[1px] rounded px-[10px] py-[5px] border cursor-pointer ${
                      s.slug === tab
                        ? 'text-[#14100F] bg-[#EFEBE9] border-[#EFEBE9]'
                        : 'text-[#C9C2BE] border-[#2C2624] hover:border-[#665F5D]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-[18px] py-[14px] flex flex-col gap-[14px]">
              {sport.groups.map((g) => (
                <div key={g.label}>
                  <div className="font-martian text-[10px] tracking-[1px] text-[#A8A09C]">
                    {g.label.toUpperCase()}
                  </div>
                  <div className="flex flex-wrap gap-[6px] mt-[7px]">
                    {g.stats.map((st) => (
                      <span
                        key={st}
                        className="font-schibsted text-[13px] text-[#D8D2CE] bg-[#211C1A] border border-[#2C2624] rounded px-[8px] py-[3px]"
                      >
                        {st}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <div className="font-martian text-[10px] tracking-[1px] text-[#A8A09C]">
                  TRENDS (3 / 5 / 10-GAME Z-SCORE)
                </div>
                <div className="font-schibsted text-[14px] text-[#C9C2BE] mt-[6px]">
                  {sport.trends.join(' · ')}
                </div>
              </div>

              <div className="font-schibsted text-[14px] text-[#C9C2BE] leading-[1.5]">
                <span className="font-martian text-[10px] tracking-[1px] text-[#A8A09C] mr-2">
                  {sport.markets ? 'LINES + PICKS' : 'NOT AVAILABLE'}
                </span>
                {sport.markets
                  ? `Kalshi lines and model picks are included. Not available: ${sport.notAvailable}`
                  : sport.notAvailable}
              </div>

              <div>
                <div className="font-martian text-[10px] tracking-[1px] text-[#A8A09C]">TRY ONE</div>
                <div className="flex flex-col gap-[6px] mt-[7px]">
                  {sport.examples.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        onAsk(ex)
                        setPinned(false)
                        setHovering(false)
                      }}
                      className="text-left font-schibsted text-[14px] text-[#EFEBE9] border border-[#2C2624] hover:border-[#FF6B3D] rounded-md px-[12px] py-[8px] cursor-pointer"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-[18px] py-[14px] border-t border-[#27221F] grid sm:grid-cols-2 gap-[18px]">
              <div>
                <div className="font-martian text-[10px] tracking-[1px] text-[#A8A09C]">ACROSS SPORTS</div>
                <ul className="mt-[7px] flex flex-col gap-[5px]">
                  {ACROSS_SPORTS.map((a) => (
                    <li key={a} className="font-schibsted text-[14px] text-[#C9C2BE] leading-[1.45]">
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-martian text-[10px] tracking-[1px] text-[#A8A09C]">GOOD TO KNOW</div>
                <ul className="mt-[7px] flex flex-col gap-[5px]">
                  {LIMITS.map((l) => (
                    <li key={l} className="font-schibsted text-[14px] text-[#C9C2BE] leading-[1.45]">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
