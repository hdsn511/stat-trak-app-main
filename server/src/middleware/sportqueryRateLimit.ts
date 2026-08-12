import type { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from '../config/redis'

/**
 * Shared by every limiter and declared at module scope on purpose — Upstash
 * reads it before touching the network, so an already-blocked caller costs zero
 * Redis commands for as long as the container stays warm. That is what keeps
 * the free tier's 500K commands/month budget intact under a burst.
 */
const ephemeralCache = new Map<string, number>()

type Window = `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`

/**
 * A sliding-window limiter backed by Upstash, falling back to an in-process
 * store when Redis is unconfigured.
 *
 * express-rate-limit's default store is per-process, which on Lambda means each
 * concurrent container enforces its own private limit — so the effective limit
 * is the configured one multiplied by the container count, i.e. nearly none.
 * That matters here because these limiters guard the endpoint that spends money
 * per call on Groq/OpenAI. Upstash keeps the counter in one place that every
 * container shares.
 *
 * The in-memory limiter is also kept as a backstop for when Redis is reachable
 * in principle but erroring: degrading to per-container limits beats either
 * dropping limits entirely or failing every request while Upstash is down.
 */
function makeLimiter(limit: number, window: Window, prefix: string, message: string) {
  const memoryLimiter = rateLimit({
    windowMs: windowMs(window),
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: message },
  })

  if (!redis) return memoryLimiter

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `stattrak:${prefix}`,
    // Costs extra Redis commands per request and we read usage in the Upstash
    // console instead.
    analytics: false,
    ephemeralCache,
  })

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.ip ?? 'unknown'
    try {
      const { success, reset } = await ratelimit.limit(identifier)
      if (!success) {
        res.setHeader('Retry-After', String(Math.max(0, Math.ceil((reset - Date.now()) / 1000))))
        res.status(429).json({ success: false, error: message })
        return
      }
      next()
    } catch (err) {
      console.error(`RateLimit: Upstash unavailable for ${prefix}, using in-memory store`, err)
      memoryLimiter(req, res, next)
    }
  }
}

function windowMs(window: Window): number {
  const [value, unit] = window.split(' ') as [string, string]
  const scale: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return Number(value) * scale[unit]!
}

export const sportqueryMinuteLimiter = makeLimiter(30, '1 m', 'sportquery-min', 'rate_limit: slow down')
export const sportqueryDailyLimiter = makeLimiter(
  500,
  '1 d',
  'sportquery-day',
  'rate_limit: daily cap reached'
)
