import type { ReactNode } from 'react'
import type { StatDef } from '@/config/playerStats'
import type { HomeAway, PlayerFilters } from '../types'

interface FilterBarProps {
  filters: PlayerFilters
  statDefs: StatDef[]
  windows: number[]
  opponents: string[]
  onWindow: (w: number) => void
  onVsTeam: (t: string | null) => void
  onHomeAway: (h: HomeAway) => void
  onStat: (s: string) => void
}

const windowLabel = (w: number) => (w === 0 ? 'ALL' : `L${w}`)

const BTN =
  'font-martian font-medium text-[9px] px-[11px] py-[6px] cursor-pointer whitespace-nowrap transition-colors'
const ON = 'bg-[#EFE9E0] text-[#14100F]'
const OFF = 'bg-transparent text-[#9A918F] hover:text-[#EFEBE9]'

function Group({ children }: { children: ReactNode }) {
  return <div className="flex border border-[#2C2624] rounded-md overflow-hidden">{children}</div>
}

function Label({ children }: { children: string }) {
  return (
    <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] self-center">
      {children}
    </span>
  )
}

/**
 * A removable summary of one active filter. The aria-label disambiguates it
 * from the filter buttons above, which share its visible text.
 */
function Chip({ text, onClear }: { text: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Clear ${text} filter`}
      onClick={onClear}
      className="font-martian font-medium text-[9px] tracking-[0.5px] px-[10px] py-[4px] rounded-xl border border-[rgba(255,107,61,0.5)] bg-[rgba(255,107,61,0.08)] text-[#FF6B3D] hover:bg-[rgba(255,107,61,0.16)] cursor-pointer"
    >
      {text} ✕
    </button>
  )
}

export default function FilterBar({
  filters,
  statDefs,
  windows,
  opponents,
  onWindow,
  onVsTeam,
  onHomeAway,
  onStat,
}: FilterBarProps) {
  // "ANY" rather than "ALL" so it never collides with the window group's ALL.
  const venues: [string, HomeAway][] = [
    ['ANY', 'all'],
    ['HOME', 'home'],
    ['AWAY', 'away'],
  ]
  const hasActive = filters.vsTeam != null || filters.homeAway !== 'all' || filters.window !== 0

  return (
    <div className="flex flex-col gap-[10px] px-[18px] py-[13px] border-b border-[#27221F]">
      <div className="flex items-center gap-3 flex-wrap">
        <Label>WINDOW</Label>
        <Group>
          {windows.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={filters.window === w}
              onClick={() => onWindow(w)}
              className={`${BTN} ${filters.window === w ? ON : OFF}`}
            >
              {windowLabel(w)}
            </button>
          ))}
        </Group>

        <Label>VS</Label>
        <select
          aria-label="Opponent"
          value={filters.vsTeam ?? ''}
          onChange={(e) => onVsTeam(e.target.value || null)}
          className="font-martian text-[9px] bg-[#221D1A] text-[#EFEBE9] border border-[#2C2624] rounded-md px-[10px] py-[6px] cursor-pointer"
        >
          <option value="">ALL TEAMS</option>
          {opponents.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>

        <Label>VENUE</Label>
        <Group>
          {venues.map(([label, v]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filters.homeAway === v}
              onClick={() => onHomeAway(v)}
              className={`${BTN} ${filters.homeAway === v ? ON : OFF}`}
            >
              {label}
            </button>
          ))}
        </Group>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Label>STAT</Label>
        <Group>
          {statDefs.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={filters.stat === s.key}
              onClick={() => onStat(s.key)}
              className={`${BTN} ${filters.stat === s.key ? ON : OFF}`}
            >
              {s.label}
            </button>
          ))}
        </Group>
      </div>

      {hasActive && (
        <div className="flex items-center gap-2 flex-wrap">
          <Label>ACTIVE</Label>
          {filters.window !== 0 && (
            <Chip text={`LAST ${filters.window}`} onClear={() => onWindow(0)} />
          )}
          {filters.vsTeam && <Chip text={`VS ${filters.vsTeam}`} onClear={() => onVsTeam(null)} />}
          {filters.homeAway !== 'all' && (
            <Chip text={filters.homeAway.toUpperCase()} onClear={() => onHomeAway('all')} />
          )}
        </div>
      )}
    </div>
  )
}
