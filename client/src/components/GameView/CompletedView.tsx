import { useNavigate } from 'react-router-dom'
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

function BoxScoreTable({
  players,
  teamAbbr,
  onPlayer,
}: {
  players: GameDetail['player_stats']
  teamAbbr: string
  onPlayer: (id: number) => void
}) {
  const sorted = [...players].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))

  return (
    <div className="bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111] flex items-center justify-between">
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.15em] font-condensed">
          {teamAbbr} — Box Score
        </span>
        <span className="text-[8px] text-gray-700 font-condensed">{sorted.length} players</span>
      </div>

      {/* col headers */}
      <div className="grid grid-cols-[2fr_repeat(5,_minmax(0,_1fr))] gap-x-2 px-4 py-2 border-b border-[#0f0f0f]">
        <span className="text-[8px] font-bold text-gray-700 uppercase tracking-wider font-condensed">Player</span>
        {STAT_COLS.map(c => (
          <span key={c.key} className="text-[8px] font-bold text-gray-700 uppercase tracking-wider font-condensed text-right">
            {c.label}
          </span>
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="px-4 py-6 text-center text-[11px] text-gray-700 font-condensed">No box score recorded</div>
      )}

      {sorted.map((p, i) => {
        const pts = (p as unknown as Record<string, number>)['points'] ?? 0
        const isTop = pts === Math.max(...sorted.map(x => (x as unknown as Record<string, number>)['points'] ?? 0))

        return (
          <button
            key={i}
            onClick={() => onPlayer(p.player_id)}
            className="w-full grid grid-cols-[2fr_repeat(5,_minmax(0,_1fr))] gap-x-2 px-4 py-2.5 border-b border-[#0a0a0a] last:border-0 hover:bg-white/[0.03] transition-colors text-left"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={cn(
                'text-[12px] font-semibold truncate',
                isTop ? 'text-white' : 'text-gray-300'
              )}>
                {p.players?.name ?? `Player ${p.player_id}`}
              </span>
              {p.players?.position && (
                <span className="text-[8px] text-gray-700 font-condensed uppercase shrink-0">{p.players.position}</span>
              )}
            </div>
            {STAT_COLS.map(c => {
              const val = (p as unknown as Record<string, number>)[c.key] ?? 0
              const isHigh = c.key === 'points' && isTop
              return (
                <span key={c.key} className={cn(
                  'text-[12px] font-mono text-right tabular-nums',
                  isHigh ? 'text-white font-bold' : 'text-gray-500'
                )}>
                  {val}
                </span>
              )
            })}
          </button>
        )
      })}
    </div>
  )
}

function PropOutcomes({ picks }: { picks: GameDetail['picks'] }) {
  const settled = picks.filter(p => p.did_hit != null)
  if (settled.length === 0) return null

  const hits = settled.filter(p => p.did_hit).length
  const hitPct = Math.round((hits / settled.length) * 100)

  return (
    <div className="bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111] flex items-center justify-between">
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.15em] font-condensed">Prop Outcomes</span>
        <span className="text-[9px] font-mono text-white">{hits}/{settled.length} hit · {hitPct}%</span>
      </div>
      <div className="divide-y divide-[#0a0a0a]">
        {settled.map((pick, i) => {
          const STAT_LBL: Record<string, string> = {
            pts: 'PTS', reb: 'REB', ast: 'AST', points: 'PTS', rebounds: 'REB', assists: 'AST',
            three_points_made: '3PM',
          }
          const name = pick.player_name ?? `Entity ${pick.entity_id}`
          const statLabel = STAT_LBL[pick.stat] ?? pick.stat.toUpperCase()

          return (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-white truncate">
                  {name}
                  <span className="text-gray-600 font-normal ml-2">{statLabel} O {pick.recommended_line}+</span>
                </div>
                <div className="text-[9px] text-gray-700 font-condensed mt-0.5 flex items-center gap-3">
                  <span>Hit rate <span className="font-mono text-gray-500">{Math.round(pick.hit_rate * 100)}%</span></span>
                  <span>Edge <span className="font-mono text-[#FF5F2E]">+{Math.round(pick.edge * 100)}%</span></span>
                  {pick.actual_result != null && (
                    <span>Result <span className="font-mono text-gray-400">{pick.actual_result}</span></span>
                  )}
                </div>
              </div>
              <span className={cn(
                'text-[11px] font-black font-condensed px-2.5 py-1 rounded-lg ml-4 shrink-0 uppercase tracking-wide',
                pick.did_hit === true
                  ? 'bg-green-950 text-green-400 border border-green-900'
                  : 'bg-red-950 text-red-400 border border-red-900'
              )}>
                {pick.did_hit ? 'HIT' : 'MISS'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function CompletedView({ data }: Props) {
  const navigate = useNavigate()
  const homeP = data.player_stats.filter(p => p.team_id === data.game.home_team.id)
  const awayP = data.player_stats.filter(p => p.team_id === data.game.away_team.id)

  return (
    <div className="space-y-4">
      <PropOutcomes picks={data.picks} />
      <BoxScoreTable
        players={awayP}
        teamAbbr={data.game.away_team.abbreviation}
        onPlayer={id => navigate(`/player/${id}`)}
      />
      <BoxScoreTable
        players={homeP}
        teamAbbr={data.game.home_team.abbreviation}
        onPlayer={id => navigate(`/player/${id}`)}
      />
    </div>
  )
}
