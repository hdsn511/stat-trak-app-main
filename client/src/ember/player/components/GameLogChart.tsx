import { useEffect, useRef } from 'react'
import type { StatDef } from '@/config/playerStats'
import type { GameRow } from '../types'

interface GameLogChartProps {
  games: GameRow[]
  def: StatDef
  line: number
  /** Usage metric (minutes, targets…) drawn as a quiet strip under the bars. */
  usage?: (StatDef & { title?: string }) | null
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

// The usage strip is deliberately small: context for the main bars, not a rival.
const UH = 34
const U_VALUE_ROOM = 12

const fmt = (d: StatDef, v: number) => (d.format ? d.format(v) : String(v))

export default function GameLogChart({ games, def, line, usage = null }: GameLogChartProps) {
  const scroller = useRef<HTMLDivElement>(null)

  // The API returns newest first; a chart reads left-to-right chronologically.
  const points = games
    .map((g) => ({
      v: def.get(g),
      u: usage ? usage.get(g) : null,
      opp: typeof g.opponent === 'string' ? g.opponent : '',
    }))
    .filter((p): p is { v: number; u: number | null; opp: string } => p.v != null)
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
  const usageVals = points.map((p) => p.u).filter((u): u is number => u != null)
  const showUsage = usage != null && usageVals.length > 0
  const uMax = Math.max(...usageVals, 1)
  const uAvg = usageVals.reduce((a, b) => a + b, 0) / (usageVals.length || 1)

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

          {showUsage && (
            <div data-testid="usage-strip" className="mt-[10px] pt-[8px] border-t border-dashed border-[#2C2624]">
              <div className="sticky left-0 w-fit font-martian text-[9px] tracking-[1px] text-[#8A817D] mb-[2px]">
                {`${usage.title ?? usage.label} · AVG ${uAvg.toFixed(1)}`}
              </div>
              <div className="relative" style={{ height: `${UH + U_VALUE_ROOM}px` }}>
                <div className="absolute inset-0 flex items-end" style={{ gap: `${GAP}px` }}>
                  {points.map((p, i) => {
                    const over = p.v > line
                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center justify-end gap-[2px] min-w-0"
                        style={{ minWidth: `${BAR_MIN}px` }}
                      >
                        <span
                          data-testid="usage-value"
                          className="font-martian text-[9px] text-[#8A817D] leading-[9px]"
                        >
                          {p.u == null ? '—' : fmt(usage, p.u)}
                        </span>
                        <div
                          data-testid="usage-bar"
                          data-value={p.u ?? ''}
                          title={`${p.opp || '—'}: ${p.u == null ? '—' : fmt(usage, p.u)} ${usage.label}`}
                          className="w-[70%] rounded-t-[2px]"
                          style={{
                            height: `${p.u == null ? 0 : Math.max(2, (p.u / uMax) * UH)}px`,
                            background: over ? 'rgba(63,191,127,0.32)' : '#3A322F',
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
