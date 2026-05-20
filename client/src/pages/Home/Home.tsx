import Sidebar from '@/components/Sidebar/Sidebar'
import PickOfTheDay from '@/components/Home/PickOfTheDay'
import StreaksCard from '@/components/NBA/StreaksCard'

export default function Home() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-5 space-y-4">
        <PickOfTheDay />
        <StreaksCard />
      </main>
    </div>
  )
}
