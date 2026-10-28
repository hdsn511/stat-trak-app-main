import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LiveTicker from '@/ember/components/LiveTicker'
import AskBar from '@/ember/components/AskBar'
import QueryChips from '@/ember/components/QueryChips'
import TrendingPlayers from '@/ember/components/TrendingPlayers'
import StreakWatch from '@/ember/components/StreakWatch'
import LeagueSignals from '@/ember/home/LeagueSignals'
import { useSportData } from '@/ember/data/useSportData'
import { buildLeagueSignals, inSeasonLeagues } from '@/ember/home/signals'
import { formatGameDate } from '@/ember/game/format'
import type { LeagueSlug } from '@/config/leagues'
import { HERO_CHIPS } from '@/ember/sportquery/suggestions'

const ALL_LEAGUES: LeagueSlug[] = ['nba', 'mlb', 'nfl', 'nhl']
const TREND_ROWS = 10


export default function Home() {
  const navigate = useNavigate()
  // Wide limits: the signal lanes and the filtered list slice per league, so
  // the global ranking must not have already cut a league out.
  const { trending, streaks, ticker, loading, errors, tickerScope } = useSportData(ALL_LEAGUES, {
    trendingLimit: 60,
    streakLimit: 60,
  })
  const [leagueFilter, setLeagueFilter] = useState<LeagueSlug | 'all'>('all')

  const today = new Date().toISOString().slice(0, 10)
  const inSeason = useMemo(
    () => inSeasonLeagues(ticker, today, ALL_LEAGUES),
    [ticker, today]
  )
  const lanes = useMemo(
    () => inSeason.map((l) => buildLeagueSignals(l, trending, streaks, ticker, today)),
    [inSeason, trending, streaks, ticker, today]
  )
  const offSeason = loading ? [] : ALL_LEAGUES.filter((l) => !inSeason.includes(l)).map((l) => l.toUpperCase())

  // Trending and streaks follow the same scope: in-season leagues only, and
  // optionally narrowed to one.
  const scoped = <T extends { league: string }>(rows: T[]) =>
    rows.filter(
      (r) =>
        inSeason.includes(r.league as LeagueSlug) &&
        (leagueFilter === 'all' || r.league === leagueFilter)
    )
  // On ALL, one league's z-scores must not crowd out the rest (NHL runs hot in
  // October): cap each league's share, then rank what's left by strength.
  const perLeagueCap =
    leagueFilter === 'all' ? Math.max(2, Math.ceil(TREND_ROWS / Math.max(inSeason.length, 1))) : TREND_ROWS
  const seen = new Map<string, number>()
  const trendingRows = scoped(trending)
    .filter((r) => {
      const n = (seen.get(r.league) ?? 0) + 1
      seen.set(r.league, n)
      return n <= perLeagueCap
    })
    .sort((a, b) => b.zScore - a.zScore)
    .slice(0, TREND_ROWS)
    .map((r, i) => ({ ...r, rank: i + 1 }))
  const streakAll = scoped(streaks).slice(0, TREND_ROWS)
  // Side by side the two lists read as a pair, so they show the same number of
  // rows. When one side is empty the other keeps its full length.
  const pairLen =
    trendingRows.length > 0 && streakAll.length > 0
      ? Math.min(trendingRows.length, streakAll.length)
      : TREND_ROWS
  const trendingShown = trendingRows.slice(0, pairLen)
  const streakRows = streakAll.slice(0, pairLen)
  // The ticker would otherwise keep showing an off-season league's last slate.
  const liveTicker = ticker.filter((g) => !g.slug || inSeason.includes(g.slug as LeagueSlug))

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
        games={liveTicker.length > 0 || loading ? liveTicker : ticker}
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
        <LeagueSignals lanes={lanes} offSeason={offSeason} loading={loading} />

        {errors.length > 0 && (
          <div className="font-martian text-[11px] text-[#FF6B5C] tracking-[1px]">
            {errors.map((e) => (
              <div key={e}>{`// ${e}`}</div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-martian text-[10px] text-[#A8A09C] tracking-[1.5px] mr-1">SHOW</span>
          {(['all', ...inSeason] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLeagueFilter(l)}
              aria-pressed={leagueFilter === l}
              className={`font-martian font-bold text-[11px] tracking-[1px] rounded px-[10px] py-[5px] border cursor-pointer ${
                leagueFilter === l
                  ? 'text-[#14100F] bg-[#FF6B3D] border-[#FF6B3D]'
                  : 'text-[#C9C2BE] border-[#2C2624] hover:border-[#665F5D]'
              }`}
            >
              {l === 'all' ? 'ALL' : l.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="grid gap-[14px] lg:grid-cols-[1fr_380px] items-start">
          <TrendingPlayers
            rows={trendingShown}
            meta={`${leagueFilter === 'all' ? 'IN-SEASON SPORTS' : leagueFilter.toUpperCase()} · L10 VS SEASON`}
            showLeague
            emptyLabel={loading ? 'LOADING TRENDS…' : 'NO TRENDS AVAILABLE RIGHT NOW'}
          />
          <StreakWatch
            rows={streakRows}
            meta={`${leagueFilter === 'all' ? 'IN-SEASON SPORTS' : leagueFilter.toUpperCase()} · LAST 10`}
            showLeague
            emptyLabel={loading ? 'LOADING STREAKS…' : 'NO ACTIVE STREAKS RIGHT NOW'}
            footerLink={{ label: 'ALL STREAKS →', to: '/sportquery' }}
          />
        </div>
      </main>
    </>
  )
}
