import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../config/supabaseAdmin'

export const ANON_LIFETIME_LIMIT = 25
export const USER_MONTHLY_LIMIT = 100
const GLOBAL_DAILY_CAP = Number(process.env.SPORTQUERY_GLOBAL_DAILY_CAP ?? 5000)
const GLOBAL_USER = '00000000-0000-0000-0000-000000000000'
export const MAX_MESSAGE_CHARS = 1000

export type SqUser = { id: string; isAnon: boolean }

declare module 'express-serve-static-core' {
  interface Request {
    sqUser?: SqUser
  }
}

/** Verifies the Supabase JWT (anonymous or signed-in) and sets req.sqUser. */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')
  if (!m) {
    res.status(401).json({ success: false, code: 'auth_required', error: 'sign-in required' })
    return
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(m[1]!)
    if (error || !data.user) throw error ?? new Error('no user')
    req.sqUser = { id: data.user.id, isAnon: Boolean(data.user.is_anonymous) }
    next()
  } catch {
    res.status(401).json({ success: false, code: 'auth_required', error: 'invalid session' })
  }
}

async function consume(user: string, period: string, limit: number) {
  const { data, error } = await supabaseAdmin.rpc('sportquery_consume', {
    p_user: user,
    p_period: period,
    p_limit: limit,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { allowed: Boolean(row?.allowed), used: Number(row?.used ?? 0) }
}

/** Spends one query: global daily cap first, then the user's own quota. */
export async function enforceQuota(req: Request, res: Response, next: NextFunction) {
  const u = req.sqUser!
  try {
    const day = new Date().toISOString().slice(0, 10)
    if (!(await consume(GLOBAL_USER, day, GLOBAL_DAILY_CAP)).allowed) {
      res.status(503).json({ success: false, code: 'capacity', error: 'SportQuery is at capacity today. Try again tomorrow.' })
      return
    }
    const period = u.isAnon ? 'lifetime' : new Date().toISOString().slice(0, 7)
    const limit = u.isAnon ? ANON_LIFETIME_LIMIT : USER_MONTHLY_LIMIT
    const q = await consume(u.id, period, limit)
    if (!q.allowed) {
      res.status(402).json({
        success: false,
        code: u.isAnon ? 'signup_required' : 'monthly_limit',
        error: u.isAnon
          ? `You have used your ${limit} free questions. Sign up to get ${USER_MONTHLY_LIMIT} per month.`
          : `You have used your ${limit} questions for this month.`,
        used: q.used,
        limit,
      })
      return
    }
    next()
  } catch {
    // Fail closed: an unmetered LLM endpoint is the expensive failure.
    res.status(503).json({ success: false, code: 'quota_unavailable', error: 'Could not verify your usage. Try again.' })
  }
}
