import type { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'crypto'

/**
 * Header the Cloudflare Pages Function injects when it proxies /api/* to the
 * Lambda Function URL.
 */
export const PROXY_SECRET_HEADER = 'x-stattrak-proxy-secret'

const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch, and the lengths themselves are
  // not secret, so compare them first.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Rejects requests that did not come through the Cloudflare proxy.
 *
 * A Lambda Function URL serving a public API must use AuthType NONE, so this
 * shared secret is the only thing standing between the open internet and an
 * endpoint that spends money per call on Groq/OpenAI.
 *
 * When the secret is unset the gate is skipped, which is what local dev and the
 * test suite need — but on Lambda a missing secret means the deployment is
 * misconfigured, and failing open there would silently expose the API. So on
 * Lambda it fails closed instead.
 */
export function proxySecretGate() {
  const expected = process.env.API_SHARED_SECRET

  if (!expected) {
    if (isLambda) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'API_SHARED_SECRET is not set on Lambda; refusing all /api traffic',
        })
      )
      return (_req: Request, res: Response) => {
        res.status(503).json({ success: false, error: 'server misconfigured' })
      }
    }
    console.warn('proxySecretGate: API_SHARED_SECRET not set — gate disabled (local dev).')
    return (_req: Request, _res: Response, next: NextFunction) => next()
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const provided = req.get(PROXY_SECRET_HEADER)
    if (!provided || !matches(provided, expected)) {
      res.status(403).json({ success: false, error: 'forbidden' })
      return
    }
    next()
  }
}
