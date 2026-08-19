import { useState } from 'react'
import { Link } from 'react-router-dom'
import ModuleCard from '@/ember/components/ModuleCard'
import { EmptyState } from '@/ember/components/EntityState'
import type { Standing } from '@/services/api'
import { teamPath } from '@/lib/paths'

interface StandingsCardProps {
  league: string
  standings: Standing[]
  loading?: boolean
}

const formatPct = (pct: number) => pct.toFixed(3).replace(/^0/, '')

const formatStreak = (s: number) => (s === 0 ? '—' : `${s > 0 ? 'W' : 'L'}${Math.abs(s)}`)

function Row({ league, rank, row }: { league: string; rank: number; row: Standing }) {
  const l10Games = row.last10.w + row.last10.l + row.last10.t
  const l10Share = l10Games > 0 ? row.last10.w / l10Games : 0

  return (
    <Link
      to={teamPath(league, row.team_id)}
      className="grid grid-cols-[26px_1fr_58px_44px_64px_34px] gap-[10px] items-center px-[18px] py-2 border-t border-[#221D1A] hover:bg-[#211C1A]"
    >
      <span className="font-martian text-[10px] text-[#665F5D]">{rank}</span>
      <div className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
        <span className="font-schibsted font-bold text-[12px] text-[#EFEBE9]">
          {row.abbreviation}
        </span>{' '}
        <span className="font-schibsted text-[11px] text-[#9A918F]">{row.name}</span>
      </div>
      <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right tabular-nums">
        {/* Hockey reads W-L-OTL; the NFL's third number is ties. */}
        {row.w}–{row.l}
        {row.otl > 0 ? `–${row.otl}` : row.t > 0 ? `–${row.t}` : ''}
      </span>
      <span className="font-martian text-[10px] text-[#9A918F] text-right tabular-nums">
        {formatPct(row.pct)}
      </span>
      <div className="w-full h-[4px] rounded-[2px] bg-[#2C2624] overflow-hidden">
        <div
          className="h-full rounded-[2px] bg-[#FF6B3D]"
          style={{ width: `${l10Share * 100}%` }}
        />
      </div>
      <span
        className={`font-martian font-bold text-[11px] text-right ${
          row.streak > 0 ? 'text-[#3FBF7F]' : row.streak < 0 ? 'text-[#FF6B5C]' : 'text-[#665F5D]'
        }`}
      >
        {formatStreak(row.streak)}
      </span>
    </Link>
  )
}

function Column({
  label,
  league,
  rows,
  startRank,
  className = '',
}: {
  label: string
  league: string
  rows: Standing[]
  startRank: number
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3 px-[18px] py-3 border-b border-[#27221F]">
        <span className="font-chakra italic font-bold text-[13px] text-[#EFEBE9] tracking-[0.5px]">
          {label}
        </span>
        <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] whitespace-nowrap">
          W–L · PCT · L10 · STRK
        </span>
      </div>
      {rows.map((row, i) => (
        <Row key={row.team_id} league={league} rank={startRank + i} row={row} />
      ))}
    </div>
  )
}

// Alphabetical is the sane default (and what NHL's EASTERN/WESTERN already
// ships as), but the NBA's own broadcasts and standings pages put the
// Western Conference on the left — so it gets an explicit override rather
// than inheriting an ordering that happens to read backwards for that sport.
const CONFERENCE_ORDER: Partial<Record<string, string[]>> = {
  nba: ['WESTERN', 'EASTERN'],
}

/** Two conferences, in a per-league stable order, when the rows carry one. */
function byConference(league: string, rows: Standing[]): [string, Standing[]][] | null {
  if (!rows.every((r) => r.conference)) return null
  const groups = new Map<string, Standing[]>()
  for (const row of rows) {
    const key = row.conference!
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  // Only a genuine two-conference split is worth the side-by-side layout.
  if (groups.size !== 2) return null

  const preferred = CONFERENCE_ORDER[league]
  const rank = (name: string) => {
    const i = preferred?.indexOf(name) ?? -1
    return i === -1 ? Infinity : i
  }
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * Standings by win percentage. Split by conference when the rows carry one —
 * the analytics pipeline supplies it for the leagues it has processed — and
 * otherwise as one league-wide table, since inventing an East/West label from
 * a derived ranking would be guesswork.
 */
export default function StandingsCard({ league, standings, loading }: StandingsCardProps) {
  const [expanded, setExpanded] = useState(false)

  if (standings.length === 0) {
    return (
      <ModuleCard title="STANDINGS" meta={loading ? 'LOADING…' : 'NO RESULTS YET'}>
        <EmptyState
          label={loading ? 'LOADING STANDINGS…' : 'NO COMPLETED GAMES THIS SEASON'}
          compact
        />
      </ModuleCard>
    )
  }

  const conferences = byConference(league, standings)

  if (conferences) {
    const perSide = expanded ? Infinity : 8
    return (
      <ModuleCard
        title="STANDINGS"
        meta={`${league.toUpperCase()} · BY CONFERENCE`}
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        >
          {conferences.map(([name, rows], i) => (
            <Column
              key={name}
              label={name.toUpperCase()}
              league={league}
              rows={rows.slice(0, perSide)}
              startRank={1}
              className={i === 0 ? 'md:border-r md:border-[#27221F]' : ''}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="block w-full text-center p-3 border-t border-[#27221F] font-martian font-bold text-[10px] text-[#FF6B3D] tracking-[1.5px] hover:text-[#FFD9C9] cursor-pointer"
        >
          {expanded ? 'SHOW TOP 8 ↑' : 'SHOW FULL CONFERENCES ↓'}
        </button>
      </ModuleCard>
    )
  }

  const shown = expanded ? standings : standings.slice(0, 20)
  const half = Math.ceil(shown.length / 2)
  const first = shown.slice(0, half)
  const second = shown.slice(half)

  return (
    <ModuleCard
      title="STANDINGS"
      meta={`${league.toUpperCase()} · ${expanded ? `ALL ${standings.length}` : `TOP ${shown.length}`} BY WIN PCT`}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Column
          label={`1–${first.length}`}
          league={league}
          rows={first}
          startRank={1}
          className="md:border-r md:border-[#27221F]"
        />
        {second.length > 0 && (
          <Column
            label={`${half + 1}–${shown.length}`}
            league={league}
            rows={second}
            startRank={half + 1}
          />
        )}
      </div>
      {standings.length > 20 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="block w-full text-center p-3 border-t border-[#27221F] font-martian font-bold text-[10px] text-[#FF6B3D] tracking-[1.5px] hover:text-[#FFD9C9] cursor-pointer"
        >
          {expanded ? 'SHOW TOP 20 ↑' : `SHOW ALL ${standings.length} ↓`}
        </button>
      )}
    </ModuleCard>
  )
}
