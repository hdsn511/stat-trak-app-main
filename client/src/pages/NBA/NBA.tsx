import Sidebar from '@/components/Sidebar/Sidebar'
import TrendFinder from '@/components/TrendFinder/TrendFinder'
import TopTrending from '@/components/Home/TopTrending'

export default function NBA() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-4 space-y-8">
        <div className="bg-surface border border-[#1E1E1E] rounded-xl p-5">
          <TrendFinder />
        </div>
        <div className="bg-surface border border-[#1E1E1E] rounded-xl overflow-hidden">
          <div className="p-5 border-b border-[#1E1E1E]">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Pre-Computed Trends</h2>
          </div>
          <div className="p-5 text-sm font-semibold text-gray-400 uppercase tracking-wider">
            <TopTrending />
          </div>
        </div>
      </main>
    </div>
  )
}
