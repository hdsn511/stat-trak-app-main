/**
 * Proxies /api/* from the Pages origin to the Lambda Function URL.
 *
 * The SPA calls same-origin /api/..., which buys three things over pointing the
 * browser at the Function URL directly:
 *
 *  - No CORS surface at all, since nothing is cross-origin.
 *  - The Function URL is never exposed to the browser, and the shared secret
 *    injected here is what keeps arbitrary callers off endpoints that bill per
 *    request. A Function URL serving a public API must use AuthType NONE, so
 *    this header is the access control.
 *  - Cloudflare's edge cache can serve GETs, which costs neither a Lambda
 *    invocation nor an Upstash command.
 */

interface Env {
  /** Lambda Function URL, e.g. https://abc123.lambda-url.us-east-1.on.aws */
  API_ORIGIN: string
  /** Must match API_SHARED_SECRET on the Lambda. */
  API_SHARED_SECRET: string
}

const PROXY_SECRET_HEADER = 'x-stattrak-proxy-secret'

/** Response header recording whether this edge served the request from cache. */
const EDGE_CACHE_HEADER = 'x-edge-cache'

/**
 * Only responses the API marked `public` are stored. It sets that on 2xx
 * reads alone (see server/src/middleware/cacheControl.ts); errors and every
 * SportQuery response are `no-store`, so per-visitor chat state never lands in
 * a shared cache.
 */
function isCacheable(response: Response): boolean {
  return response.ok && /\bpublic\b/.test(response.headers.get('Cache-Control') ?? '')
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (!env.API_ORIGIN || !env.API_SHARED_SECRET) {
    return Response.json(
      { success: false, error: 'proxy misconfigured' },
      { status: 503 }
    )
  }

  const incoming = new URL(request.url)

  // A fetch() subrequest to a non-Cloudflare origin (the Lambda Function URL)
  // is never cached by Cloudflare on its own, whatever Cache-Control says — so
  // without this every page view was a Lambda invocation. The Cache API is
  // per-datacenter, which is fine: each edge warms itself on first miss.
  const cache = request.method === 'GET' ? caches.default : null
  const cacheKey = new Request(incoming.toString(), { method: 'GET' })
  if (cache) {
    const hit = await cache.match(cacheKey)
    if (hit) {
      const response = new Response(hit.body, hit)
      response.headers.set(EDGE_CACHE_HEADER, 'HIT')
      return response
    }
  }

  const target = new URL(env.API_ORIGIN)
  // The Express app mounts its routes under /api, so the path passes through
  // unchanged rather than being stripped.
  target.pathname = incoming.pathname
  target.search = incoming.search

  const headers = new Headers(request.headers)
  headers.set(PROXY_SECRET_HEADER, env.API_SHARED_SECRET)
  // Host must describe the Lambda, not the Pages origin; fetch sets it.
  headers.delete('host')
  // A client must never be able to spoof the forwarded chain the API sees.
  headers.delete('x-forwarded-host')

  const response = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    // Required by Workers when streaming a request body through.
    ...(request.method !== 'GET' && request.method !== 'HEAD' ? { duplex: 'half' } : {}),
  } as RequestInit)

  // Returned as a stream rather than awaited, so SportQuery's SSE tokens reach
  // the browser as they are produced instead of in one lump at the end.
  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  if (cache && isCacheable(out)) {
    out.headers.set(EDGE_CACHE_HEADER, 'MISS')
    // clone() tees the body, so the visitor's copy still streams; the cache
    // write finishes after the response is sent.
    waitUntil(cache.put(cacheKey, out.clone()))
  }
  return out
}

