import { useState } from 'react'
import type { PlayerResultRow } from '../../services/sportqueryApi'
import { Button } from '@/components/ui/button'
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
      {more > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full font-condensed uppercase tracking-[0.2em] text-xs text-gray-500 hover:text-mint hover:bg-transparent"
        >
          {expanded ? 'Show less' : `See all ${rows.length}`}
        </Button>
      )}
    </div>
  )
}
