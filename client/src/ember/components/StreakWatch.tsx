import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import LeaguePill from './LeaguePill'
import ModuleCard from './ModuleCard'
import { EmptyState } from './EntityState'

export type StreakTier = {
  /** Share of the last 10 games cleared: 100, 90, 80 or 70. */
  pct: number
  line: number
}

/**
 * The two streak models the API serves. NBA computes tiered lines over a fixed
 * 10-game window; MLB tracks an uncapped active run, because baseball counting
 * stats hit zero too often for a 10/10 line to ever populate.
 */
export type StreakDetail =
  | { kind: 'tiers'; tiers: StreakTier[] }
  | { kind: 'run'; games: number; line: number }

export type StreakRow = {
  playerId: number
  /** League slug, for routing. */
  league: string
  leagueLabel: string
  name: string
  team: string
  /** Stat ticker, e.g. PTS or TB. */
  label: string
  /** Average over the last 10 games, both models. */
  rollingAvg: number
  opponent: string | null
  detail: StreakDetail
}

interface StreakWatchProps {
  rows: StreakRow[]
  meta: string
  showLeague?: boolean
  footerLink?: { label: string; to: string }
  className?: string
  emptyLabel?: string
}

/**
 * Tiered lines rather than a per-game hit strip: the API reports the value a
 * player cleared in 10, 9, 8 and 7 of their last 10 games, which is the actual
 * bettable fact. The ladder shades from solid (guaranteed) to faint (likeliest
 * to break).
 */
function TierLadder({ tiers }: { tiers: StreakTier[] }) {
  const opacity = [1, 0.72, 0.48, 0.28]
  return (
    <div className="flex gap-[6px] shrink-0">
      {tiers.map((t, i) => (
        <div key={t.pct} className="text-center w-[38px]">
          <div
            className="font-martian font-bold text-[11px] text-[#FF6B3D] tabular-nums"
            style={{ opacity: opacity[i] ?? 0.28 }}
          >
            {t.line}
          </div>
          <div className="font-martian text-[7px] text-[#665F5D] mt-[3px] tracking-[0.5px]">
            {t.pct / 10}/10
          </div>
        </div>
      ))}
    </div>
  )
}

/** An active run: N straight games clearing at least `line`. */
function RunBadge({ games, line }: { games: number; line: number }) {
  // Cap the pips so a 30-game streak doesn't blow out the row.
  const pips = Math.min(games, 12)
  return (
    <div className="flex items-center gap-[10px] shrink-0">
      <div className="flex gap-[3px]">
        {Array.from({ length: pips }, (_, i) => (
          <span key={i} className="w-[5px] h-[14px] rounded-[1.5px] bg-[#FF6B3D]" />
        ))}
        {games > pips && (
          <span className="font-martian text-[8px] text-[#FF6B3D] self-center ml-[2px]">
            +{games - pips}
          </span>
        )}
      </div>
      <div className="text-center w-[42px]">
        <div className="font-martian font-bold text-[13px] text-[#FF6B3D] tabular-nums">
          {line}+
        </div>
        <div className="font-martian text-[7px] text-[#665F5D] mt-[3px] tracking-[0.5px]">
          {games} STRAIGHT
        </div>
      </div>
    </div>
  )
}

export default function StreakWatch({
  rows,
  meta,
  showLeague = false,
  footerLink,
  className = '',
  emptyLabel = 'NO ACTIVE STREAKS',
}: StreakWatchProps) {
  return (
    <ModuleCard title="STREAK WATCH" meta={meta} className={className}>
      {rows.length === 0 && <EmptyState label={emptyLabel} compact />}
      {rows.map((row) => (
        <Link
          key={`${row.league}-${row.playerId}-${row.label}`}
          to={playerPath(row.league, row.playerId)}
          className="flex items-center gap-3 px-[18px] py-[13px] border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
        >
          {showLeague && <LeaguePill league={row.leagueLabel} />}
          <div className="min-w-0 flex-1">
            <div className="font-schibsted font-bold text-[13px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
              {row.name}
            </div>
            <div className="font-martian text-[9px] text-[#9A918F] mt-[2px] whitespace-nowrap overflow-hidden text-ellipsis">
              {row.team} · {row.label}
              {row.opponent ? ` · vs ${row.opponent}` : ''}
            </div>
          </div>
          {row.detail.kind === 'tiers' ? (
            <TierLadder tiers={row.detail.tiers} />
          ) : (
            <RunBadge games={row.detail.games} line={row.detail.line} />
          )}
          <div className="text-right w-[38px] shrink-0">
            <div className="font-martian font-bold text-[15px] text-[#EFEBE9] tabular-nums">
              {row.rollingAvg}
            </div>
            <div className="font-martian text-[7px] text-[#665F5D] mt-[3px] tracking-[0.5px]">
              L10 AVG
            </div>
          </div>
        </Link>
      ))}
      {footerLink && rows.length > 0 && (
        <Link
          to={footerLink.to}
          className="block font-martian font-bold text-[10px] text-[#FF6B3D] tracking-[1px] px-[18px] py-3 border-t border-[#221D1A]"
        >
          {footerLink.label}
        </Link>
      )}
    </ModuleCard>
  )
}
