import { Outlet, Route, Routes } from 'react-router-dom'
import Header from '@/components/Header/Header'
import EmberHeader from '@/ember/components/EmberHeader'
import Home from '@/pages/Home/Home'
import NBA from '@/pages/NBA/NBA'
import NFL from '@/pages/NFL/NFL'
import MLB from '@/pages/MLB/MLB'
import NHL from '@/pages/NHL/NHL'
import Performance from '@/pages/Performance/Performance'
import PlayerDetailView from '@/components/TrendFinder/PlayerDetailView'
import MLBPlayerView from '@/components/MLBPlayer/MLBPlayerView'
import GameView from '@/components/GameView/GameView'
import TeamView from '@/components/TeamView/TeamView'
import SportQueryPage from '@/ember/sportquery/SportQueryPage'
import PlayerPage from '@/ember/player/PlayerPage'

function LegacyLayout() {
  return (
    <div className="bg-[#0A0A0A] min-h-screen">
      <Header />
      <div className="pt-16 h-screen flex flex-col">
        <Outlet />
      </div>
    </div>
  )
}

function EmberLayout() {
  return (
    <div className="min-h-screen bg-[#0D0B0A] text-[#EFEBE9] flex flex-col">
      <EmberHeader />
      <Outlet />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<EmberLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/nba" element={<NBA />} />
        <Route path="/nfl" element={<NFL />} />
        <Route path="/mlb" element={<MLB />} />
        <Route path="/nhl" element={<NHL />} />
        <Route path="/sportquery" element={<SportQueryPage />} />
        <Route path="/sportquery/:sessionId" element={<SportQueryPage />} />
        {/* Three segments, so this never collides with the legacy two-segment
            /player/:id route registered under LegacyLayout below. */}
        <Route path="/player/:league/:id" element={<PlayerPage />} />
      </Route>
      <Route element={<LegacyLayout />}>
        <Route path="/player/:id" element={<PlayerDetailView />} />
        <Route path="/mlb/player/:id" element={<MLBPlayerView />} />
        <Route path="/game/:id" element={<GameView />} />
        <Route path="/team/:id" element={<TeamView />} />
        <Route path="/performance" element={<Performance />} />
      </Route>
    </Routes>
  )
}
