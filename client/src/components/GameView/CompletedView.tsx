import { GameDetail } from '@/services/api'
import { cn } from '@/lib/utils'

interface Props { data: GameDetail }

const STAT_COLS = [
  { key: 'points',            label: 'PTS' },
  { key: 'rebounds',          label: 'REB' },
  { key: 'assists',           label: 'AST' },
  { key: 'three_points_made', label: '3PM' },
  { key: 'minutes',           label: 'MIN' },
]

function BoxScoreTable({ players, title }: { players: GameDetail['player_stats']; title: string }) {
  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111]">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">{title}</span>
      </div>
      {/* Header */}
      <div className="grid grid-cols-[2fr_repeat(5,1fr)] gap-2 px-4 py-2 border-b border-[#111]">
        <span className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed">Player</span>
        {STAT_COLS.map(c => (
          <span key={c.key} className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed text-right">{c.label}</span>
        ))}
      </div>
      {players.map((p, i) => (
        <div key={i} className="grid grid-cols-[2fr_repeat(5,1fr)] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] last:border-0 hover:bg-white/[0.02]">
          <span className="text-[12px] font-semibold text-white font-condensed truncate">
            {p.players?.name ?? `Player ${p.player_id}`}
          </span>
          {STAT_COLS.map(c => (
            <span key={c.key} className="text-[12px] font-mono text-gray-300 text-right">
              {(p as unknown as Record<string, number>)[c.key] ?? 0}
            </span>
          ))}
        </div>
      ))}
      {players.length === 0 && (
        <div className="px-4 py-6 text-center text-[11px] text-gray-700 font-condensed">No box score recorded</div>
      )}
    </div>
  )
}

export default function CompletedView({ data }: Props) {
  const homePlayers = data.player_stats.filter(p => p.team_id === data.game.home_team.id)
  const awayPlayers = data.player_stats.filter(p => p.team_id === data.game.away_team.id)

  const picksWithOutcome = data.picks.filter(p => p.did_hit != null)

  return (
    <div className="space-y-4">
      <BoxScoreTable players={awayPlayers} title={`${data.game.away_team.abbreviation} — Box Score`} />
      <BoxScoreTable players={homePlayers} title={`${data.game.home_team.abbreviation} — Box Score`} />

      {picksWithOutcome.length > 0 && (
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Prop Outcomes</span>
          </div>
          {picksWithOutcome.map((pick, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0">
              <div className="text-[12px] font-condensed text-white">
                Entity <span className="font-mono">{pick.entity_id}</span> · {pick.stat.toUpperCase()} <span className="font-mono">{pick.recommended_line}+</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-gray-500">Edge +{Math.round(pick.edge * 100)}%</span>
                <span className={cn(
                  'text-[12px] font-black font-condensed px-2 py-0.5 rounded',
                  pick.did_hit === true  ? 'text-green-400 bg-green-400/10' :
                  pick.did_hit === false ? 'text-red-400 bg-red-400/10' : 'text-gray-600'
                )}>
                  {pick.did_hit === true ? 'HIT' : pick.did_hit === false ? 'MISS' : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
