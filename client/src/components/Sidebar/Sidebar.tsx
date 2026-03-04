import { useEffect, useState } from 'react'
import { nbaApi, TodaysGame } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Calendar } from 'lucide-react'

export default function Sidebar() {
  const [games, setGames] = useState<TodaysGame[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    nbaApi.getTodaysGames()
      .then(setGames)
      .catch(() => setGames([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <aside className="w-52 flex-shrink-0 border-r border-[#1E1E1E] bg-[#0A0A0A] overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={14} className="text-[#2AFFC8]" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Today's Games</span>
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full bg-[#141414]" />
            ))}
          </div>
        )}

        {!loading && games.length === 0 && (
          <p className="text-xs text-gray-600">No games today</p>
        )}

        {!loading && games.map(game => (
          <div
            key={game.gameId}
            className="mb-3 p-3 bg-[#141414] rounded-lg border border-[#1E1E1E]"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-white">{game.away.team}</span>
              {game.away.score && (
                <span className="text-sm font-bold text-white">{game.away.score}</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{game.home.team}</span>
              {game.home.score && (
                <span className="text-sm font-bold text-white">{game.home.score}</span>
              )}
            </div>
            <div className="mt-1.5 text-xs text-[#2AFFC8]">{game.status}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}
