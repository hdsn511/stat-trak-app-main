import { useCallback, useEffect, useState } from 'react'

export interface EntityData<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Load one entity for a full-page view, with cancel-on-unmount and a retry
 * hook. `load` must be referentially stable — wrap it in useCallback keyed on
 * whatever identifies the entity, and this refetches when that identity
 * changes.
 */
export function useEntityData<T>(load: () => Promise<T>): EntityData<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
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
  }, [load, nonce])

  return { data, loading, error, reload }
}
