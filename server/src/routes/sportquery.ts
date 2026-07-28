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
} from '../middleware/rateLimit'

const router = Router()

router.post('/session', postSession)
router.get('/sessions', getSessions)
router.get('/session/:id/messages', getSessionMessages)
router.delete('/session/:id', deleteSessionHandler)
router.post('/message', sportqueryMinuteLimiter, sportqueryDailyLimiter, postMessage)

export default router
