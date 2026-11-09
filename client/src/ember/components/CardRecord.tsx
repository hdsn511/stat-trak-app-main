import { formatUnits } from '@/ember/data/results'

/**
 * A card's header corner. With a record it reads as one labelled fact ("YESTERDAY'S
 * CARD 6-2", "ALL-TIME 17-6 +4.3U") and the card's meta is left out, so the
 * label and the number can't be read as two separate things.
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
  return (
    <span className="flex items-center gap-2 font-martian text-[10px] tracking-[1px] text-[#A8A09C]">
      {label && <span>{label}</span>}
      <span className="flex items-center gap-2 rounded-[3px] border border-[#3A3330] px-[7px] py-[3px] text-[11px] text-[#EFEBE9] tabular-nums">
        {record.w}-{record.l}
        {units != null && (
          <span className={units >= 0 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}>{formatUnits(units)}</span>
        )}
      </span>
    </span>
  )
}
