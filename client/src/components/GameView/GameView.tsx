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
    setLoading(true)
    nbaApi.getGame(parseInt(id))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="overflow-y-auto h-full">
        <div className="px-6 py-5 max-w-[1400px] mx-auto space-y-3">
          <Skeleton className="h-7 w-32 bg-[#0F0F0F]" />
          <Skeleton className="h-20 w-full bg-[#0F0F0F]" />
          <Skeleton className="h-80 w-full bg-[#0F0F0F]" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="overflow-y-auto h-full flex items-center justify-center">
        <span className="text-[12px] text-gray-700 font-condensed uppercase tracking-widest">Game not found</span>
      </div>
    )
  }

  // derive spread / total from props
  const spreadProp = data.props.find(p => p.prop_type === 'spread')
  const totalProp  = data.props.find(p => p.prop_type === 'total')

  const formatSpread = () => {
    if (!spreadProp) return null
    const line = spreadProp.line ?? 0
    const team = spreadProp.team_id === data.game.home_team.id
      ? data.game.home_team.abbreviation
      : spreadProp.team_id === data.game.away_team.id
        ? data.game.away_team.abbreviation
        : null
    const sign = line > 0 ? '+' : ''
    return team ? `${team} ${sign}${line}` : `${sign}${line}`
  }

  const dateStr = new Date(data.game.game_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  return (
    <div className="overflow-y-auto h-full">
      <div className="px-6 py-5 max-w-[1400px] mx-auto space-y-4">

        {/* back nav */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-[10px] text-gray-700 hover:text-gray-400 transition-colors font-condensed tracking-widest uppercase"
        >
          <ArrowLeft size={11} /> Back
        </button>

        {/* ── game header ── */}
        <div className="bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between gap-4">

            {/* away team */}
            <button
              onClick={() => navigate(`/team/${data.game.away_team.id}`)}
              className="text-left hover:opacity-75 transition-opacity shrink-0"
            >
              <div className="text-[26px] font-black text-white font-mono leading-none">{data.game.away_team.abbreviation}</div>
              <div className="text-[9px] text-gray-700 font-condensed mt-1 uppercase tracking-wider">{data.game.away_team.name}</div>
              <div className="text-[8px] text-gray-700 font-condensed uppercase tracking-wider mt-0.5">away</div>
            </button>

            {/* center: score or VS + chips */}
            <div className="flex-1 flex flex-col items-center gap-2.5">
              {data.game.is_completed && data.game.away_score != null && data.game.home_score != null ? (
                <div className="flex items-center gap-3">
                  <span className={`text-[32px] font-black font-mono tabular-nums leading-none ${data.game.away_score > data.game.home_score ? 'text-white' : 'text-gray-600'}`}>
                    {data.game.away_score}
                  </span>
                  <span className="text-[16px] text-gray-700 font-mono">–</span>
                  <span className={`text-[32px] font-black font-mono tabular-nums leading-none ${data.game.home_score > data.game.away_score ? 'text-white' : 'text-gray-600'}`}>
                    {data.game.home_score}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] font-bold text-gray-700 font-condensed uppercase tracking-widest">VS</div>
              )}

              {/* chips row */}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {!data.game.is_completed && (
                  <span className="text-[8px] font-bold text-gray-600 font-condensed uppercase tracking-wider border border-[#1e1e1e] rounded px-2 py-0.5">
                    {dateStr}
                  </span>
                )}
                {data.game.is_completed && (
                  <span className="text-[8px] font-bold text-gray-600 font-condensed uppercase tracking-wider border border-[#1e1e1e] rounded px-2 py-0.5">
                    Final
                  </span>
                )}
                {spreadProp && formatSpread() && (
                  <span className="text-[8px] font-bold text-[#FF5F2E] bg-[#1c1400] border border-[#3a2800] rounded px-2 py-0.5 font-condensed uppercase tracking-wide">
                    {formatSpread()}
                  </span>
                )}
                {totalProp && totalProp.line != null && (
                  <span className="text-[8px] font-bold text-white bg-[#0e1a10] border border-[#1a3620] rounded px-2 py-0.5 font-condensed uppercase tracking-wide">
                    O/U {totalProp.line}
                  </span>
                )}
              </div>
            </div>

            {/* home team */}
            <button
              onClick={() => navigate(`/team/${data.game.home_team.id}`)}
              className="text-right hover:opacity-75 transition-opacity shrink-0"
            >
              <div className="text-[26px] font-black text-white font-mono leading-none">{data.game.home_team.abbreviation}</div>
              <div className="text-[9px] text-gray-700 font-condensed mt-1 uppercase tracking-wider">{data.game.home_team.name}</div>
              <div className="text-[8px] text-gray-700 font-condensed uppercase tracking-wider mt-0.5">home</div>
            </button>
          </div>
        </div>

        {/* ── state-based content ── */}
        {data.game.is_completed
          ? <CompletedView data={data} />
          : <UpcomingView data={data} />
        }

      </div>
    </div>
  )
}
