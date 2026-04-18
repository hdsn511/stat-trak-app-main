import { useState } from 'react'
import type { PlayerResultRow } from '../../services/sportqueryApi'
import { CompactPlayerCard } from './CompactPlayerCard'

type Props = { rows: PlayerResultRow[] }

const INITIAL_VISIBLE = 5

export function ResultCardList({ rows }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (!rows.length) return null

  const visible = expanded ? rows : rows.slice(0, INITIAL_VISIBLE)
  const more = rows.length - INITIAL_VISIBLE

  return (
    <div className="space-y-2 mt-3">
      {visible.map((r, i) => (
        <CompactPlayerCard key={(r.id as number) ?? i} row={r} />
      ))}
      {more > 0 && !expanded && (
        <button
          className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500 hover:text-mint"
          onClick={() => setExpanded(true)}
        >
          See all {rows.length}
        </button>
      )}
    </div>
  )
}
