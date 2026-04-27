import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar/Sidebar'
import TrendFinder from '@/components/TrendFinder/TrendFinder'
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
        <PicksRow />
        <PropsTable picks={picks} />
        <StreaksCard />
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
          <TrendFinder />
        </div>
      </main>
    </div>
  )
}
