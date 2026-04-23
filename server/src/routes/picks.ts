export {};
const express = require('express');
const router = express.Router();
const { getTopPicks, getPerfectStreaks } = require('../controllers/picksController');

router.get('/picks/top', getTopPicks);
router.get('/streaks/perfect', getPerfectStreaks);

module.exports = router;
