import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ModuleCard } from '@/ember/components'
import { StandingRow } from '@/ember/data/nbaFixtures'

interface StandingsCardProps {
  east: StandingRow[]
  west: StandingRow[]
}

const formatPct = (pct: number) => pct.toFixed(3).replace(/^0/, '')

interface ConferenceTableProps {
  label: string
  rows: StandingRow[]
  expanded: boolean
  onTeamClick: () => void
  className?: string
}

function ConferenceTable({ label, rows, expanded, onTeamClick, className = '' }: ConferenceTableProps) {
  const shown = expanded ? rows : rows.slice(0, 10)

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
      {shown.map((row) => (
        <div
          key={row.abbr}
          onClick={onTeamClick}
          className="grid grid-cols-[26px_1fr_58px_44px_64px_34px] gap-[10px] items-center px-[18px] py-2 border-t border-[#221D1A] hover:bg-[#211C1A] cursor-pointer"
        >
          <span className="font-martian text-[10px] text-[#665F5D]">{row.rank}</span>
          <div className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
            <span className="font-schibsted font-bold text-[12px] text-[#EFEBE9]">{row.abbr}</span>{' '}
            <span className="font-schibsted text-[11px] text-[#9A918F]">{row.name}</span>
          </div>
          <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right">
            {row.w}–{row.l}
          </span>
          <span className="font-martian text-[10px] text-[#9A918F] text-right">
            {formatPct(row.pct)}
          </span>
          <div className="w-full h-[4px] rounded-[2px] bg-[#2C2624] overflow-hidden">
            <div
              className="h-full rounded-[2px] bg-[#FF6B3D]"
              style={{ width: `${row.l10 * 100}%` }}
            />
          </div>
          <span
            className={`font-martian font-bold text-[11px] text-right ${
              row.streak.startsWith('W') ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'
            }`}
          >
            {row.streak}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function StandingsCard({ east, west }: StandingsCardProps) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const openTeam = () => navigate('/sportquery')

  return (
    <ModuleCard
      title="STANDINGS"
      meta={expanded ? '2025–26 SEASON · FULL LEAGUE' : '2025–26 SEASON · TOP 10 PER CONFERENCE'}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
      >
        <ConferenceTable
          label="EASTERN"
          rows={east}
          expanded={expanded}
          onTeamClick={openTeam}
          className="md:border-r md:border-[#27221F]"
        />
        <ConferenceTable
          label="WESTERN"
          rows={west}
          expanded={expanded}
          onTeamClick={openTeam}
        />
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="block w-full text-center p-3 border-t border-[#27221F] font-martian font-bold text-[10px] text-[#FF6B3D] tracking-[1.5px] hover:text-[#FFD9C9] cursor-pointer"
      >
        {expanded ? 'SHOW TOP 10 ↑' : 'SHOW ALL 30 ↓'}
      </button>
    </ModuleCard>
  )
}
