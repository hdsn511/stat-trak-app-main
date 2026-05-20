import { Router } from 'express';
import { getPerformanceSummary, getStreakPerformance, getStreakOutcomes } from '../controllers/performanceController';

const router = Router();

router.get('/summary', getPerformanceSummary);
router.get('/streaks', getStreakPerformance);
router.get('/streak-outcomes', getStreakOutcomes);

export default router;
