import type { Matchup, SuggestionResultSet } from '@/services/api'
import YesterdayResults from './YesterdayResults'
import CardRecord from './CardRecord'
import SuggestionRow, { RowTag } from './SuggestionRow'
import { ClearStrip, PropTicket, ResultMark } from './PropVisuals'
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
  className?: string
  emptyLabel?: string
  /** Yesterday's graded snapshot of this card; its W-L goes in the header. */
  results?: SuggestionResultSet | null
}

/**
 * Tiered lines: the value a player cleared in 10, 9, 8 and 7 of their last 10
 * games, shading from solid (guaranteed) to faint (likeliest to break).
 */
function TierLadder({ tiers }: { tiers: StreakTier[] }) {
  const opacity = [1, 0.72, 0.48, 0.28]
  return (
    <div className="flex gap-[6px] w-[160px]">
      {tiers.slice(0, 4).map((t, i) => (
        <div key={t.cleared} className="text-center flex-1">
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

/** An active run as pips, one per game (capped so a long run fits). */
function RunPips({ games }: { games: number }) {
  const pips = Math.min(games, 14)
  return (
    <div className="flex items-center gap-[3px] w-[160px] h-[34px]">
      {Array.from({ length: pips }, (_, i) => (
        <span key={i} className="w-[6px] h-[18px] rounded-[1.5px] bg-[#FF6B3D]" />
      ))}
      {games > pips && <span className="font-martian text-[10px] text-[#FF6B3D] ml-[2px]">+{games - pips}</span>}
    </div>
  )
}

/** The streak's line, how deep it runs, and the chart for it. */
function describe(row: StreakRow): { rung: number | null; price?: number | null; depth: string; viz: React.ReactNode } {
  const d = row.detail
  if (d.kind === 'watch') {
    return { rung: d.rung, price: d.price, depth: `${d.depth} straight`, viz: <ClearStrip values={d.last10} rung={d.rung} /> }
  }
  if (d.kind === 'run') {
    return { rung: d.line, depth: `${d.games} straight`, viz: <RunPips games={d.games} /> }
  }
  const top = d.tiers[0]
  return {
    rung: top?.line ?? null,
    depth: top ? `${top.cleared}/${top.of} games` : 'streak',
    viz: <TierLadder tiers={d.tiers} />,
  }
}

export default function StreakWatch({
  rows,
  meta,
  showLeague = false,
  className = '',
  emptyLabel = 'NO ACTIVE STREAKS',
  results,
}: StreakWatchProps) {
  const yesterday = results && results.rows.length > 0 ? results.record : null
  return (
    <ModuleCard
      title="STREAK WATCH"
      headerRight={<CardRecord meta={meta} label="YESTERDAY'S CARD" record={yesterday} />}
      className={`sugg-card ${className}`}
    >
      {rows.length === 0 && <EmptyState label={emptyLabel} compact />}
      {rows.map((row) => {
        const yday = results?.rows.find((r) => r.player_id === row.playerId && r.stat_label === row.label)
        const { rung, price, depth, viz } = describe(row)
        return (
          <div key={`${row.league}-${row.playerId}-${row.label}`} className="border-b border-[#221D1A] last:border-b-0">
            <SuggestionRow
              league={row.league}
              leagueLabel={row.leagueLabel}
              showLeague={showLeague}
              playerId={row.playerId}
              extId={row.extId}
              name={row.name}
              team={row.team}
              label={row.label}
              opponent={row.opponent}
              matchup={row.detail.kind === 'watch' ? row.detail.matchup : null}
              tags={
                <>
                  <RowTag strong>{depth}</RowTag>
                  <RowTag>L10 avg {row.rollingAvg}</RowTag>
                </>
              }
              ticket={<PropTicket rung={rung} label={row.label} price={row.detail.kind === 'watch' ? price : undefined} />}
              viz={viz}
              mark={<ResultMark hit={yday?.did_hit} actual={yday?.actual} />}
            />
          </div>
        )
      })}
      <YesterdayResults league={rows[0]?.league ?? 'nba'} set={results} />
    </ModuleCard>
  )
}
