import type { ResultRow, ResultShape } from '@/services/sportqueryApi'
import { formatCell, genericColumns, humanizeKey, inferMetricKey, parseRow } from './resultRows'
import type { Selection } from './selection'

interface ResultCardsProps {
  rows: ResultRow[]
  shape: ResultShape
  query: string
  turnId: string
  selection: Selection | null
  onSelect: (sel: Selection) => void
}

const MAX_CARDS = 12

/** Rows the generic table renders when nothing recognisable is in them. */
function GenericTable({ rows }: { rows: ResultRow[] }) {
  const columns = genericColumns(rows)
  if (columns.length === 0) return null

  return (
    <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-[#27221F]">
            {columns.map((c) => (
              <th
                key={c}
                className="text-left font-martian text-[8px] text-[#665F5D] tracking-[1px] px-[14px] py-[9px] whitespace-nowrap"
              >
                {humanizeKey(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_CARDS).map((row, i) => (
            <tr key={i} className="border-t border-[#221D1A]">
              {columns.map((c) => (
                <td
                  key={c}
                  className="font-martian text-[11px] text-[#D8D2CE] px-[14px] py-[8px] whitespace-nowrap tabular-nums"
                >
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ResultCards({
  rows,
  shape,
  query,
  turnId,
  selection,
  onSelect,
}: ResultCardsProps) {
  if (rows.length === 0) return null

  // Inferred over the full result set, not the visible slice — the sort signal
  // is stronger with more rows.
  const metricKey = inferMetricKey(rows)
  const parsed = rows
    .slice(0, MAX_CARDS)
    .map((row) => ({ row, meta: parseRow(row, shape, metricKey) }))
  // Cards only make sense when the rows actually name something openable.
  const openable = parsed.filter((p) => p.meta.playerName || p.meta.playerId != null)

  if (openable.length === 0) return <GenericTable rows={rows} />

  return (
    <div className="flex flex-col gap-2">
      {parsed.map(({ meta }, i) => {
        const selected =
          selection?.turnId === turnId &&
          selection.kind === 'player' &&
          selection.playerId === meta.playerId

        const label = meta.playerName ?? (meta.playerId != null ? `#${meta.playerId}` : '—')
        const canOpen = meta.playerId != null && meta.playerId > 0

        const body = (
          <>
            <span className="font-martian font-bold text-[14px] text-[#665F5D]">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                {label}
              </div>
              <div className="font-martian text-[9px] text-[#9A918F] mt-[3px] whitespace-nowrap overflow-hidden text-ellipsis">
                {[meta.team, meta.secondary].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="font-martian font-bold text-[17px] text-[#FF6B3D] tabular-nums">
                {meta.value != null
                  ? Number.isInteger(meta.value)
                    ? meta.value
                    : meta.value.toFixed(1)
                  : '—'}
              </div>
              {meta.valueLabel && (
                <div className="font-martian text-[8px] text-[#665F5D] tracking-[0.5px] mt-[2px]">
                  {meta.valueLabel}
                </div>
              )}
            </div>
            <span className="font-martian font-bold text-[12px] text-[#665F5D]">
              {canOpen ? '→' : ''}
            </span>
          </>
        )

        const className = `grid grid-cols-[30px_1fr_88px_14px] gap-[14px] items-center border rounded-lg px-4 py-3 text-left ${
          selected ? 'bg-[#241C18] border-[#FF6B3D]' : 'bg-[#1B1715] border-[#2C2624]'
        } ${canOpen ? 'cursor-pointer hover:border-[#FF6B3D]' : ''}`

        return canOpen ? (
          <button
            key={`${turnId}-${meta.playerId}-${i}`}
            type="button"
            onClick={() =>
              onSelect({ kind: 'player', playerId: meta.playerId!, name: label, query, turnId })
            }
            className={className}
          >
            {body}
          </button>
        ) : (
          <div key={`${turnId}-row-${i}`} className={className}>
            {body}
          </div>
        )
      })}

      {rows.length > MAX_CARDS && (
        <div className="font-martian text-[9px] text-[#665F5D] tracking-[1px] px-1">
          {`// SHOWING ${MAX_CARDS} OF ${rows.length} ROWS`}
        </div>
      )}
    </div>
  )
}
