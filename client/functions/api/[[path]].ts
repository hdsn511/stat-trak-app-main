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

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.API_ORIGIN || !env.API_SHARED_SECRET) {
    return Response.json(
      { success: false, error: 'proxy misconfigured' },
      { status: 503 }
    )
  }

  const incoming = new URL(request.url)
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
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

