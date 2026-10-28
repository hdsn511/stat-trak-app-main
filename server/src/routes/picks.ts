import { Router } from 'express';
import { getTopPicks, getPerfectStreaks } from '../controllers/picksController';
import { getPotd } from '../controllers/potdController';

const router = Router();

router.get('/picks/top', getTopPicks);
router.get('/picks/potd', getPotd);
router.get('/streaks/perfect', getPerfectStreaks);

export default router;

// NHL/NFL have no picks pipeline, but streaks are computed straight from game
// logs, so they get just this one route.
export const streaksOnlyRouter = Router();
streaksOnlyRouter.get('/streaks/perfect', getPerfectStreaks);
