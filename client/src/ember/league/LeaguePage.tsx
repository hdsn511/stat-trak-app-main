import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AskBar, LiveTicker, QueryChips, StreakWatch, TrendingPlayers } from '@/ember/components'
import StandingsCard from '@/ember/nba/StandingsCard'
import { useEntityData } from '@/ember/useEntityData'
import { useSportData } from '@/ember/data/useSportData'
import { createLeagueApi, type StandingsResponse } from '@/services/api'
import { formatGameDate } from '@/ember/game/format'
import { LeagueConfig } from '@/ember/league/leagueConfigs'

interface LeaguePageProps {
  config: LeagueConfig
}

export default function LeaguePage({ config }: LeaguePageProps) {
  const navigate = useNavigate()
  const openQuery = (query: string) => navigate('/sportquery', { state: { query } })

  const slugs = useMemo(() => [config.slug], [config.slug])
  const { trending, streaks, ticker, loading, errors, tickerScope } = useSportData(slugs, {
    trendingLimit: 8,
    streakLimit: 6,
  })

  const loadStandings = useCallback(
    () => createLeagueApi(config.slug).getStandings(),
    [config.slug]
  )
  const standings = useEntityData<StandingsResponse>(loadStandings)

  const gameCount = ticker.length
  // A single league is always on one slate, so the header can name its date.
  const tickerLabel =
    tickerScope.kind === 'single'
      ? `${config.name} · ${formatGameDate(tickerScope.date)}`
      : config.tickerLabel

  return (
    <>
      <LiveTicker
        label={tickerLabel}
        games={ticker}
        emptyLabel={loading ? 'LOADING SLATE…' : 'NO GAMES SCHEDULED'}
      />

      <section className="relative overflow-hidden bg-[#EFE9E0] border-b border-[#E4E0D6] px-8 pt-[26px] pb-6">
        <span
          aria-hidden
          className="pointer-events-none select-none absolute -top-[58px] -right-[14px] font-chakra italic font-bold text-[170px] leading-none tracking-[-8px] text-[rgba(20,16,15,0.05)]"
        >
          {config.ghost}
        </span>
        <div className="relative flex flex-wrap items-center gap-6 max-w-[1280px] mx-auto">
          <div>
            <h1 className="font-chakra italic font-bold text-[30px] leading-none text-[#14100F]">
              {config.name}
              <span className="text-[#D9481F]">.</span>
            </h1>
            <p className="font-martian text-[10px] text-[#6B675C] tracking-[1px] mt-2">
              {config.metaLine}
              {gameCount > 0 && ` · ${gameCount} GAME${gameCount === 1 ? '' : 'S'} ON THE SLATE`}
            </p>
          </div>
          <div className="ml-auto w-full max-w-[640px]">
            <AskBar placeholder={config.askPlaceholder} onSubmit={openQuery} />
            <div className="mt-3 [&>div]:justify-end">
              <QueryChips variant="paper" chips={config.chips} onSelect={openQuery} />
            </div>
          </div>
        </div>
      </section>

      <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-[14px] px-8 pt-7 pb-11">
        <StandingsCard
          league={config.slug}
          standings={standings.data?.standings ?? []}
          loading={standings.loading}
        />

        {(errors.length > 0 || standings.error) && (
          <div className="font-martian text-[9px] text-[#FF6B5C] tracking-[1px]">
            {[...errors, standings.error ? `STANDINGS: ${standings.error}` : null]
              .filter(Boolean)
              .map((e) => (
                <div key={e as string}>{`// ${e}`}</div>
              ))}
          </div>
        )}

        <div className="grid gap-[14px] lg:grid-cols-[1fr_380px] items-start">
          <TrendingPlayers
            rows={trending}
            meta="L10 VS SEASON"
            emptyLabel={
              loading
                ? 'LOADING TRENDS…'
                : `NO ${config.name} TREND DATA — PIPELINE NOT YET BUILT FOR THIS LEAGUE`
            }
          />
          <StreakWatch
            rows={streaks}
            meta="LAST 10"
            emptyLabel={loading ? 'LOADING STREAKS…' : `NO ACTIVE ${config.name} STREAKS`}
            footerLink={{ label: 'ALL STREAKS →', to: '/sportquery' }}
          />
        </div>
      </div>
    </>
  )
}
