import { Route, Routes } from 'react-router-dom'
import Header from '@/components/Header/Header'
import Home from '@/pages/Home/Home'
import NBA from '@/pages/NBA/NBA'
import NFL from '@/pages/NFL/NFL'
import MLB from '@/pages/MLB/MLB'
import NHL from '@/pages/NHL/NHL'
import PlayerDetailView from '@/components/TrendFinder/PlayerDetailView'
import GameView from '@/components/GameView/GameView'
import TeamView from '@/components/TeamView/TeamView'
import SportQuery from '@/components/SportQuery/SportQuery'

export default function App() {
  return (
    <div className="bg-[#0A0A0A] min-h-screen">
      <Header />
      <div className="pt-16 h-screen flex flex-col">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/nba" element={<NBA />} />
          <Route path="/nfl" element={<NFL />} />
          <Route path="/mlb" element={<MLB />} />
          <Route path="/nhl" element={<NHL />} />
          <Route path="/player/:id" element={<PlayerDetailView />} />
          <Route path="/game/:id" element={<GameView />} />
          <Route path="/team/:id" element={<TeamView />} />
          <Route path="/sportquery" element={<SportQuery />} />
          <Route path="/sportquery/:sessionId" element={<SportQuery />} />
        </Routes>
      </div>
    </div>
  )
}
