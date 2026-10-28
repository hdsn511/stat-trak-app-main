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

const router = Router()

router.post('/session', sportquerySessionLimiter, postSession)
router.get('/sessions', sportquerySessionLimiter, getSessions)
router.get('/session/:id/messages', sportquerySessionLimiter, getSessionMessages)
router.delete('/session/:id', sportquerySessionLimiter, deleteSessionHandler)
// No daily cap for now (accounts will bring per-user limits). The per-minute
// limiter stays as burst protection.
router.post('/message', sportqueryMinuteLimiter, postMessage)

export default router
