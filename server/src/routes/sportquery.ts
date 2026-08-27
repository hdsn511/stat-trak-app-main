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
  sportqueryDailyLimiter,
  sportquerySessionLimiter,
} from '../middleware/sportqueryRateLimit'

const router = Router()

router.post('/session', sportquerySessionLimiter, postSession)
router.get('/sessions', sportquerySessionLimiter, getSessions)
router.get('/session/:id/messages', sportquerySessionLimiter, getSessionMessages)
router.delete('/session/:id', sportquerySessionLimiter, deleteSessionHandler)
router.post('/message', sportqueryMinuteLimiter, sportqueryDailyLimiter, postMessage)

export default router
