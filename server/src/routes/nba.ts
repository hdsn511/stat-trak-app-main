export {};
const express = require('express');
const router = express.Router();
const {
  getTopTrending,
  getTrends,
  searchPlayers,
  getPlayerGames,
  getTodaysGames,
  getTodaysPicks,
  getPlayerPicks,
} = require('../controllers/nbaController');

router.get('/trends/top', getTopTrending);
router.get('/trends', getTrends);
router.get('/players/search', searchPlayers);
router.get('/players/:id/games', getPlayerGames);
router.get('/games/today', getTodaysGames);
router.get('/picks/today', getTodaysPicks);
router.get('/picks/player/:id', getPlayerPicks);

module.exports = router;
