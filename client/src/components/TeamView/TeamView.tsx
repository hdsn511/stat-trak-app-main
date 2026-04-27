import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { nbaApi, TeamDetail } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'

export default function TeamView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<TeamDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const today = new Date().toISOString().slice(0, 10)

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

  const completedGames = data.games.filter(g => g.game_date < today)
  const upcomingGames  = data.games.filter(g => g.game_date >= today)
  const homeGames      = completedGames.filter(g => g.is_home)
  const awayGames      = completedGames.filter(g => !g.is_home)

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
          <p className="text-[11px] text-gray-600 mt-1 font-condensed">
            <span className="font-mono">{completedGames.length}</span> games played ·
            {' '}<span className="font-mono">{homeGames.length}</span> home ·
            {' '}<span className="font-mono">{awayGames.length}</span> away
          </p>
        </div>
        {data.recent_avg_points != null && (
          <div className="text-center flex-shrink-0">
            <div className="text-[20px] font-black font-mono text-white tabular-nums leading-none">
              {data.recent_avg_points.toFixed(1)}
            </div>
            <div className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest mt-0.5">Pts/Player L14</div>
          </div>
        )}
      </div>

      {/* Game log */}
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#111]">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Game Log</span>
        </div>
        {/* Upcoming */}
        {upcomingGames.slice(0, 3).map(game => {
          const opp = game.is_home ? game.away_team : game.home_team
          return (
            <div
              key={game.id}
              onClick={() => navigate(`/game/${game.id}`)}
              className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] cursor-pointer hover:bg-white/[0.02] transition-colors"
            >
              <div className="text-[12px] font-condensed text-gray-400">
                {game.is_home ? 'vs' : '@'} <span className="text-white font-semibold">{opp.abbreviation}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-gray-600">{game.game_date}</span>
                <span className="text-[9px] font-bold text-mint font-condensed uppercase tracking-widest px-1.5 py-0.5 border border-mint/25 rounded">Upcoming</span>
              </div>
            </div>
          )
        })}
        {/* Completed */}
        {completedGames.map(game => {
          const opp = game.is_home ? game.away_team : game.home_team
          return (
            <div
              key={game.id}
              onClick={() => navigate(`/game/${game.id}`)}
              className="flex items-center justify-between px-4 py-3 border-b border-[#0F0F0F] last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
            >
              <div className="text-[12px] font-condensed text-gray-400">
                {game.is_home ? 'vs' : '@'} <span className="text-white font-semibold">{opp.abbreviation}</span>
              </div>
              <span className="text-[10px] font-mono text-gray-600">{game.game_date}</span>
            </div>
          )
        })}
        {data.games.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">No games found</div>
        )}
      </div>

      {/* Roster */}
      {data.roster.length > 0 && (
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Roster</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3">
            {data.roster.map(player => (
              <div
                key={player.id}
                onClick={() => navigate(`/player/${player.id}`)}
                className="flex items-center justify-between px-4 py-2.5 border-b border-r border-[#0F0F0F] cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-[12px] font-semibold text-white font-condensed truncate">{player.name}</span>
                <span className="text-[10px] text-gray-600 font-condensed flex-shrink-0 ml-2">{player.position}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
