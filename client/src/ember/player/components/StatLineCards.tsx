import { formatAverage, type StatDef } from '@/config/playerStats'
import { averageOf } from '../derive'
import type { GameRow } from '../types'

interface StatLineCardsProps {
  games: GameRow[]
  statDefs: StatDef[]
  volumeDef: StatDef | null
  activeStat: string
}

function Card({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div
      className={`border rounded-lg pt-3 px-[13px] pb-[11px] ${
        active ? 'bg-[#EFE9E0] border-[#EFE9E0]' : 'bg-[#221D1A] border-[#2E2724]'
      }`}
    >
      <div
        className={`font-martian text-[8px] tracking-[1px] ${
          active ? 'text-[#504A44]' : 'text-[#665F5D]'
        }`}
      >
        {label}
      </div>
      <div
        className={`font-martian font-bold text-[20px] mt-[5px] ${
          active ? 'text-[#14100F]' : 'text-[#EFEBE9]'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

export default function StatLineCards({
  games,
  statDefs,
  volumeDef,
  activeStat,
}: StatLineCardsProps) {
  // Every card shows an average, so all of them round — a raw mean would
  // render as 21.692307692307693 and blow out the card.
  const fmt = (d: StatDef) => formatAverage(d, averageOf(games, d))

  return (
    <div className="grid [grid-template-columns:repeat(auto-fit,minmax(96px,1fr))] gap-2 px-[18px] pt-[14px] pb-4">
      {volumeDef && <Card label={volumeDef.label} value={fmt(volumeDef)} active={false} />}
      {statDefs.map((d) => (
        <Card key={d.key} label={d.label} value={fmt(d)} active={d.key === activeStat} />
      ))}
    </div>
  )
}
