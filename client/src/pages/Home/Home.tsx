import Sidebar from '@/components/Sidebar/Sidebar'
import PickOfTheDay from '@/components/Home/PickOfTheDay'
import TopTrending from '@/components/Home/TopTrending'

export default function Home() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        <PickOfTheDay />
        <div className="bg-[#090909] border border-[#141414] rounded-2xl overflow-hidden">
          <div className="px-4 py-4">
            <TopTrending />
          </div>
        </div>
      </main>
    </div>
  )
}
