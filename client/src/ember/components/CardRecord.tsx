import { formatUnits } from '@/ember/data/results'

/**
 * A card's header corner: the meta (what the chart shows), then the record boxed
 * with its own label ("YESTERDAY'S RECORD 6-2", "ALL-TIME 17-6 +4.3U").
 */
export default function CardRecord({
  meta,
  label,
  record,
  units,
}: {
  meta?: string
  label?: string
  record?: { w: number; l: number } | null
  /** Net units; shown after the W-L when given. */
  units?: number | null
}) {
  if (!record) {
    return meta ? <span className="font-martian text-[10px] tracking-[1px] text-[#A8A09C]">{meta}</span> : null
  }
  // The meta says what the chart shows; the boxed label says the number is a record.
  return (
    <span className="flex items-center gap-3 font-martian text-[10px] tracking-[1px] text-[#A8A09C]">
      {meta && <span className="hidden sm:inline">{meta}</span>}
      <span className="flex items-center gap-2 rounded-[3px] border border-[#3A3330] px-[7px] py-[3px]">
        {label && <span>{label}</span>}
        <span className="text-[11px] font-bold text-[#EFEBE9] tabular-nums">{record.w}-{record.l}</span>
        {units != null && (
          <span className={units >= 0 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}>{formatUnits(units)}</span>
        )}
      </span>
    </span>
  )
}
