import Sidebar from '@/components/Sidebar/Sidebar'
import PickOfTheDay from '@/components/Home/PickOfTheDay'
import TopTrending from '@/components/Home/TopTrending'

export default function Home() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <PickOfTheDay />
        <div className="bg-surface border border-[#1E1E1E] rounded-xl overflow-hidden">
          <TopTrending />
        </div>
      </main>
    </div>
  )
}
