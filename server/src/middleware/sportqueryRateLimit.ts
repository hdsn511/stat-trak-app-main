import rateLimit from 'express-rate-limit'

export const sportqueryMinuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'rate_limit: slow down' },
})

export const sportqueryDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'rate_limit: daily cap reached' },
})
