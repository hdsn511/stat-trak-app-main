import { Router } from 'express';
import {
  getTopTrending,
  getTrends,
  searchPlayers,
  getPlayerGames,
  getTodaysGames,
  getTodaysPicks,
  getPlayerPicks,
  getStreakWatch,
} from '../controllers/nbaController';
import { getGameById, getGameInsights } from '../controllers/gameController';
import { getTeamById } from '../controllers/teamController';
import { getTeamDefense } from '../controllers/defenseController';
import { getStandings } from '../controllers/standingsController';
import { getProjects } from '../controllers/projectsController';
import { getNews } from '../controllers/newsController';
import { getSuggestionResults } from '../controllers/suggestionsController';

const router = Router();

router.get('/standings', getStandings);
router.get('/projects', getProjects);
router.get('/news', getNews);
router.get('/streaks/watch', getStreakWatch);
router.get('/suggestions/results', getSuggestionResults);

router.get('/trends/top', getTopTrending);
router.get('/trends', getTrends);
router.get('/players/search', searchPlayers);
router.get('/players/:id/games', getPlayerGames);
router.get('/games/today', getTodaysGames);
router.get('/games/:id/insights', getGameInsights);
router.get('/games/:id', getGameById);
// Declared before /teams/:id so the more specific path wins.
router.get('/teams/:id/defense', getTeamDefense);
router.get('/teams/:id', getTeamById);
router.get('/picks/today', getTodaysPicks);
router.get('/picks/player/:id', getPlayerPicks);

export default router;
