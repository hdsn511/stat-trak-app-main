import { useEffect, useState } from 'react'
import { nbaApi, TodaysGame } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Calendar } from 'lucide-react'

function isLive(status: string) {
  return /Q\d|Half|OT/i.test(status)
}

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
    <aside className="w-52 flex-shrink-0 border-r border-[#141414] bg-[#080808] overflow-y-auto">
      <div className="p-3.5">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#141414]">
          <Calendar size={12} className="text-mint" />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">Today's Games</span>
        </div>

        {loading && (
          <div className="space-y-2.5">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-[80px] w-full bg-[#0F0F0F]" />
            ))}
          </div>
        )}

        {!loading && games.length === 0 && (
          <p className="text-[11px] text-gray-700 text-center py-8 font-condensed">No games today</p>
        )}

        {!loading && games.map(game => {
          const live = isLive(game.status)
          return (
            <Card
              key={game.gameId}
              className="mb-2.5 rounded-xl bg-[#0D0D0D] border-[#161616] shadow-none hover:border-[#222] transition-colors"
            >
              <CardContent className="p-3">
                {/* Status row */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  {live && (
                    <span className="w-1.5 h-1.5 rounded-full bg-mint animate-pulse-live flex-shrink-0" />
                  )}
                  <span className={`text-[10px] font-bold font-condensed tracking-widest uppercase ${live ? 'text-mint' : 'text-gray-700'}`}>
                    {game.status}
                  </span>
                </div>

                {/* Away */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-semibold text-gray-300 font-condensed tracking-wide leading-none">
                    {game.away.team}
                  </span>
                  {game.away.score != null && (
                    <span className={`text-[13px] font-black font-mono tabular-nums leading-none ${live ? 'text-white' : 'text-gray-500'}`}>
                      {game.away.score}
                    </span>
                  )}
                </div>

                {/* VS divider */}
                <div className="flex items-center gap-2 my-1.5">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <span className="text-[9px] text-gray-800 font-condensed font-bold">VS</span>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                {/* Home */}
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[12px] font-semibold text-gray-300 font-condensed tracking-wide leading-none">
                    {game.home.team}
                  </span>
                  {game.home.score != null && (
                    <span className={`text-[13px] font-black font-mono tabular-nums leading-none ${live ? 'text-white' : 'text-gray-500'}`}>
                      {game.home.score}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </aside>
  )
}
