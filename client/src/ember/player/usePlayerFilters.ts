import { useCallback, useEffect, useRef, useState } from 'react'
import type { StatDef } from '@/config/playerStats'
import { defaultLine, filterGames } from './derive'
import type { GameRow, HomeAway, PlayerFilters } from './types'

interface Args {
  games: GameRow[]
  statDefs: StatDef[]
  initial?: Partial<PlayerFilters>
  /** Usage metric (minutes, targets…) behind a stat; omit for no usage filter. */
  usageOf?: (stat: string) => StatDef | null
}

/**
 * Filter state for the player view. The line auto-tracks the filtered average
 * until the user moves it, after which their value survives filter changes —
 * except when the stat itself changes, where the old number is meaningless.
 */
export function usePlayerFilters({ games, statDefs, initial, usageOf }: Args) {
  const firstStat = statDefs[0]?.key ?? ''
  const [filters, setFilters] = useState<PlayerFilters>(() => ({
    window: initial?.window ?? 0,
    vsTeam: initial?.vsTeam ?? null,
    homeAway: initial?.homeAway ?? 'all',
    stat: statDefs.some((s) => s.key === initial?.stat) ? initial!.stat! : firstStat,
    line: initial?.line ?? 0,
    // An explicit incoming line is the user's intent; do not overwrite it.
    lineTouched: initial?.line != null,
    usageMin: initial?.usageMin ?? null,
  }))

  const defFor = useCallback(
    (key: string) => statDefs.find((s) => s.key === key) ?? statDefs[0],
    [statDefs]
  )
  // Kept in a ref so an inline `usageOf` from the caller doesn't re-fire effects.
  const usageRef = useRef(usageOf)
  usageRef.current = usageOf
  const slice = useCallback(
    (f: PlayerFilters) => filterGames(games, f, usageRef.current?.(f.stat) ?? null),
    [games]
  )

  // Recompute the untouched line whenever the slice or stat changes.
  const sig = `${filters.window}|${filters.vsTeam}|${filters.homeAway}|${filters.stat}|${filters.usageMin}`
  const lastSig = useRef<string | null>(null)
  // `sig` alone misses a player swap that lands on the same filter values
  // (e.g. two players both viewed on the default window/stat) — SportQuery's
  // DetailPane reuses this hook across selections without remounting it, so
  // the games array reference is the only signal a different player loaded.
  const lastGames = useRef<GameRow[] | null>(null)
  useEffect(() => {
    if (lastSig.current === sig && lastGames.current === games) return
    lastSig.current = sig
    lastGames.current = games
    setFilters((f) => {
      if (f.lineTouched) return f
      const def = defFor(f.stat)
      if (!def) return f
      return { ...f, line: defaultLine(slice(f), def) }
    })
  }, [sig, games, defFor, slice])

  const setWindow = useCallback((window: number) => setFilters((f) => ({ ...f, window })), [])
  const setVsTeam = useCallback((vsTeam: string | null) => setFilters((f) => ({ ...f, vsTeam })), [])
  const setHomeAway = useCallback(
    (homeAway: HomeAway) => setFilters((f) => ({ ...f, homeAway })),
    []
  )
  const setUsageMin = useCallback(
    (usageMin: number | null) =>
      setFilters((f) => ({ ...f, usageMin: usageMin == null ? null : Math.max(0, usageMin) })),
    []
  )
  const setLine = useCallback(
    (line: number) => setFilters((f) => ({ ...f, line, lineTouched: true })),
    []
  )

  const setStat = useCallback(
    (stat: string) =>
      setFilters((f) => {
        if (!statDefs.some((s) => s.key === stat)) return f
        // A line carried over from another stat is meaningless — and so is a
        // usage floor when the metric changes (6 targets ≠ 6 carries).
        const before = usageRef.current?.(f.stat)?.key ?? null
        const after = usageRef.current?.(stat)?.key ?? null
        const usageMin = before === after ? f.usageMin : null
        return { ...f, stat, lineTouched: false, usageMin }
      }),
    [statDefs]
  )

  const resetLine = useCallback(
    () =>
      setFilters((f) => {
        const def = defFor(f.stat)
        return def
          ? { ...f, line: defaultLine(slice(f), def), lineTouched: false }
          : { ...f, lineTouched: false }
      }),
    [slice, defFor]
  )

  return {
    filters,
    setWindow,
    setVsTeam,
    setHomeAway,
    setStat,
    setLine,
    resetLine,
    setUsageMin,
  }
}
