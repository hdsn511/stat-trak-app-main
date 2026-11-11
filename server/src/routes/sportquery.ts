import { Router } from 'express'
import {
  postSession,
  getSessions,
  getSessionMessages,
  deleteSessionHandler,
  postMessage,
} from '../controllers/sportquery'
import {
  sportqueryMinuteLimiter,
  sportquerySessionLimiter,
} from '../middleware/sportqueryRateLimit'
import { requireUser, enforceQuota } from '../middleware/sportqueryAuth'

const router = Router()

router.use(requireUser)

router.post('/session', sportquerySessionLimiter, postSession)
router.get('/sessions', sportquerySessionLimiter, getSessions)
router.get('/session/:id/messages', sportquerySessionLimiter, getSessionMessages)
router.delete('/session/:id', sportquerySessionLimiter, deleteSessionHandler)
// Per-minute limiter is burst protection; enforceQuota spends the user's free/monthly allowance.
router.post('/message', sportqueryMinuteLimiter, enforceQuota, postMessage)

export default router
