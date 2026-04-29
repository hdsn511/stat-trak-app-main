export {};
const express = require('express');
const router = express.Router();
const { getTopPicks, getPerfectStreaks } = require('../controllers/picksController');
const { getPotd } = require('../controllers/potdController');

router.get('/picks/top', getTopPicks);
router.get('/picks/potd', getPotd);
router.get('/streaks/perfect', getPerfectStreaks);

module.exports = router;
