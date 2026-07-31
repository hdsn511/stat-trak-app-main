import { useCallback, useEffect, useRef, useState } from 'react'
import type { StatDef } from '@/config/playerStats'
import { defaultLine, filterGames } from './derive'
import type { GameRow, HomeAway, PlayerFilters } from './types'

interface Args {
  games: GameRow[]
  statDefs: StatDef[]
  initial?: Partial<PlayerFilters>
}

/**
 * Filter state for the player view. The line auto-tracks the filtered average
 * until the user moves it, after which their value survives filter changes —
 * except when the stat itself changes, where the old number is meaningless.
 */
export function usePlayerFilters({ games, statDefs, initial }: Args) {
  const firstStat = statDefs[0]?.key ?? ''
  const [filters, setFilters] = useState<PlayerFilters>(() => ({
    window: initial?.window ?? 0,
    vsTeam: initial?.vsTeam ?? null,
    homeAway: initial?.homeAway ?? 'all',
    stat: statDefs.some((s) => s.key === initial?.stat) ? initial!.stat! : firstStat,
    line: initial?.line ?? 0,
    // An explicit incoming line is the user's intent; do not overwrite it.
    lineTouched: initial?.line != null,
  }))

  const defFor = useCallback(
    (key: string) => statDefs.find((s) => s.key === key) ?? statDefs[0],
    [statDefs]
  )

  // Recompute the untouched line whenever the slice or stat changes.
  const sig = `${filters.window}|${filters.vsTeam}|${filters.homeAway}|${filters.stat}`
  const lastSig = useRef<string | null>(null)
  useEffect(() => {
    if (lastSig.current === sig) return
    lastSig.current = sig
    setFilters((f) => {
      if (f.lineTouched) return f
      const def = defFor(f.stat)
      if (!def) return f
      return { ...f, line: defaultLine(filterGames(games, f), def) }
    })
  }, [sig, games, defFor])

  const setWindow = useCallback((window: number) => setFilters((f) => ({ ...f, window })), [])
  const setVsTeam = useCallback((vsTeam: string | null) => setFilters((f) => ({ ...f, vsTeam })), [])
  const setHomeAway = useCallback(
    (homeAway: HomeAway) => setFilters((f) => ({ ...f, homeAway })),
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
        // A line carried over from another stat is meaningless.
        return { ...f, stat, lineTouched: false }
      }),
    [statDefs]
  )

  const resetLine = useCallback(
    () =>
      setFilters((f) => {
        const def = defFor(f.stat)
        return def
          ? { ...f, line: defaultLine(filterGames(games, f), def), lineTouched: false }
          : { ...f, lineTouched: false }
      }),
    [games, defFor]
  )

  return { filters, setWindow, setVsTeam, setHomeAway, setStat, setLine, resetLine }
}
