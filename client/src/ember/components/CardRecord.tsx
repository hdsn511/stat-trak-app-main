/**
 * A card's header corner: what the chart shows, then the card's W-L (and net units
 * when priced). `label` says which record it is: yesterday's by default.
 */
export default function CardRecord({
  meta,
  record,
  label = "YESTERDAY'S RECORD",
  title = "This card's suggestions from yesterday, graded: wins-losses",
}: {
  meta?: string
  record?: { w: number; l: number; units?: number } | null
  label?: string
  title?: string
}) {
  const graded = record && record.w + record.l > 0
  const u = record?.units
  return (
    <span className="flex items-center gap-3 font-martian text-[10px] tracking-[1px] text-[#A8A09C]">
      {meta && <span>{meta}</span>}
      {graded && (
        <span className="flex items-center gap-[6px] rounded-[3px] border border-[#3A3330] px-[7px] py-[3px] cursor-help" title={title}>
          <span>{label}</span>
          <span className="text-[11px] font-bold text-[#EFEBE9] tabular-nums">
            {record.w}-{record.l}
          </span>
          {u != null && (
            <span className={`text-[11px] font-bold tabular-nums ${u >= 0 ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}`}>
              {u >= 0 ? '+' : ''}
              {u.toFixed(1)}u
            </span>
          )}
        </span>
      )}
    </span>
  )
}
