import { Link } from 'react-router-dom'
import type { PlayerResultRow } from '../../services/sportqueryApi'

type Props = { row: PlayerResultRow }

function pickName(r: PlayerResultRow): string {
  return (r.name as string) ?? (r.player_name as string) ?? 'Unknown'
}

function pickId(r: PlayerResultRow): number | undefined {
  return (r.id as number) ?? (r.player_id as number)
}

function pickPrimaryStat(
  r: PlayerResultRow
): { label: string; value: string } | null {
  if (typeof r.z_score === 'number') {
    return { label: 'z-score', value: r.z_score.toFixed(2) }
  }
  if (typeof r.rolling_avg === 'number') {
    return { label: 'avg', value: r.rolling_avg.toFixed(1) }
  }
  if (typeof r.edge === 'number') {
    return {
      label: 'edge',
      value: `${((r.edge as number) * 100).toFixed(0)}%`,
    }
  }
  return null
}

export function CompactPlayerCard({ row }: Props) {
  const name = pickName(row)
  const id = pickId(row)
  const team = (row.team as string) ?? ''
  const position = (row.position as string) ?? ''
  const stat = pickPrimaryStat(row)

  const zScore = typeof row.z_score === 'number' ? row.z_score : null
  const z = zScore ?? 0
  const barWidth = Math.min(Math.abs(z) / 2, 1) * 100
  const barColor = z >= 0 ? 'bg-mint' : 'bg-under'

  const body = (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-xl p-3 hover:border-mint/40 transition-colors">
      <div className="flex items-center justify-between mb-1">
        <div className="font-sans text-sm text-white truncate">{name}</div>
        {stat && (
          <div className="text-[10px] font-condensed uppercase tracking-[0.2em] text-mint">
            {stat.value}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500">
          {team}
          {position ? ` • ${position}` : ''}
        </div>
        {stat && (
          <div className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-600">
            {stat.label}
          </div>
        )}
      </div>
      {zScore !== null && (
        <div className="mt-2 h-0.5 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      )}
    </div>
  )

  return id ? <Link to={`/player/${id}`}>{body}</Link> : body
}
