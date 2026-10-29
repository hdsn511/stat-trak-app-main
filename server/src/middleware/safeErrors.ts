import type { Request, Response, NextFunction } from 'express'

export const GENERIC_ERROR = 'Something went wrong. Please try again.'

/**
 * Replaces the message of any 5xx JSON response with a generic one, logging
 * the original.
 *
 * Controllers report failures as `res.status(500).json({ error: err.message })`,
 * and those messages are Postgres/PostgREST internals ("invalid input syntax
 * for type bigint", "Cannot coerce the result to a single JSON object") that
 * describe the schema to anyone who asks and mean nothing to a visitor.
 * Sanitising at one choke point keeps every current and future controller
 * covered. 4xx messages are written for the caller and pass through.
 */
export function safeErrors() {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res)
    res.json = (body?: any) => {
      if (res.statusCode >= 500 && body && typeof body === 'object' && 'error' in body) {
        console.error(
          JSON.stringify({
            level: 'error',
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            error: String(body.error),
          })
        )
        return originalJson({ ...body, error: GENERIC_ERROR })
      }
      return originalJson(body)
    }
    next()
  }
}

/** JSON 404 for unmatched /api paths, instead of Express's HTML page. */
export function apiNotFound() {
  return (_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Not found' })
  }
}

/**
 * Last-resort handler for errors thrown outside a controller's try/catch
 * (malformed JSON bodies, middleware failures). Express's default prints an
 * HTML stack trace page.
 */
export function apiErrorHandler() {
  // Express identifies error handlers by arity, so all four params must stay.
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err?.status ?? err?.statusCode) || 500
    if (status >= 500) {
      console.error(
        JSON.stringify({ level: 'error', method: req.method, url: req.originalUrl, error: String(err?.message ?? err) })
      )
    }
    res.status(status).json({ success: false, error: status >= 500 ? GENERIC_ERROR : 'Bad request' })
  }
}
