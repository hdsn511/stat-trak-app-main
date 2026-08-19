import { useCallback, useEffect, useState } from 'react'
import type { LeagueSlug } from '@/config/leagues'
import { createLeagueApi } from '@/services/api'
import type { PlayerLogResponse } from './types'

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

export function usePlayerData(slug: LeagueSlug, id: number) {
  const [data, setData] = useState<PlayerLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFor(slug)
      .getPlayerLog(id, 'all')
      .then((d) => {
        if (cancelled) return
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setData(null)
        setError(e.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, id, nonce])

  return { data, loading, error, reload }
}
