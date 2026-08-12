import { useNavigate } from 'react-router-dom'
import LiveTicker from '@/ember/components/LiveTicker'
import AskBar from '@/ember/components/AskBar'
import QueryChips from '@/ember/components/QueryChips'
import TrendingPlayers from '@/ember/components/TrendingPlayers'
import StreakWatch from '@/ember/components/StreakWatch'
import StatSignals from '@/ember/home/StatSignals'
import { useSportData } from '@/ember/data/useSportData'
import { buildStatSignals } from '@/ember/home/signals'
import { formatGameDate } from '@/ember/game/format'
import type { LeagueSlug } from '@/config/leagues'

const ALL_LEAGUES: LeagueSlug[] = ['nba', 'mlb', 'nfl', 'nhl']

const HERO_CHIPS = [
  "Who's hot from three over the last 10 games?",
  'Best rebounders against top-10 defenses',
  'Most consistent scorers this month',
  'Which favorites are covering?',
]

export default function Home() {
  const navigate = useNavigate()
  const { trending, streaks, ticker, loading, errors, tickerScope } = useSportData(ALL_LEAGUES, {
    trendingLimit: 6,
    streakLimit: 5,
  })

  const openQuery = (query: string) => {
    navigate('/sportquery', { state: { query } })
  }

  const tickerLabel = (() => {
    switch (tickerScope.kind) {
      case 'today':
        return 'LIVE+TONIGHT'
      case 'single':
        return `${tickerScope.past ? 'LATEST' : 'NEXT'} SLATE · ${formatGameDate(tickerScope.date)}`
      case 'mixed':
        // Four leagues, four different slates — each chip is dated instead.
        return 'LATEST SLATES'
      default:
        return 'LIVE+TONIGHT'
    }
  })()

  return (
    <>
      <LiveTicker
        label={tickerLabel}
        games={ticker}
        emptyLabel={loading ? 'LOADING SLATE…' : 'NO GAMES SCHEDULED'}
      />

      <section
        className="relative overflow-hidden border-b border-[#E4E0D6] px-8 pt-10 pb-9"
        style={{ background: 'linear-gradient(180deg, #F7F5F0 0%, #FFFFFF 100%)' }}
      >
        <span
          aria-hidden
          className="absolute top-[-38px] right-[-60px] font-chakra italic font-bold text-[150px] leading-none tracking-[-6px] pointer-events-none select-none"
          style={{ color: 'rgba(20,16,15,0.05)' }}
        >
          STATS
        </span>
        <div className="relative max-w-[760px] mx-auto text-center">
          <h1 className="font-chakra italic font-bold text-[clamp(26px,3.2vw,34px)] tracking-[-0.5px] text-[#14100F]">
            EVERY SPORT. IN NUMBERS<span className="text-ember-paper">.</span>
          </h1>
          <AskBar
            className="mt-[22px]"
            placeholder="how does Jokić rebound against top-10 defenses?"
            onSubmit={openQuery}
          />
          <div className="mt-[14px] flex justify-center [&>div]:justify-center">
            <QueryChips variant="paper" chips={HERO_CHIPS} onSelect={openQuery} />
          </div>
        </div>
      </section>

      <main className="flex-1 w-full max-w-[1280px] mx-auto flex flex-col gap-[26px] px-8 pt-7 pb-11">
        <StatSignals signals={buildStatSignals(trending, streaks, ticker)} />

        {errors.length > 0 && (
          <div className="font-martian text-[9px] text-[#FF6B5C] tracking-[1px]">
            {errors.map((e) => (
              <div key={e}>{`// ${e}`}</div>
            ))}
          </div>
        )}

        <div className="grid gap-[14px] lg:grid-cols-[1fr_380px] items-start">
          <TrendingPlayers
            rows={trending}
            meta="ALL SPORTS · L10 VS SEASON"
            showLeague
            emptyLabel={loading ? 'LOADING TRENDS…' : 'NO TRENDS AVAILABLE RIGHT NOW'}
          />
          <StreakWatch
            rows={streaks}
            meta="ALL SPORTS · LAST 10"
            showLeague
            emptyLabel={loading ? 'LOADING STREAKS…' : 'NO ACTIVE STREAKS RIGHT NOW'}
            footerLink={{ label: 'ALL STREAKS →', to: '/sportquery' }}
          />
        </div>
      </main>
    </>
  )
}
