import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { nbaApi, GameDetail } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import UpcomingView from './UpcomingView'
import CompletedView from './CompletedView'

export default function GameView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<GameDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    nbaApi.getGame(parseInt(id))
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

  if (!data) {
    return <div className="p-6 text-gray-600 font-condensed">Game not found</div>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-white transition-colors font-condensed tracking-wide uppercase"
      >
        <ArrowLeft size={12} /> Back
      </button>

      {/* Game header */}
      <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(`/team/${data.game.away_team.id}`)}
            className="text-center flex-1 hover:opacity-80 transition-opacity"
          >
            <div className="text-[22px] font-bold text-white font-condensed">{data.game.away_team.abbreviation}</div>
            <div className="text-[11px] text-gray-600 font-condensed">{data.game.away_team.name}</div>
          </button>
          <div className="text-center px-6">
            {data.game.is_completed && data.game.away_score != null && data.game.home_score != null ? (
              <>
                <div className="text-[11px] text-gray-600 font-condensed uppercase tracking-widest">Final</div>
                <div className="text-[22px] font-black text-white font-mono mt-0.5 tabular-nums">
                  {data.game.away_score} <span className="text-gray-700 text-[16px]">–</span> {data.game.home_score}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] text-gray-600 font-condensed uppercase tracking-widest">
                  {new Date(data.game.game_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
                <div className="text-[13px] font-black text-gray-500 font-condensed mt-1">VS</div>
              </>
            )}
          </div>
          <button
            onClick={() => navigate(`/team/${data.game.home_team.id}`)}
            className="text-center flex-1 hover:opacity-80 transition-opacity"
          >
            <div className="text-[22px] font-bold text-white font-condensed">{data.game.home_team.abbreviation}</div>
            <div className="text-[11px] text-gray-600 font-condensed">{data.game.home_team.name}</div>
          </button>
        </div>
      </div>

      {data.game.is_completed
        ? <CompletedView data={data} />
        : <UpcomingView data={data} />
      }
    </div>
  )
}
