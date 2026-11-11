import { useState } from 'react'
import type { Matchup, SuggestionResultSet } from '@/services/api'
import YesterdayResults from './YesterdayResults'
import ModuleCard from './ModuleCard'
import CardRecord from './CardRecord'
import SuggestionRow from './SuggestionRow'
import { ImpliedOddsNote, PropTicket, ResultMark, TrendBars } from './PropVisuals'
import { EmptyState } from './EntityState'

export type TrendingRow = {
  rank: number
  playerId: number
  /** League slug, for routing. */
  league: string
  leagueLabel: string
  name: string
  team: string
  stat: string
  chips: string[]
  /** Quantified explanation for each chip, shown when it is clicked. */
  chipDetails?: { label: string; summary: string; lines: string[] }[]
  seasonVal: number
  l10Val: number
  /** Games in the recent sample (10, or fewer early in an NFL season). */
  window?: number
  delta: string
  /** Sort key; not rendered. */
  zScore: number
  /** players.ext_id, for the headshot. */
  extId?: string | null
  /** Kalshi rung nearest the L10 average, e.g. 10 for "10+". */
  suggested?: number | null
  opponent?: string | null
  matchup?: Matchup | null
}

interface TrendingPlayersProps {
  rows: TrendingRow[]
  meta: string
  showLeague?: boolean
  className?: string
  emptyLabel?: string
  /** Yesterday's graded snapshot of this card; its W-L goes in the header. */
  results?: SuggestionResultSet | null
}

export default function TrendingPlayers({
  rows,
  meta,
  showLeague = false,
  className = '',
  emptyLabel = 'NO TRENDS AVAILABLE',
  results,
}: TrendingPlayersProps) {
  // One open explanation at a time, keyed by row + chip.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const yesterday = results && results.rows.length > 0 ? results.record : null
  return (
    <ModuleCard
      title="TRENDING PLAYERS"
      headerRight={<CardRecord meta={meta} label="YESTERDAY'S RECORD" record={yesterday} />}
      className={`sugg-card ${className}`}
    >
      {rows.length === 0 && <EmptyState label={emptyLabel} compact />}
      {rows.map((row) => {
        const rowKey = `${row.league}-${row.playerId}-${row.stat}`
        const openDetail = row.chipDetails?.find((d) => openKey === `${rowKey}:${d.label}`)
        const yday = results?.rows.find((r) => r.player_id === row.playerId && r.stat_label === row.stat)
        const toggle = (chip: string, isOpen: boolean) => setOpenKey(isOpen ? null : `${rowKey}:${chip}`)
        return (
          <div key={rowKey} className="border-b border-[#221D1A] last:border-b-0">
            <SuggestionRow
              league={row.league}
              leagueLabel={row.leagueLabel}
              showLeague={showLeague}
              playerId={row.playerId}
              extId={row.extId}
              name={row.name}
              team={row.team}
              label={row.stat}
              opponent={row.opponent}
              matchup={row.matchup}
              tags={row.chips.slice(0, 2).map((chip) => {
                const has = row.chipDetails?.some((d) => d.label === chip)
                const isOpen = openKey === `${rowKey}:${chip}`
                return (
                  <span
                    key={chip}
                    role={has ? 'button' : undefined}
                    tabIndex={has ? 0 : undefined}
                    aria-expanded={has ? isOpen : undefined}
                    title={has ? 'Click for the numbers behind this' : undefined}
                    onClick={(e) => {
                      if (!has) return
                      e.preventDefault()
                      toggle(chip, isOpen)
                    }}
                    onKeyDown={(e) => {
                      if (has && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        toggle(chip, isOpen)
                      }
                    }}
                    className={`font-martian text-[10px] uppercase border rounded-[3px] px-[6px] py-[2px] whitespace-nowrap ${
                      has ? 'cursor-pointer hover:bg-[rgba(255,107,61,0.18)]' : ''
                    } ${
                      isOpen
                        ? 'bg-[#FF6B3D] text-[#14100F] border-[#FF6B3D]'
                        : 'text-[#FF6B3D] border-[rgba(255,107,61,0.4)]'
                    }`}
                  >
                    {chip}
                  </span>
                )
              })}
              ticket={<PropTicket rung={row.suggested} label={row.stat} />}
              viz={<TrendBars season={row.seasonVal} recent={row.l10Val} window={row.window} rung={row.suggested} />}
              mark={<ResultMark hit={yday?.did_hit} actual={yday?.actual} />}
            />
            {openDetail && (
              <div className="mx-5 mb-4 rounded-md border border-[rgba(255,107,61,0.35)] bg-[#17120F] px-[14px] py-[12px]">
                <div className="font-martian font-bold text-[12px] text-[#FF6B3D] tracking-[0.5px]">
                  {openDetail.label} · {openDetail.summary}
                </div>
                <ul className="mt-2 flex flex-col gap-[5px]">
                  {openDetail.lines.map((l) => (
                    <li key={l} className="font-schibsted text-[13px] text-[#D8D2CE] leading-snug">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
      <YesterdayResults league={rows[0]?.league ?? 'nba'} set={results} />
      <ImpliedOddsNote />
    </ModuleCard>
  )
}
