import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import type { SuggestionResultSet } from '@/services/api'
import { recordLabel } from '@/ember/data/results'
import PlayerAvatar from './PlayerAvatar'

/** A card's footer: yesterday's record on one line, its graded rows when opened. */
export function YesterdayDropdown({ label, summary, children }: { label: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-[#221D1A]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-[18px] py-[10px] font-martian text-[11px] tracking-[1px] text-[#A8A09C] hover:bg-[#211C1A]"
      >
        <span>{label}</span>
        <span className="font-bold text-[#EFEBE9] flex items-center gap-2">{summary}</span>
        <span className="ml-auto text-[#FF6B3D]">{open ? 'HIDE' : 'SHOW'}</span>
      </button>
      {open && children}
    </div>
  )
}

/** W / L in the result colours. */
export function WinLoss({ hit }: { hit: boolean }) {
  return (
    <span className={`font-martian font-bold text-[11px] w-[14px] text-right ${hit ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}`}>
      {hit ? 'W' : 'L'}
    </span>
  )
}

/**
 * Yesterday's graded suggestions for a card. These are the morning snapshot of
 * the card, so a player who has since dropped off it still counts.
 */
export default function YesterdayResults({ league, set }: { league: string; set: SuggestionResultSet | null | undefined }) {
  const record = recordLabel(set)
  if (!set || !record) return null
  return (
    <YesterdayDropdown label="YESTERDAY'S CARD" summary={record}>
      {set.rows.map((r) => (
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
          <WinLoss hit={r.did_hit} />
        </Link>
      ))}
    </YesterdayDropdown>
  )
}
