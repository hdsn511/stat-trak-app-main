import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { nbaApi, TeamDetail, TeamGameEntry } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function RecordBadge({ w, l, label }: { w: number; l: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-[15px] font-black font-mono text-white tabular-nums">
        {w}<span className="text-gray-700 mx-0.5">-</span>{l}
      </div>
      <div className="text-[8px] text-gray-600 font-condensed uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  )
}

function GameLogRow({ game, teamId, onClick }: { game: TeamGameEntry; teamId: number; onClick: () => void }) {
  const opp = game.is_home ? game.away_team : game.home_team
  const today = new Date().toISOString().slice(0, 10)
  const isUpcoming = game.game_date >= today

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[10px] text-gray-600 font-condensed w-5 flex-shrink-0">
          {game.is_home ? 'vs' : '@'}
        </span>
        <span className="text-[13px] font-bold text-white font-condensed">{opp.abbreviation}</span>
        {isUpcoming && (
          <span className="text-[8px] font-bold text-mint font-condensed uppercase tracking-widest px-1.5 py-0.5 border border-mint/25 rounded flex-shrink-0">
            Upcoming
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        {!isUpcoming && game.team_score != null && game.opp_score != null ? (
          <>
            <span className="text-[12px] font-mono text-gray-400 tabular-nums">
              {game.team_score}–{game.opp_score}
            </span>
            <span className={cn(
              'text-[11px] font-black font-condensed w-5 text-center',
              game.result === 'W' ? 'text-green-400' : 'text-red-400'
            )}>
              {game.result}
            </span>
          </>
        ) : (
          <span className="text-[10px] font-mono text-gray-700">{game.game_date}</span>
        )}
        <span className="text-[10px] font-mono text-gray-700 w-16 text-right">{game.game_date}</span>
      </div>
    </div>
  )
}

export default function TeamView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<TeamDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    nbaApi.getTeam(parseInt(id))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-48 bg-[#0F0F0F]" />
        <Skeleton className="h-24 w-full bg-[#0F0F0F]" />
        <Skeleton className="h-64 w-full bg-[#0F0F0F]" />
      </div>
    )
  }

  if (!data) return <div className="p-6 text-gray-600 font-condensed">Team not found</div>

  const { record } = data

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-white transition-colors font-condensed tracking-wide uppercase"
      >
        <ArrowLeft size={12} /> Back
      </button>

      {/* Team header */}
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#222] flex items-center justify-center text-xl font-black text-mint font-condensed flex-shrink-0">
          {data.team.abbreviation}
        </div>
        <div className="flex-1">
          <h1 className="text-[28px] font-bold text-white font-condensed leading-none">{data.team.name}</h1>
          <p className="text-[11px] text-gray-600 mt-1 font-condensed font-mono tabular-nums">
            {record.overall.w}-{record.overall.l}
          </p>
        </div>
      </div>

      {/* Splits */}
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed mb-4">Record</div>
        <div className="grid grid-cols-4 gap-4">
          <RecordBadge w={record.overall.w} l={record.overall.l} label="Overall" />
          <RecordBadge w={record.home.w}    l={record.home.l}    label="Home" />
          <RecordBadge w={record.away.w}    l={record.away.l}    label="Away" />
          <RecordBadge w={record.last10.w}  l={record.last10.l}  label="Last 10" />
        </div>
      </div>

      {/* Game log */}
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#111]">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Game Log</span>
        </div>
        {data.games.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">No games found</div>
        )}
        {data.games.map(game => (
          <GameLogRow
            key={game.id}
            game={game}
            teamId={data.team.id}
            onClick={() => navigate(`/game/${game.id}`)}
          />
        ))}
      </div>

      {/* Roster */}
      {data.roster.length > 0 && (
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Roster</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3">
            {data.roster.map(player => (
              <button
                key={player.id}
                onClick={() => navigate(`/player/${player.id}`)}
                className="flex items-center justify-between px-4 py-2.5 border-b border-r border-[#0F0F0F] cursor-pointer hover:bg-white/[0.02] transition-colors text-left"
              >
                <span className="text-[12px] font-semibold text-white font-condensed truncate">{player.name}</span>
                <span className="text-[10px] text-gray-600 font-condensed flex-shrink-0 ml-2">{player.position}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
