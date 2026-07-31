import { useNavigate } from 'react-router-dom'
import { AskBar, LiveTicker, QueryChips, StreakWatch, TrendingPlayers } from '@/ember/components'
import StandingsCard from '@/ember/nba/StandingsCard'
import {
  eastStandings,
  nbaStreaks,
  nbaTicker,
  nbaTrending,
  westStandings,
} from '@/ember/data/nbaFixtures'

const NBA_CHIPS = [
  'best rebounders vs OKC this season',
  'who scores most in clutch minutes?',
  'fastest pace matchup tonight',
]

export default function NBA() {
  const navigate = useNavigate()
  const openQuery = (query: string) => navigate('/sportquery', { state: { query } })

  return (
    <>
      <LiveTicker
        label="NBA · TONIGHT"
        games={nbaTicker}
        onGameClick={() => openQuery("Tonight's closest games")}
      />

      <section className="relative overflow-hidden bg-[#EFE9E0] border-b border-[#E4E0D6] px-8 pt-[26px] pb-6">
        <span
          aria-hidden
          className="pointer-events-none select-none absolute -top-[58px] -right-[14px] font-chakra italic font-bold text-[170px] leading-none tracking-[-8px] text-[rgba(20,16,15,0.05)]"
        >
          NBA
        </span>
        <div className="relative flex flex-wrap items-center gap-6 max-w-[1280px] mx-auto">
          <div>
            <h1 className="font-chakra italic font-bold text-[30px] leading-none text-[#14100F]">
              NBA<span className="text-[#D9481F]">.</span>
            </h1>
            <p className="font-martian text-[10px] text-[#6B675C] tracking-[1px] mt-2">
              82-GAME SEASON · APR 12 · 6 GAMES TONIGHT
            </p>
          </div>
          <div className="ml-auto w-full max-w-[640px]">
            <AskBar
              placeholder="ask about the NBA — players, teams, matchups…"
              onSubmit={openQuery}
            />
            <div className="mt-3 [&>div]:justify-end">
              <QueryChips variant="paper" chips={NBA_CHIPS} onSelect={openQuery} />
            </div>
          </div>
        </div>
      </section>

      <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-[14px] px-8 pt-7 pb-11">
        <StandingsCard east={eastStandings} west={westStandings} />
        <div className="grid gap-[14px] lg:grid-cols-[1fr_380px]">
          <TrendingPlayers rows={nbaTrending} meta="L10 VS SEASON" />
          <StreakWatch
            rows={nbaStreaks}
            meta="LAST 10"
            footerLink={{ label: 'ALL STREAKS →', to: '/sportquery' }}
          />
        </div>
      </div>
    </>
  )
}
