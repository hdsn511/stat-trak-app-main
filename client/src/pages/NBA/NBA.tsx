import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar/Sidebar'
import TrendFinder from '@/components/TrendFinder/TrendFinder'
import TopTrending from '@/components/Home/TopTrending'
import PicksRow from '@/components/NBA/PicksRow'
import PropsTable from '@/components/NBA/PropsTable'
import StreaksCard from '@/components/NBA/StreaksCard'
import { nbaApi, TopPicksResponse } from '@/services/api'

export default function NBA() {
  const [picks, setPicks] = useState<TopPicksResponse | null>(null)

  useEffect(() => {
    nbaApi.getTopPicks(10).then(setPicks).catch(() => {})
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Row 1: 4 POTD cards */}
        <PicksRow />

        {/* Row 2: Props table */}
        <PropsTable picks={picks} />

        {/* Row 3: Streaks */}
        <StreaksCard />

        {/* Row 4: TrendFinder */}
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
          <TrendFinder />
        </div>

        {/* Row 5: TopTrending */}
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">
              Today's Trending
            </span>
          </div>
          <div className="px-4 py-3">
            <TopTrending />
          </div>
        </div>
      </main>
    </div>
  )
}
