import type { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { Ratelimit } from '@upstash/ratelimit'
import { redis } from '../config/redis'

type Window = `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`

/**
 * The client's real IP. `req.ip` is useless here without `app.set('trust
 * proxy', ...)`, which this app deliberately doesn't set — the Lambda sits
 * behind Lambda Web Adapter, so trusting an arbitrary hop count of
 * X-Forwarded-For is fragile. Cloudflare's edge sets CF-Connecting-IP on
 * every request and overwrites any client-supplied value, so it's a safe,
 * unspoofable source of the caller's IP for the one path (the Pages Function
 * proxy) that's allowed to reach this Lambda at all.
 */
function clientIdentifier(req: Request): string {
  const cfIp = req.headers['cf-connecting-ip']
  if (typeof cfIp === 'string' && cfIp) return cfIp
  return req.ip ?? 'unknown'
}

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

  // One Map per limiter, not shared across the minute/daily instances: Upstash
  // reads this before touching the network, so an already-blocked caller costs
  // zero Redis commands for as long as the container stays warm — but a Map
  // shared between limiters mixes up which limiter actually blocked a given
  // identifier, since the cache key doesn't carry the prefix.
  const ephemeralCache = new Map<string, number>()

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
    const identifier = clientIdentifier(req)
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
  100,
  '1 d',
  'sportquery-day',
  'You have used today\'s 100 questions. Create an account to continue — accounts aren\'t ready yet, so SportQuery is paused until tomorrow.'
)

// Session create/list/read/delete cost a single cheap row operation each —
// not an LLM call — so this is far more generous than the message limiter.
// It exists only to stop someone from scripting mass session creation or
// mass deletion, not to throttle normal use.
export const sportquerySessionLimiter = makeLimiter(
  60,
  '1 m',
  'sportquery-session',
  'rate_limit: slow down'
)

// Every other /api read. Pages fan out ~10 requests on load and most are served
// from the edge cache before reaching the Lambda at all, so a human never gets
// near this; it caps a scraper looping over player/game ids, each of which is a
// Lambda invocation and a Supabase query.
export const apiReadLimiter = makeLimiter(300, '1 m', 'api-read', 'rate_limit: slow down')
