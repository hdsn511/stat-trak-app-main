import { Redis } from '@upstash/redis'

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

/**
 * Upstash speaks HTTP rather than the Redis wire protocol, which is why it can
 * be reached from a Lambda that lives outside any VPC — no NAT gateway, no
 * security groups, no ENI cold-start penalty.
 *
 * Null when unconfigured: every helper below degrades to a miss, so local dev
 * and the test suite run with no Redis at all.
 */
export const redis = url && token ? new Redis({ url, token }) : null

export const redisConfigured = redis !== null

if (!redisConfigured) {
  console.warn('Redis: UPSTASH_REDIS_REST_URL/TOKEN not set — caching disabled.')
}

/**
 * Cached value for `key`, or null on a miss or any Redis failure.
 *
 * A cache is not a source of truth, so an unreachable Redis must degrade to a
 * miss and let the caller recompute rather than failing the request.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  if (!redis) return null
  try {
    return (await redis.get<T>(key)) ?? null
  } catch (err) {
    console.warn(`Redis: GET ${key} failed`, err)
    return null
  }
}

/**
 * Cache `value` under `key`.
 *
 * The TTL is required, not optional: the free tier's 256 MB holds only if
 * nothing accumulates forever, so there is no way to write an unbounded key.
 */
export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return
  try {
    await redis.set(key, value, { ex: ttlSeconds })
  } catch (err) {
    console.warn(`Redis: SET ${key} failed`, err)
  }
}

/** Read-through cache: return the cached value, else compute, store, and return it. */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await getCached<T>(key)
  if (hit !== null) return hit
  const value = await compute()
  await setCached(key, value, ttlSeconds)
  return value
}
