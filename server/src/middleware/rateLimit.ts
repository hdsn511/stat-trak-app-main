import type { Request, Response, NextFunction } from 'express'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

const redis = url && token ? new Redis({ url, token }) : null
if (!redis) {
  console.warn(
    'RateLimit: UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set. Rate limiting disabled (local dev only).'
  )
}

type Window = `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`

// Upstash-backed sliding-window limiter, keyed by client IP. Unlike
// express-rate-limit's in-memory store, this state is shared across all
// concurrent Lambda instances, so limits are actually enforced under
// concurrency instead of being silently reset per cold container.
function makeLimiter(limit: number, window: Window, prefix: string, message: string) {
  const ratelimit = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, window),
        prefix: `stattrak:${prefix}`,
        analytics: false,
      })
    : null

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!ratelimit) {
      next()
      return
    }
    const key = req.ip ?? 'unknown'
    const { success, reset } = await ratelimit.limit(key)
    if (!success) {
      res.setHeader('Retry-After', String(Math.max(0, Math.ceil((reset - Date.now()) / 1000))))
      res.status(429).json({ success: false, error: message })
      return
    }
    next()
  }
}

// Coarse guard applied to all of /api in app.ts.
export const apiRateLimiter = makeLimiter(100, '1 m', 'api', 'rate_limit: slow down')

// SportQuery-specific limits, applied on top of apiRateLimiter for /api/sportquery/message.
export const sportqueryMinuteLimiter = makeLimiter(30, '1 m', 'sportquery-min', 'rate_limit: slow down')
export const sportqueryDailyLimiter = makeLimiter(500, '1 d', 'sportquery-day', 'rate_limit: daily cap reached')
