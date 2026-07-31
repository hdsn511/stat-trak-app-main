import type { StatDef } from '@/config/playerStats'
import type { GameRow } from '../types'

interface GameLogChartProps {
  games: GameRow[]
  def: StatDef
  line: number
}

const H = 120

export default function GameLogChart({ games, def, line }: GameLogChartProps) {
  // The API returns newest first; a chart reads left-to-right chronologically.
  const points = games
    .map((g) => ({ v: def.get(g), opp: typeof g.opponent === 'string' ? g.opponent : '' }))
    .filter((p): p is { v: number; opp: string } => p.v != null)
    .reverse()

  if (points.length === 0) {
    return (
      <div className="px-[18px] py-9 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
        NO GAMES MATCH THESE FILTERS
      </div>
    )
  }

  const max = Math.max(...points.map((p) => p.v), line, 1)
  const linePct = (line / max) * 100

  return (
    <div className="relative px-[18px] pt-[18px] pb-3">
      <div
        className="absolute left-[18px] right-[18px] z-[1] pointer-events-none"
        style={{
          borderTop: '1px dashed rgba(255,107,61,0.75)',
          bottom: `${28 + (linePct / 100) * H}px`,
        }}
      >
        <span className="absolute right-0 top-[-14px] font-martian font-medium text-[7px] text-[#FF6B3D] tracking-[0.5px] bg-[#1B1715] px-[3px]">
          {`LINE ${line}`}
        </span>
      </div>

      <div className="flex items-end gap-[6px]" style={{ height: `${H + 28}px` }}>
        {points.map((p, i) => {
          const result = p.v > line ? 'over' : p.v < line ? 'under' : 'push'
          const color = result === 'over' ? '#3FBF7F' : result === 'under' ? '#4A403C' : '#9A918F'
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
              <span className="font-martian font-medium text-[8px] text-[#9A918F]">
                {def.format ? def.format(p.v) : p.v}
              </span>
              <div
                data-testid="chart-bar"
                data-value={p.v}
                data-result={result}
                title={`${p.opp || '—'}: ${p.v}`}
                className="w-full max-w-[30px] rounded-t-[3px]"
                style={{ height: `${Math.max(3, (p.v / max) * H)}px`, background: color }}
              />
              <span className="font-martian text-[7px] text-[#665F5D] overflow-hidden max-w-full whitespace-nowrap">
                {p.opp}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
