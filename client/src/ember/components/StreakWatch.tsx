import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import type { Matchup, SuggestionResult, SuggestionResultSet } from '@/services/api'
import PlayerAvatar from './PlayerAvatar'
import YesterdayResults from './YesterdayResults'
import TeamLogo from './TeamLogo'
import CardRecord from './CardRecord'
import { ClearStrip, ImpliedOddsNote, MatchupNote, PLAYER_ROW, PropTicket, ResultMark, StatTag } from './PropVisuals'
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
  /** `price` undefined: no Kalshi market for this league, so no price row. */
  | { kind: 'watch'; rung: number; depth: number; last10: number[]; price?: number | null; matchup: Matchup | null }

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
  /** Last 10 values, oldest first, for the bar chart (run/tier rows). */
  last10?: number[]
}

interface StreakWatchProps {
  rows: StreakRow[]
  meta: string
  showLeague?: boolean
  className?: string
  emptyLabel?: string
  /** Yesterday's graded snapshot of this card. */
  results?: SuggestionResultSet | null
  /** This card's cumulative record, for the header corner. */
  record?: { w: number; l: number } | null
}

/** Any streak as the bar-chart row: the line it clears and the last ten games against it. */
function asWatch(row: StreakRow): Extract<StreakDetail, { kind: 'watch' }> {
  const d = row.detail
  if (d.kind === 'watch') return d
  const last10 = row.last10 ?? []
  if (d.kind === 'run') return { kind: 'watch', rung: d.line, depth: d.games, last10, price: undefined, matchup: null }
  // Tier lines are x.5 (Kalshi style); the rung is the whole number that clears it.
  const rung = Math.ceil(d.tiers[0]?.line ?? 0)
  let depth = 0
  for (let i = last10.length - 1; i >= 0 && last10[i]! >= rung; i--) depth++
  return { kind: 'watch', rung, depth: depth || (d.tiers[0]?.cleared ?? 0), last10, price: undefined, matchup: null }
}

export default function StreakWatch({
  rows,
  meta,
  showLeague = false,
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
        return <WatchRow key={key} row={row} detail={asWatch(row)} yday={yday} showLeague={showLeague} />
      })}
      <div className="mt-auto">
        <YesterdayResults league={rows[0]?.league ?? 'nba'} set={results} />
        {/* Only when a row actually shows a price; trending cards show none, so no key. */}
        {rows.some((r) => r.detail.kind === 'watch' && r.detail.price !== undefined) && <ImpliedOddsNote />}
      </div>
    </ModuleCard>
  )
}

/** A run at a line (a Kalshi rung where one exists). Identity, the prop ticket, then the last ten games against the line. */
function WatchRow({ row, detail, yday, showLeague }: {
  row: StreakRow
  detail: Extract<StreakDetail, { kind: 'watch' }>
  yday?: SuggestionResult
  showLeague: boolean
}) {
  return (
    <Link
      to={playerPath(row.league, row.playerId, { stat: row.label, line: detail.rung, window: 10 })}
      className={`grid grid-cols-[minmax(0,1fr)_112px_30px] sm:grid-cols-[minmax(0,1fr)_112px_150px_30px] items-center gap-[18px] ${PLAYER_ROW} border-b border-[#221D1A] hover:bg-[#211C1A] transition-colors`}
    >
      <div className="min-w-0 flex items-center gap-3">
        {showLeague && <LeaguePill league={row.leagueLabel} />}
        <PlayerAvatar league={row.league} extId={row.extId} name={row.name} accent={teamAccent(row.league, row.team)} size={42} />
        <div className="min-w-0">
          <div className="font-schibsted font-bold text-[15px] text-[#EFEBE9] truncate" title={row.name}>{row.name}</div>
          <div className="mt-[3px] flex items-center gap-[5px] font-martian text-[11px] text-[#C9C2BE]">
            <TeamLogo league={row.league} abbr={row.team} size={13} />
            {row.team}
            <StatTag label={row.label} />
          </div>
          <div className="mt-[3px] truncate">
            <MatchupNote league={row.league} opponent={row.opponent} matchup={detail.matchup} label={row.label} />
          </div>
        </div>
      </div>
      <PropTicket rung={detail.rung} label={row.label} price={detail.price} />
      <div className="hidden sm:block">
        <ClearStrip values={detail.last10} rung={detail.rung} />
        <div className="flex justify-between gap-2 font-martian text-[10px] text-[#A8A09C] mt-[4px] tabular-nums whitespace-nowrap">
          <span className="text-[#3FBF7F]" title={`${detail.depth} games in a row at ${detail.rung}+`}>
            {detail.depth} straight
            {detail.depth < detail.last10.length && (
              <span className="text-[#A8A09C]"> · {detail.last10.filter((v) => v >= detail.rung).length}/{detail.last10.length}</span>
            )}
          </span>
          <span>L10 avg {row.rollingAvg}</span>
        </div>
      </div>
      <ResultMark hit={yday?.did_hit} actual={yday?.actual} />
    </Link>
  )
}
