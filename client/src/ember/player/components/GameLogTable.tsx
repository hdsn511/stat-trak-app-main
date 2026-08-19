import { formatVolume, type StatDef } from '@/config/playerStats'
import type { GameRow } from '../types'

interface GameLogTableProps {
  games: GameRow[]
  statDefs: StatDef[]
  volumeDef: StatDef | null
  activeStat: string
}

const cell = 'font-martian text-[10px] px-2 py-[7px] whitespace-nowrap'
const head = 'font-martian text-[8px] text-[#665F5D] tracking-[1px] px-2 py-[7px] whitespace-nowrap'

export default function GameLogTable({
  games,
  statDefs,
  volumeDef,
  activeStat,
}: GameLogTableProps) {
  if (games.length === 0) {
    return (
      <div className="px-[18px] py-8 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
        NO GAMES MATCH THESE FILTERS
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#27221F]">
            <th className={`${head} text-left`}>DATE</th>
            <th className={`${head} text-left`}>OPP</th>
            {volumeDef && <th className={`${head} text-right`}>{volumeDef.label}</th>}
            {statDefs.map((d) => (
              <th
                key={d.key}
                className={`${head} text-right ${d.key === activeStat ? 'text-[#FF6B3D]' : ''}`}
              >
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((g, i) => (
            <tr key={i} className="border-t border-[#221D1A] hover:bg-[#211C1A]">
              <td className={`${cell} text-[#665F5D]`}>{String(g.date ?? '')}</td>
              <td className="font-schibsted font-bold text-[11px] text-[#EFEBE9] px-2 py-[7px]">
                {`${g.isHome === false ? '@' : ''}${String(g.opponent ?? '—')}`}
              </td>
              {volumeDef && (
                <td className={`${cell} text-right text-[#9A918F]`}>
                  {formatVolume(volumeDef, volumeDef.get(g))}
                </td>
              )}
              {statDefs.map((d) => {
                const v = d.get(g)
                return (
                  <td
                    key={d.key}
                    className={`${cell} font-bold text-right ${
                      d.key === activeStat ? 'text-[#FF6B3D]' : 'text-[#EFEBE9]'
                    }`}
                  >
                    {v == null ? '—' : d.format ? d.format(v) : v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
