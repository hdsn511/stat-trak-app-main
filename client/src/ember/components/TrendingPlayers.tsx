import { useState } from 'react'
import { Link } from 'react-router-dom'
import { playerPath } from '@/lib/paths'
import LeaguePill from './LeaguePill'
import ModuleCard from './ModuleCard'
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
}

interface TrendingPlayersProps {
  rows: TrendingRow[]
  meta: string
  showLeague?: boolean
  className?: string
  emptyLabel?: string
}

export default function TrendingPlayers({
  rows,
  meta,
  showLeague = false,
  className = '',
  emptyLabel = 'NO TRENDS AVAILABLE',
}: TrendingPlayersProps) {
  // One open explanation at a time, keyed by row + chip.
  const [openKey, setOpenKey] = useState<string | null>(null)
  return (
    <ModuleCard title="TRENDING PLAYERS" meta={meta} className={className}>
      {rows.length === 0 && <EmptyState label={emptyLabel} compact />}
      {rows.map((row) => {
        const max = Math.max(row.seasonVal, row.l10Val) || 1
        const rowKey = `${row.league}-${row.playerId}-${row.stat}`
        const openDetail = row.chipDetails?.find((d) => openKey === `${rowKey}:${d.label}`)
        return (
          <div key={rowKey} className="border-b border-[#221D1A] last:border-b-0">
            <Link
              to={playerPath(row.league, row.playerId)}
              className={`grid items-center gap-[14px] px-[18px] py-[14px] hover:bg-[#211C1A] ${
                showLeague
                  ? 'grid-cols-[26px_38px_1fr_auto_150px_52px]'
                  : 'grid-cols-[26px_1fr_auto_150px_52px]'
              }`}
            >
              <span className="font-martian font-bold text-[14px] text-[#A8A09C]">
                {String(row.rank).padStart(2, '0')}
              </span>
              {showLeague && <LeaguePill league={row.leagueLabel} />}
              <div className="min-w-0">
                <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                  {row.name}
                </div>
                <div className="font-martian text-[11px] text-[#C9C2BE] mt-[2px]">
                  {row.team} · {row.stat}
                </div>
              </div>
              <div className="flex gap-[6px]">
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
                      className={`font-martian font-medium text-[11px] uppercase border rounded-[3px] px-[7px] py-[3px] whitespace-nowrap ${
                        has ? 'cursor-pointer hover:bg-[rgba(255,107,61,0.18)]' : ''
                      } ${
                        isOpen
                          ? 'bg-[#FF6B3D] text-[#14100F] border-[#FF6B3D]'
                          : 'text-[#FF6B3D] border-[rgba(255,107,61,0.5)] bg-[rgba(255,107,61,0.08)]'
                      }`}
                    >
                      {chip}
                      {has ? ' ⓘ' : ''}
                    </span>
                  )
                })}
              </div>
              <div className="flex flex-col gap-[5px] w-[150px]">
                <div className="flex items-center gap-[6px]">
                  <div className="flex-1 h-1 rounded-[2px] bg-[#2C2624] overflow-hidden">
                    <div
                      className="h-full rounded-[2px] bg-[#665F5D]"
                      style={{ width: `${(row.seasonVal / max) * 100}%` }}
                    />
                  </div>
                  <span className="font-martian text-[11px] text-[#C9C2BE] w-[32px] text-right shrink-0">
                    {row.seasonVal}
                  </span>
                </div>
                <div className="flex items-center gap-[6px]">
                  <div className="flex-1 h-1 rounded-[2px] bg-[#2C2624] overflow-hidden">
                    <div
                      className="h-full rounded-[2px] bg-[#FF6B3D]"
                      style={{ width: `${(row.l10Val / max) * 100}%` }}
                    />
                  </div>
                  <span className="font-martian font-bold text-[12px] text-[#FF6B3D] w-[32px] text-right shrink-0">
                    {row.l10Val}
                  </span>
                </div>
              </div>
              <span className="font-martian font-bold text-[13px] text-[#FF6B3D] text-right">
                {row.delta}
              </span>
            </Link>
            {openDetail && (
              <div className="mx-[18px] mb-[14px] rounded-md border border-[rgba(255,107,61,0.35)] bg-[#17120F] px-[14px] py-[12px]">
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
    </ModuleCard>
  )
}
