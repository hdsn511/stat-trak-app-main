import type { ReactNode } from 'react'
import type { Matchup } from '@/services/api'
import TeamLogo from '@/ember/components/TeamLogo'

import { BAD, GOOD } from './insightTones'

/** Column header cell text. */
export function Th({ children, align = 'left', className = '' }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  return (
    <span
      className={`font-martian text-[10px] text-[#8A827E] tracking-[1px] whitespace-nowrap ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
      } ${className}`}
    >
      {children}
    </span>
  )
}

/** Small uppercase label used inside cards to split sections. */
export function SubHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-[18px] pt-[12px] pb-[6px]">
      <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1.5px]">{children}</span>
      {right && <span className="ml-auto font-martian text-[10px] text-[#8A827E] tracking-[1px]">{right}</span>}
    </div>
  )
}

/** "SF allows +12% REC" — green when the opponent is soft in this stat, red when stingy. */
export function MatchupCell({ league, opponent, matchup, label }: {
  league: string
  opponent: string
  matchup: Matchup | null
  label: string
}) {
  if (!matchup) return <span className="font-martian text-[11px] text-[#665F5D]">—</span>
  const p = Math.round((matchup.factor - 1) * 100)
  const color = p >= 3 ? GOOD : p <= -3 ? BAD : '#A8A09C'
  return (
    <span className="inline-flex items-center gap-[5px] font-martian text-[11px] whitespace-nowrap" title={`${opponent} ranks ${matchup.rank} of ${matchup.of} in ${label} allowed (1 = allows the most)`}>
      <TeamLogo league={league} abbr={opponent} size={13} />
      <span style={{ color }}>
        {p > 0 ? '+' : ''}
        {p}%
      </span>
      <span className="text-[#8A827E]">#{matchup.rank}</span>
    </span>
  )
}

/**
 * Last games as bars against the rung: cleared in green, missed in red, the
 * line dashed across.
 */
export function HitStrip({ values, rung, width = 120 }: { values: number[]; rung: number; width?: number | string }) {
  const max = Math.max(rung * 1.6, ...values, 1)
  const lineAt = (rung / max) * 100
  const cleared = values.filter((v) => v >= rung).length
  return (
    <div
      className="relative h-[28px] flex items-end gap-[2px]"
      style={{ width }}
      role="img"
      aria-label={`Cleared ${rung} in ${cleared} of the last ${values.length} games`}
    >
      {values.map((v, i) => (
        <div
          key={i}
          title={String(v)}
          className="flex-1 rounded-t-[2px]"
          style={{
            height: `${Math.max(6, (v / max) * 100)}%`,
            background: v >= rung ? GOOD : BAD,
            opacity: v >= rung ? 0.9 : 0.55,
          }}
        />
      ))}
      <div className="absolute left-0 right-0 border-t border-dashed border-[#EFEBE9]/70" style={{ bottom: `${lineAt}%` }} />
    </div>
  )
}
