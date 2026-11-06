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
  seasons?: number[]
  season?: number
  onSeason?: (s: number) => void
  /** Usage metric for the selected stat; omit (or null) to hide the control. */
  usage?: StatDef | null
  /** Observed per-game usage range, used to seed and cap the stepper. */
  usageBounds?: { min: number; max: number } | null
  onUsageMin?: (v: number | null) => void
}

const windowLabel = (w: number) => (w === 0 ? 'ALL' : `L${w}`)

const BTN =
  'font-martian font-medium text-[11px] px-[11px] py-[6px] cursor-pointer whitespace-nowrap transition-colors'
const ON = 'bg-[#EFE9E0] text-[#14100F]'
const OFF = 'bg-transparent text-[#C9C2BE] hover:text-[#EFEBE9]'

function Group({ children }: { children: ReactNode }) {
  return <div className="flex border border-[#2C2624] rounded-md overflow-hidden">{children}</div>
}

function Label({ children }: { children: string }) {
  return (
    <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1px] self-center">
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
      className="font-martian font-medium text-[11px] tracking-[0.5px] px-[10px] py-[4px] rounded-xl border border-[rgba(255,107,61,0.5)] bg-[rgba(255,107,61,0.08)] text-[#FF6B3D] hover:bg-[rgba(255,107,61,0.16)] cursor-pointer"
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
  seasons = [],
  season = 0,
  onSeason,
  usage = null,
  usageBounds = null,
  onUsageMin,
}: FilterBarProps) {
  // "ANY" rather than "ALL" so it never collides with the window group's ALL.
  const venues: [string, HomeAway][] = [
    ['ANY', 'all'],
    ['HOME', 'home'],
    ['AWAY', 'away'],
  ]
  const usageMin = usage && onUsageMin ? (filters.usageMin ?? null) : null
  const hasActive =
    filters.vsTeam != null ||
    filters.homeAway !== 'all' ||
    filters.window !== 0 ||
    usageMin != null
  // First "+" from no floor jumps to the middle of the player's range, so a
  // 2–40 minute log doesn't take 26 clicks to reach a meaningful floor.
  const stepUp = () => {
    if (!onUsageMin) return
    if (usageMin == null) {
      onUsageMin(usageBounds ? Math.round((usageBounds.min + usageBounds.max) / 2) : 1)
      return
    }
    onUsageMin(usageBounds ? Math.min(usageBounds.max, usageMin + 1) : usageMin + 1)
  }
  const stepDown = () => {
    if (!onUsageMin || usageMin == null) return
    onUsageMin(usageMin - 1 < 0 ? null : usageMin - 1)
  }

  return (
    <div className="flex flex-col gap-[10px] px-[18px] py-[13px] border-b border-[#27221F]">
      <div className="flex items-center gap-3 flex-wrap">
        {onSeason && seasons.length > 1 && (
          <>
            <Label>SEASON</Label>
            <Group>
              {[...seasons, 0].map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={season === s}
                  onClick={() => onSeason(s)}
                  className={`${BTN} ${season === s ? ON : OFF}`}
                >
                  {s === 0 ? 'ALL' : s}
                </button>
              ))}
            </Group>
          </>
        )}
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
          className="font-martian text-[11px] bg-[#221D1A] text-[#EFEBE9] border border-[#2C2624] rounded-md px-[10px] py-[6px] cursor-pointer"
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

        {usage && onUsageMin && (
          <>
            <Label>{`${usage.label} ≥`}</Label>
            <Group>
              <button
                type="button"
                aria-label={`Lower minimum ${usage.label}`}
                disabled={usageMin == null}
                onClick={stepDown}
                className={`${BTN} ${OFF} disabled:opacity-40 disabled:cursor-default`}
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={`Minimum ${usage.label}`}
                placeholder="ANY"
                value={usageMin ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  const n = Number(raw)
                  onUsageMin(raw === '' || !Number.isFinite(n) ? null : n)
                }}
                className="w-[52px] font-martian font-medium text-[11px] text-center bg-[#221D1A] text-[#EFEBE9] placeholder:text-[#8A817D] border-x border-[#2C2624] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                aria-label={`Raise minimum ${usage.label}`}
                onClick={stepUp}
                className={`${BTN} ${OFF}`}
              >
                +
              </button>
            </Group>
          </>
        )}
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
          {usage && usageMin != null && onUsageMin && (
            <Chip text={`${usage.label} ≥ ${usageMin}`} onClear={() => onUsageMin(null)} />
          )}
        </div>
      )}
    </div>
  )
}
