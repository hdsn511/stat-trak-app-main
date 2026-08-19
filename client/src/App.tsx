import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import Header from '@/components/Header/Header'
import EmberHeader from '@/ember/components/EmberHeader'
import Home from '@/pages/Home/Home'
import NBA from '@/pages/NBA/NBA'
import NFL from '@/pages/NFL/NFL'
import MLB from '@/pages/MLB/MLB'
import NHL from '@/pages/NHL/NHL'
import Performance from '@/pages/Performance/Performance'
import SportQueryPage from '@/ember/sportquery/SportQueryPage'
import PlayerPage from '@/ember/player/PlayerPage'
import GamePage from '@/ember/game/GamePage'
import TeamPage from '@/ember/team/TeamPage'

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

/**
 * Redirect an unqualified legacy entity URL to its league-qualified form.
 * Old links (/player/203999, /game/13870) predate multi-sport support and all
 * meant NBA, except /mlb/player/:id which meant MLB.
 */
function LegacyEntityRedirect({ to, league }: { to: 'player' | 'game' | 'team'; league: string }) {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/${to}/${league}/${id}`} replace />
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

        {/* Canonical entity routes — every league, same shape. */}
        <Route path="/player/:league/:id" element={<PlayerPage />} />
        <Route path="/game/:league/:id" element={<GamePage />} />
        <Route path="/team/:league/:id" element={<TeamPage />} />
      </Route>

      {/* Legacy two-segment URLs. Registered after the three-segment routes
          above, which they can never shadow. */}
      <Route path="/player/:id" element={<LegacyEntityRedirect to="player" league="nba" />} />
      <Route path="/mlb/player/:id" element={<LegacyEntityRedirect to="player" league="mlb" />} />
      <Route path="/game/:id" element={<LegacyEntityRedirect to="game" league="nba" />} />
      <Route path="/team/:id" element={<LegacyEntityRedirect to="team" league="nba" />} />

      <Route element={<LegacyLayout />}>
        <Route path="/performance" element={<Performance />} />
      </Route>
    </Routes>
  )
}
