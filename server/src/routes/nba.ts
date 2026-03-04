export {};
const express = require('express');
const router = express.Router();
const {
  getTopTrending,
  getTrends,
  searchPlayers,
  getPlayerGames,
  getTodaysGames,
} = require('../controllers/nbaController');

router.get('/trends/top', getTopTrending);
router.get('/trends', getTrends);
router.get('/players/search', searchPlayers);
router.get('/players/:id/games', getPlayerGames);
router.get('/games/today', getTodaysGames);

module.exports = router;
