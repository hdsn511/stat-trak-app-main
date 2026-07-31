import { Router } from 'express';
import {
  getTopTrending,
  getTrends,
  searchPlayers,
  getPlayerGames,
  getTodaysGames,
  getTodaysPicks,
  getPlayerPicks,
} from '../controllers/nbaController';
import { getGameById } from '../controllers/gameController';
import { getTeamById } from '../controllers/teamController';
import { getTeamDefense } from '../controllers/defenseController';

const router = Router();

router.get('/trends/top', getTopTrending);
router.get('/trends', getTrends);
router.get('/players/search', searchPlayers);
router.get('/players/:id/games', getPlayerGames);
router.get('/games/today', getTodaysGames);
router.get('/games/:id', getGameById);
// Declared before /teams/:id so the more specific path wins.
router.get('/teams/:id/defense', getTeamDefense);
router.get('/teams/:id', getTeamById);
router.get('/picks/today', getTodaysPicks);
router.get('/picks/player/:id', getPlayerPicks);

export default router;
