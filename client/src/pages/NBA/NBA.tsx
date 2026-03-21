import Sidebar from '@/components/Sidebar/Sidebar'
import TrendFinder from '@/components/TrendFinder/TrendFinder'
import TopTrending from '@/components/Home/TopTrending'

export default function NBA() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="bg-[#090909] border border-[#141414] rounded-2xl p-5">
          <TrendFinder />
        </div>
        <div className="bg-[#090909] border border-[#141414] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#111]">
            <span className="text-[10px] font-bold text-gray-700 uppercase tracking-[0.2em] font-condensed">
              Pre-Computed Trends
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
