import { useNavigate } from 'react-router-dom'
import { GameDetail } from '@/services/api'
import { cn } from '@/lib/utils'
import { formatSpreadLine } from '@/lib/formatSpread'

interface Props { data: GameDetail }

const STAT_COLS = [
  { key: 'points',            label: 'PTS' },
  { key: 'rebounds',          label: 'REB' },
  { key: 'assists',           label: 'AST' },
  { key: 'three_points_made', label: '3PM' },
  { key: 'minutes',           label: 'MIN' },
]

function BoxScoreTable({
  players,
  title,
  onPlayerClick,
}: {
  players: GameDetail['player_stats']
  title: string
  onPlayerClick: (id: number) => void
}) {
  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111]">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">{title}</span>
      </div>
      <div className="grid grid-cols-[2fr_repeat(5,1fr)] gap-2 px-4 py-2 border-b border-[#111]">
        <span className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed">Player</span>
        {STAT_COLS.map(c => (
          <span key={c.key} className="text-[9px] font-bold text-gray-700 uppercase tracking-wider font-condensed text-right">{c.label}</span>
        ))}
      </div>
      {players.map((p, i) => (
        <button
          key={i}
          onClick={() => onPlayerClick(p.player_id)}
          className="w-full grid grid-cols-[2fr_repeat(5,1fr)] gap-2 px-4 py-2.5 border-b border-[#0F0F0F] last:border-0 hover:bg-white/[0.03] transition-colors text-left"
        >
          <span className="text-[12px] font-semibold text-white font-condensed truncate hover:text-mint transition-colors">
            {p.players?.name ?? `Player ${p.player_id}`}
          </span>
          {STAT_COLS.map(c => (
            <span key={c.key} className="text-[12px] font-mono text-gray-300 text-right">
              {(p as unknown as Record<string, number>)[c.key] ?? 0}
            </span>
          ))}
        </button>
      ))}
      {players.length === 0 && (
        <div className="px-4 py-6 text-center text-[11px] text-gray-700 font-condensed">No box score recorded</div>
      )}
    </div>
  )
}

export default function CompletedView({ data }: Props) {
  const navigate = useNavigate()
  const homePlayers = data.player_stats.filter(p => p.team_id === data.game.home_team.id)
  const awayPlayers = data.player_stats.filter(p => p.team_id === data.game.away_team.id)
  const picksWithOutcome = data.picks.filter(p => p.did_hit != null)

  return (
    <div className="space-y-4">
      <BoxScoreTable
        players={awayPlayers}
        title={`${data.game.away_team.abbreviation} — Box Score`}
        onPlayerClick={id => navigate(`/player/${id}`)}
      />
      <BoxScoreTable
        players={homePlayers}
        title={`${data.game.home_team.abbreviation} — Box Score`}
        onPlayerClick={id => navigate(`/player/${id}`)}
      />

      {picksWithOutcome.length > 0 && (
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Prop Outcomes</span>
          </div>
          {picksWithOutcome.map((pick, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0">
              <div>
                <div className="text-[12px] font-condensed text-white">
                  {pick.player_name ?? `Entity ${pick.entity_id}`}
                  {' '}<span className="text-gray-600">·</span>{' '}
                  {pick.prop_type === 'spread'
                    ? <span className="font-mono">SPREAD {formatSpreadLine(null, pick.recommended_line)}</span>
                    : <>{pick.stat.toUpperCase()} <span className="font-mono">{pick.recommended_line}{pick.prop_type === 'player' ? '+' : ''}</span></>}
                </div>
                <div className="text-[9px] text-gray-700 font-condensed mt-0.5">
                  Edge <span className="font-mono">+{Math.round(pick.edge * 100)}%</span>
                  {pick.actual_result != null && (
                    <> · Actual <span className="font-mono">{pick.actual_result}</span></>
                  )}
                </div>
              </div>
              <span className={cn(
                'text-[12px] font-black font-condensed px-2 py-0.5 rounded',
                pick.did_hit === true  ? 'text-green-400 bg-green-400/10' :
                pick.did_hit === false ? 'text-red-400 bg-red-400/10' : 'text-gray-600'
              )}>
                {pick.did_hit === true ? 'HIT' : pick.did_hit === false ? 'MISS' : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
