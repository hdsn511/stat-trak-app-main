import { useEffect, useRef } from 'react'
import type { StatDef } from '@/config/playerStats'
import type { GameRow } from '../types'

interface GameLogChartProps {
  games: GameRow[]
  def: StatDef
  line: number
}

// Height of the tallest possible bar; bars and the threshold share this scale.
const H = 120
// Headroom above a full-height bar for its value label (10px line + 4px gap).
const VALUE_ROOM = 14

// Every bar keeps at least this much width so its value and opponent code stay
// readable. Few games grow to fill the card; a full season overflows it and
// the chart scrolls horizontally instead of cramming the bars together.
const BAR_MIN = 26
const GAP = 6

export default function GameLogChart({ games, def, line }: GameLogChartProps) {
  const scroller = useRef<HTMLDivElement>(null)

  // The API returns newest first; a chart reads left-to-right chronologically.
  const points = games
    .map((g) => ({ v: def.get(g), opp: typeof g.opponent === 'string' ? g.opponent : '' }))
    .filter((p): p is { v: number; opp: string } => p.v != null)
    .reverse()

  // Open on the most recent games; earlier ones are a scroll to the left.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [points.length, def.key])

  if (points.length === 0) {
    return (
      <div className="px-[18px] py-9 text-center font-martian text-[12px] text-[#A8A09C] tracking-[1px]">
        NO GAMES MATCH THESE FILTERS
      </div>
    )
  }

  const max = Math.max(...points.map((p) => p.v), line, 1)
  const lineBottom = (line / max) * H
  const contentWidth = points.length * (BAR_MIN + GAP) - GAP

  return (
    <div className="px-[18px] pt-[18px] pb-3">
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div style={{ minWidth: `${contentWidth}px` }}>
          {/*
            The plot is exactly H (bars) + VALUE_ROOM (value label) tall and
            bars sit on its bottom edge, so the threshold's `bottom` is the same
            scale as the bar heights. The opponent codes live below the plot,
            outside the coordinate space, so they can't shift the baseline.
          */}
          <div className="relative" style={{ height: `${H + VALUE_ROOM}px` }}>
            <div
              data-testid="chart-line"
              className="absolute left-0 right-0 z-[1] pointer-events-none"
              style={{
                borderTop: '1px dashed rgba(255,107,61,0.75)',
                bottom: `${lineBottom}px`,
              }}
            >
              <span className="absolute right-0 top-[-14px] font-martian font-medium text-[10px] text-[#FF6B3D] tracking-[0.5px] bg-[#1B1715] px-[3px]">
                {`LINE ${line}`}
              </span>
            </div>

            <div className="absolute inset-0 flex items-end" style={{ gap: `${GAP}px` }}>
              {points.map((p, i) => {
                const result = p.v > line ? 'over' : p.v < line ? 'under' : 'push'
                const color =
                  result === 'over' ? '#3FBF7F' : result === 'under' ? '#4A403C' : '#9A918F'
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                    style={{ minWidth: `${BAR_MIN}px` }}
                  >
                    <span
                      data-testid="chart-value"
                      className="font-martian font-medium text-[10px] text-[#C9C2BE] leading-[10px]"
                    >
                      {def.format ? def.format(p.v) : p.v}
                    </span>
                    <div
                      data-testid="chart-bar"
                      data-value={p.v}
                      data-result={result}
                      title={`${p.opp || '—'}: ${def.format ? def.format(p.v) : p.v}`}
                      className="w-full rounded-t-[3px]"
                      style={{ height: `${Math.max(3, (p.v / max) * H)}px`, background: color }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex mt-1" style={{ gap: `${GAP}px` }}>
            {points.map((p, i) => (
              <span
                key={i}
                className="flex-1 text-center font-martian text-[10px] text-[#A8A09C] overflow-hidden whitespace-nowrap"
                style={{ minWidth: `${BAR_MIN}px` }}
              >
                {p.opp}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
