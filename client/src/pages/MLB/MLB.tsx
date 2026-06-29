import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar/Sidebar'
import TrendFinder, { TrendStat } from '@/components/TrendFinder/TrendFinder'
import PotdCard from '@/components/NBA/PotdCard'
import PropsTable from '@/components/NBA/PropsTable'
import StreaksCard, { StatTab } from '@/components/NBA/StreaksCard'
import { mlbApi, TopPicksResponse } from '@/services/api'

// MLB-tuned streak tabs. HR omitted — a 7+/10-game HR streak ~never happens.
const MLB_STREAK_TABS: StatTab[] = [
  { key: 'hits', label: 'H' },
  { key: 'tb',   label: 'TB' },
  { key: 'rbi',  label: 'RBI' },
]

const MLB_TREND_STATS: TrendStat[] = [
  { id: 'hits',        label: 'H' },
  { id: 'total_bases', label: 'TB' },
  { id: 'rbi',         label: 'RBI' },
  { id: 'runs',        label: 'R' },
  { id: 'home_runs',   label: 'HR' },
]

export default function MLB() {
  const [picks, setPicks] = useState<TopPicksResponse | null>(null)

  useEffect(() => {
    mlbApi.getTopPicks(20).then(setPicks).catch(() => {})
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar api={mlbApi} />
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        <PotdCard api={mlbApi} />
        <PropsTable picks={picks} slug={mlbApi.slug} />
        <StreaksCard api={mlbApi} statTabs={MLB_STREAK_TABS} />
        <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl p-5">
          <TrendFinder api={mlbApi} stats={MLB_TREND_STATS} />
        </div>
      </main>
    </div>
  )
}
