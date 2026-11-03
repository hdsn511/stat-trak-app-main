/** A card's header corner: its short meta, then its cumulative record when it has one. */
export default function CardRecord({ meta, record }: { meta?: string; record?: { w: number; l: number } | null }) {
  return (
    <span className="flex items-center gap-3 font-martian text-[10px] tracking-[1px] text-[#A8A09C]">
      {meta && <span>{meta}</span>}
      {record && (
        <span
          className="rounded-[3px] border border-[#3A3330] px-[7px] py-[3px] text-[11px] text-[#EFEBE9] tabular-nums"
          title="Wins and losses since tracking began"
        >
          {record.w}-{record.l}
        </span>
      )}
    </span>
  )
}
