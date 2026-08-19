import { useEffect, useMemo, useState } from 'react'
import { LEAGUES, type LeagueSlug } from '@/config/leagues'
import { createLeagueApi } from '@/services/api'
import type { TickerGame } from '@/ember/components/LiveTicker'
import type { StreakRow } from '@/ember/components/StreakWatch'
import type { TrendingRow } from '@/ember/components/TrendingPlayers'
import {
  rankStreaks,
  rankTrending,
  toStreakRows,
  toTickerGames,
  toTrendingRows,
} from './adapters'

// One API client per league, created once rather than per render.
const apis = new Map<string, ReturnType<typeof createLeagueApi>>()
const apiFor = (slug: LeagueSlug) => {
  let a = apis.get(slug)
  if (!a) {
    a = createLeagueApi(slug)
    apis.set(slug, a)
  }
  return a
}

const leagueDef = (slug: LeagueSlug) => LEAGUES.find((l) => l.slug === slug)

export interface SportData {
  trending: TrendingRow[]
  streaks: StreakRow[]
  ticker: TickerGame[]
  loading: boolean
  /** Per-league failures. One league erroring never blanks the others. */
  errors: string[]
  /**
   * What the ticker is actually showing. Home aggregates four leagues whose
   * seasons rarely align, so the header can't just assert "tonight".
   */
  tickerScope: TickerScope
}

export type TickerScope =
  | { kind: 'empty' }
  | { kind: 'today' }
  | { kind: 'single'; date: string; past: boolean }
  | { kind: 'mixed' }

interface Options {
  trendingLimit?: number
  streakLimit?: number
}

/**
 * Aggregate the modules that Home and the league pages share. Every request is
 * independent and settled separately, so a league without a trends pipeline
 * (NHL, NFL) simply contributes nothing instead of failing the page.
 */
export function useSportData(slugs: LeagueSlug[], opts: Options = {}): SportData {
  const { trendingLimit = 6, streakLimit = 5 } = opts
  const key = slugs.join(',')

  const [trendingRaw, setTrendingRaw] = useState<Omit<TrendingRow, 'rank'>[]>([])
  const [streaksRaw, setStreaksRaw] = useState<StreakRow[]>([])
  const [ticker, setTicker] = useState<TickerGame[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const active = key.split(',').filter(Boolean) as LeagueSlug[]

    setLoading(true)
    setErrors([])

    const failures: string[] = []
    const note = (slug: string, what: string, e: unknown) => {
      failures.push(`${slug.toUpperCase()} ${what}: ${(e as Error).message}`)
    }

    const trendingJobs = active.map((slug) =>
      apiFor(slug)
        .getTopTrending()
        .then((rows) => toTrendingRows(slug, rows))
        .catch((e) => {
          note(slug, 'trends', e)
          return []
        })
    )

    // Each league streaks on its own headline stat; leagues with no streak
    // pipeline are skipped rather than called and 404'd.
    const streakJobs = active.map((slug) => {
      const stat = leagueDef(slug)?.streakStats?.[0]
      if (!stat) return Promise.resolve<StreakRow[]>([])
      return apiFor(slug)
        .getPlayerStreaks(stat.key)
        .then((res) => toStreakRows(slug, res.rows, stat.label))
        .catch((e) => {
          note(slug, 'streaks', e)
          return []
        })
    })

    const gameJobs = active.map((slug) =>
      apiFor(slug)
        .getTodaysGames()
        .then((rows) => toTickerGames(slug, rows))
        .catch((e) => {
          note(slug, 'slate', e)
          return []
        })
    )

    Promise.all([
      Promise.all(trendingJobs),
      Promise.all(streakJobs),
      Promise.all(gameJobs),
    ]).then(([trends, streaks, games]) => {
      if (cancelled) return
      setTrendingRaw(trends.flat())
      setStreaksRaw(streaks.flat())
      setTicker(games.flat())
      setErrors(failures)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [key])

  const trending = useMemo(
    () => rankTrending(trendingRaw, trendingLimit),
    [trendingRaw, trendingLimit]
  )
  const streaks = useMemo(() => rankStreaks(streaksRaw, streakLimit), [streaksRaw, streakLimit])

  const tickerScope = useMemo<TickerScope>(() => {
    if (ticker.length === 0) return { kind: 'empty' }
    const today = new Date().toISOString().slice(0, 10)
    const dates = [...new Set(ticker.map((g) => g.date).filter(Boolean))] as string[]
    if (dates.every((d) => d === today)) return { kind: 'today' }
    if (dates.length === 1) return { kind: 'single', date: dates[0]!, past: dates[0]! < today }
    // Leagues on different slates — the chips carry their own dates instead.
    return { kind: 'mixed' }
  }, [ticker])

  return { trending, streaks, ticker, loading, errors, tickerScope }
}
