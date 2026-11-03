import { useState } from 'react'
import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import type { Matchup, SuggestionResultSet } from '@/services/api'
import PlayerAvatar from './PlayerAvatar'
import TeamLogo from './TeamLogo'
import YesterdayResults from './YesterdayResults'
import LeaguePill from './LeaguePill'
import ModuleCard from './ModuleCard'
import CardRecord from './CardRecord'
import { AvgTrack, MatchupNote, PropTicket, ResultMark } from './PropVisuals'
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
  delta: string
  /** Sort key; not rendered. */
  zScore: number
  /** players.ext_id, for the headshot. */
  extId?: string | null
  /** Kalshi rung nearest the L10 average, e.g. 10 for "10+". */
  suggested?: number | null
  /** Kalshi YES price for that rung, 0-1. */
  price?: number | null
  opponent?: string | null
  matchup?: Matchup | null
}

interface TrendingPlayersProps {
  rows: TrendingRow[]
  meta: string
  showLeague?: boolean
  className?: string
  emptyLabel?: string
  /** Yesterday's graded snapshot of this card. */
  results?: SuggestionResultSet | null
  /** This card's cumulative record, for the header corner. */
  record?: { w: number; l: number } | null
}

export default function TrendingPlayers({
  rows,
  meta,
  showLeague = false,
  className = '',
  emptyLabel = 'NO TRENDS AVAILABLE',
  results,
  record,
}: TrendingPlayersProps) {
  // One open explanation at a time, keyed by row + chip.
  const [openKey, setOpenKey] = useState<string | null>(null)
  return (
    <ModuleCard title="TRENDING PLAYERS" headerRight={<CardRecord meta={meta} record={record} />} className={className}>
      {rows.length === 0 && <EmptyState label={emptyLabel} compact />}
      {rows.map((row) => {
        const rowKey = `${row.league}-${row.playerId}-${row.stat}`
        const openDetail = row.chipDetails?.find((d) => openKey === `${rowKey}:${d.label}`)
        const yday = results?.rows.find((r) => r.player_id === row.playerId && r.stat_label === row.stat)
        return (
          <div key={rowKey} className="border-b border-[#221D1A] last:border-b-0">
            <Link
              to={playerPath(row.league, row.playerId)}
              className="grid grid-cols-[minmax(0,1fr)_92px_30px] sm:grid-cols-[minmax(0,1fr)_92px_150px_30px] items-center gap-[18px] px-5 py-4 hover:bg-[#211C1A]"
            >
              <div className="min-w-0 flex items-center gap-3">
                {showLeague && <LeaguePill league={row.leagueLabel} />}
                <PlayerAvatar
                  league={row.league}
                  extId={row.extId}
                  name={row.name}
                  accent={teamAccent(row.league, row.team)}
                  size={42}
                />
                <div className="min-w-0">
                  <div className="font-schibsted font-bold text-[15px] text-[#EFEBE9] truncate">{row.name}</div>
                  <div className="mt-[3px] flex items-center gap-[5px] font-martian text-[11px] text-[#C9C2BE]">
                    <TeamLogo league={row.league} abbr={row.team} size={13} />
                    {row.team}
                  </div>
                  <div className="mt-[3px] truncate">
                    <MatchupNote league={row.league} opponent={row.opponent} matchup={row.matchup} label={row.stat} />
                  </div>
                  {row.chips.length > 0 && (
                    <div className="flex flex-wrap gap-[6px] mt-[6px]">
                      {row.chips.slice(0, 2).map((chip) => {
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
                              setOpenKey(isOpen ? null : `${rowKey}:${chip}`)
                            }}
                            onKeyDown={(e) => {
                              if (has && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault()
                                setOpenKey(isOpen ? null : `${rowKey}:${chip}`)
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
                    </div>
                  )}
                </div>
              </div>
              <PropTicket rung={row.suggested} label={row.stat} price={row.price} />
              <div className="hidden sm:block">
                <AvgTrack season={row.seasonVal} recent={row.l10Val} rung={row.suggested} />
              </div>
              <ResultMark hit={yday?.did_hit} actual={yday?.actual} />
            </Link>
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
    </ModuleCard>
  )
}
