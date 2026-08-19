import type { Request, Response, NextFunction } from 'express'

/**
 * Cache-Control policies, in seconds, as [max-age, stale-while-revalidate].
 *
 * The edge cache in front of this API is the cheapest layer in the stack: a GET
 * served by Cloudflare costs neither a Lambda invocation nor an Upstash command.
 * These TTLs are what let it do that work.
 */
const NIGHTLY: [number, number] = [900, 3600]
const LIVE: [number, number] = [30, 120]
const DEFAULT: [number, number] = [60, 300]

/** Matched against the path relative to the /api mount, e.g. `/nba/trends/top`. */
const NIGHTLY_PATTERNS = [/\/trends/, /\/picks/, /\/performance/, /\/standings/, /\/defense/]
const LIVE_PATTERNS = [/\/games\/today/, /\/live/]

function policyFor(path: string): [number, number] {
  if (LIVE_PATTERNS.some((p) => p.test(path))) return LIVE
  if (NIGHTLY_PATTERNS.some((p) => p.test(path))) return NIGHTLY
  return DEFAULT
}

/**
 * Sets Cache-Control on cacheable API reads.
 *
 * Two categories are deliberately never cached:
 *
 * - Anything that is not a GET, which is nothing to cache in the first place.
 * - Everything under /sportquery. Those responses are per-session conversation
 *   state, and the API has no per-user auth, so marking them `public` would let
 *   a shared edge cache serve one visitor's chat history to another.
 */
export function cacheControl() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/sportquery')) {
      res.setHeader('Cache-Control', 'no-store')
      next()
      return
    }

    // Deferred until res.json() actually fires, not set up front: the route
    // handler hasn't run yet here, so res.statusCode is still the express
    // default (200) even for a request that's about to fail. Caching a 5xx as
    // `public` would let Cloudflare serve a transient error to every visitor
    // for the rest of the TTL.
    const [maxAge, swr] = policyFor(req.path)
    const originalJson = res.json.bind(res)
    res.json = (body?: unknown) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300
      res.setHeader(
        'Cache-Control',
        ok ? `public, max-age=${maxAge}, stale-while-revalidate=${swr}` : 'no-store'
      )
      return originalJson(body)
    }
    next()
  }
}

export const __testing = { policyFor, NIGHTLY, LIVE, DEFAULT }
