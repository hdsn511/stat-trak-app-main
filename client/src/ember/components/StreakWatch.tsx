import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import type { Matchup, SuggestionResult, SuggestionResultSet } from '@/services/api'
import PlayerAvatar from './PlayerAvatar'
import YesterdayResults from './YesterdayResults'
import TeamLogo from './TeamLogo'
import CardRecord from './CardRecord'
import { ClearStrip, MatchupNote, PropTicket, ResultMark } from './PropVisuals'
import LeaguePill from './LeaguePill'
import ModuleCard from './ModuleCard'
import { EmptyState } from './EntityState'

export type StreakTier = {
  /** Share of the sample cleared. */
  pct: number
  line: number
  /** Games cleared out of `of`; `of` is 10 in a full season, fewer early on. */
  cleared: number
  of: number
}

/**
 * The two streak models the API serves. NBA computes tiered lines over a fixed
 * 10-game window; MLB tracks an uncapped active run, because baseball counting
 * stats hit zero too often for a 10/10 line to ever populate.
 */
export type StreakDetail =
  | { kind: 'tiers'; tiers: StreakTier[] }
  | { kind: 'run'; games: number; line: number }
  /** NBA: a run at a Kalshi rung, with the last 10 games behind it. */
  | { kind: 'watch'; rung: number; depth: number; last10: number[]; price: number | null; matchup: Matchup | null }

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
  /** players.ext_id, for the headshot. */
  extId?: string | null
  /** Highest Kalshi rung the streak floor still clears. */
  suggested?: number | null
}

interface StreakWatchProps {
  rows: StreakRow[]
  meta: string
  showLeague?: boolean
  footerLink?: { label: string; to: string }
  className?: string
  emptyLabel?: string
  /** Yesterday's graded snapshot of this card. */
  results?: SuggestionResultSet | null
  /** This card's cumulative record, for the header corner. */
  record?: { w: number; l: number } | null
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
        <div key={t.cleared} className="text-center w-[38px]">
          <div
            className="font-martian font-bold text-[13px] text-[#FF6B3D] tabular-nums"
            style={{ opacity: opacity[i] ?? 0.28 }}
          >
            {t.line}
          </div>
          <div className="font-martian text-[10px] text-[#A8A09C] mt-[3px] tracking-[0.5px]">
            {t.cleared}/{t.of}
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
          <span className="font-martian text-[10px] text-[#FF6B3D] self-center ml-[2px]">
            +{games - pips}
          </span>
        )}
      </div>
      <div className="text-center w-[42px]">
        <div className="font-martian font-bold text-[13px] text-[#FF6B3D] tabular-nums">
          {line}+
        </div>
        <div className="font-martian text-[10px] text-[#A8A09C] mt-[3px] tracking-[0.5px]">
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
  results,
  record,
}: StreakWatchProps) {
  return (
    <ModuleCard title="STREAK WATCH" headerRight={<CardRecord meta={meta} record={record} />} className={className}>
      {rows.length === 0 && <EmptyState label={emptyLabel} compact />}
      {rows.map((row) => {
        const yday = results?.rows.find((r) => r.player_id === row.playerId && r.stat_label === row.label)
        const key = `${row.league}-${row.playerId}-${row.label}`
        if (row.detail.kind === 'watch') return <WatchRow key={key} row={row} detail={row.detail} yday={yday} showLeague={showLeague} />
        return (
          <Link
            key={key}
            to={playerPath(row.league, row.playerId)}
            className="flex items-center gap-3 px-5 py-4 border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
          >
            {showLeague && <LeaguePill league={row.leagueLabel} />}
            <PlayerAvatar league={row.league} extId={row.extId} name={row.name} accent={teamAccent(row.league, row.team)} size={36} />
            <div className="min-w-0 flex-1">
              <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] truncate">{row.name}</div>
              <div className="font-martian text-[11px] text-[#C9C2BE] mt-[2px] truncate">
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
              <div className="font-martian font-bold text-[15px] text-[#EFEBE9] tabular-nums">{row.rollingAvg}</div>
              <div className="font-martian text-[10px] text-[#A8A09C] mt-[3px] tracking-[0.5px]">L10 AVG</div>
            </div>
          </Link>
        )
      })}
      <YesterdayResults league={rows[0]?.league ?? 'nba'} set={results} />
      {footerLink && rows.length > 0 && (
        <Link
          to={footerLink.to}
          className="block font-martian font-bold text-[12px] text-[#FF6B3D] tracking-[1px] px-5 py-3 border-t border-[#221D1A]"
        >
          {footerLink.label}
        </Link>
      )}
    </ModuleCard>
  )
}

/** NBA: a run at a Kalshi rung. Identity, the prop ticket, then the last ten games against the line. */
function WatchRow({ row, detail, yday, showLeague }: {
  row: StreakRow
  detail: Extract<StreakDetail, { kind: 'watch' }>
  yday?: SuggestionResult
  showLeague: boolean
}) {
  return (
    <Link
      to={playerPath(row.league, row.playerId)}
      className="grid grid-cols-[minmax(0,1fr)_92px_30px] sm:grid-cols-[minmax(0,1fr)_92px_150px_30px] items-center gap-[18px] px-5 py-4 border-b border-[#221D1A] last:border-b-0 hover:bg-[#211C1A]"
    >
      <div className="min-w-0 flex items-center gap-3">
        {showLeague && <LeaguePill league={row.leagueLabel} />}
        <PlayerAvatar league={row.league} extId={row.extId} name={row.name} accent={teamAccent(row.league, row.team)} size={42} />
        <div className="min-w-0">
          <div className="font-schibsted font-bold text-[15px] text-[#EFEBE9] truncate">{row.name}</div>
          <div className="mt-[3px] flex items-center gap-[5px] font-martian text-[11px] text-[#C9C2BE]">
            <TeamLogo league={row.league} abbr={row.team} size={13} />
            {row.team}
          </div>
          <div className="mt-[3px] truncate">
            <MatchupNote league={row.league} opponent={row.opponent} matchup={detail.matchup} label={row.label} />
          </div>
        </div>
      </div>
      <PropTicket rung={detail.rung} label={row.label} price={detail.price} />
      <div className="hidden sm:block">
        <ClearStrip values={detail.last10} rung={detail.rung} />
        <div className="flex justify-between font-martian text-[10px] text-[#A8A09C] mt-[4px] tabular-nums whitespace-nowrap">
          <span className="text-[#FF6B3D]">{detail.depth} straight</span>
          <span>L10 avg {row.rollingAvg}</span>
        </div>
      </div>
      <ResultMark hit={yday?.did_hit} actual={yday?.actual} />
    </Link>
  )
}
