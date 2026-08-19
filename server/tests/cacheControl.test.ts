import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { cacheControl } from '../src/middleware/cacheControl';

// These headers drive Cloudflare's edge cache, which sits in front of both
// Lambda and Upstash. A wrong policy here either defeats the cache entirely or
// — for /sportquery — lets a shared cache serve one visitor's session to
// another, since the API has no per-user auth.

/**
 * `statusCode` defaults to 200 and `json()` is called after the middleware
 * runs, mirroring how a real handler works: the header can only reflect the
 * response's outcome once the handler has actually decided one.
 */
function run(method: string, path: string, statusCode = 200) {
  const headers: Record<string, string> = {};
  const req = { method, path } as Request;
  const res = {
    statusCode,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    json: () => res,
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;

  cacheControl()(req, res, next);
  if (method === 'GET' && !path.startsWith('/sportquery')) res.json({});
  return { cacheControlHeader: headers['Cache-Control'], next };
}

describe('cacheControl', () => {
  it('always calls next', () => {
    const { next } = run('GET', '/nba/trends/top');
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ['/nba/trends/top'],
    ['/nba/picks/today'],
    ['/nba/performance/summary'],
    ['/nfl/standings'],
    ['/nba/teams/12/defense'],
  ])('caches %s for the nightly window', (path) => {
    expect(run('GET', path).cacheControlHeader).toBe(
      'public, max-age=900, stale-while-revalidate=3600'
    );
  });

  it.each([['/nba/games/today'], ['/nhl/live']])('caches %s briefly', (path) => {
    expect(run('GET', path).cacheControlHeader).toBe(
      'public, max-age=30, stale-while-revalidate=120'
    );
  });

  it('falls back to the default policy', () => {
    expect(run('GET', '/nba/players/1/games').cacheControlHeader).toBe(
      'public, max-age=60, stale-while-revalidate=300'
    );
  });

  it('prefers the live policy when a path matches both', () => {
    // /games/today would also match no nightly pattern, but a future path like
    // /picks/games/today must not inherit the 15-minute TTL.
    expect(run('GET', '/nba/picks/games/today').cacheControlHeader).toBe(
      'public, max-age=30, stale-while-revalidate=120'
    );
  });

  it.each([['POST'], ['DELETE'], ['PUT']])('never caches %s', (method) => {
    expect(run(method, '/nba/trends/top').cacheControlHeader).toBe('no-store');
  });

  it.each([
    ['/sportquery/sessions'],
    ['/sportquery/session/abc/messages'],
  ])('never caches per-session path %s', (path) => {
    expect(run('GET', path).cacheControlHeader).toBe('no-store');
  });

  it.each([[500], [503], [404]])(
    'never caches a %d response as public, even on a normally-cacheable path',
    (statusCode) => {
      expect(run('GET', '/nba/trends/top', statusCode).cacheControlHeader).toBe('no-store');
    }
  );
});
