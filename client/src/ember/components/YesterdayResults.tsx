import { useState } from 'react'
import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import type { SuggestionResultSet } from '@/services/api'
import { recordLabel } from '@/ember/data/results'
import PlayerAvatar from './PlayerAvatar'

/**
 * Yesterday's graded suggestions for a card, collapsed to one line until opened.
 * These are the morning snapshot of the card, so a player who has since dropped
 * off it still counts.
 */
export default function YesterdayResults({ league, set }: { league: string; set: SuggestionResultSet | null | undefined }) {
  const [open, setOpen] = useState(false)
  const record = recordLabel(set)
  if (!set || !record) return null
  return (
    <div className="border-t border-[#221D1A]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-[18px] py-[10px] font-martian text-[11px] tracking-[1px] text-[#A8A09C] hover:bg-[#211C1A]"
      >
        <span>YESTERDAY&apos;S SUGGESTIONS</span>
        <span className="font-bold text-[#EFEBE9]">{record}</span>
        <span className="ml-auto text-[#FF6B3D]">{open ? 'HIDE' : 'SHOW'}</span>
      </button>
      {open &&
        set.rows.map((r) => (
          <Link
            key={`${r.player_id}-${r.stat}`}
            to={playerPath(league, r.player_id)}
            className="flex items-center gap-3 px-[18px] py-[8px] border-t border-[#221D1A] hover:bg-[#211C1A]"
          >
            <PlayerAvatar league={league} extId={r.ext_id} name={r.name} accent={teamAccent(league, r.team ?? '')} size={26} />
            <span className="min-w-0 flex-1 font-schibsted text-[13px] text-[#EFEBE9] truncate">{r.name}</span>
            <span className="font-martian text-[11px] text-[#C9C2BE] tabular-nums">
              {r.rung}+ {r.stat_label}
            </span>
            <span className="font-martian text-[11px] text-[#C9C2BE] tabular-nums w-[34px] text-right">{r.actual}</span>
            <span
              className={`font-martian font-bold text-[11px] w-[14px] text-right ${r.did_hit ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}`}
            >
              {r.did_hit ? 'W' : 'L'}
            </span>
          </Link>
        ))}
    </div>
  )
}
