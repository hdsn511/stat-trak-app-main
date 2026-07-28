# ESPN Migration — Plan & Next Steps (resume point)

**Status as of 2026-07-28: paused mid-investigation, not yet in a follow-on spec.** This doc exists to pick the thread back up without re-deriving context. Full research findings live in the companion doc: [`2026-07-28-espn-api-research-findings.md`](./2026-07-28-espn-api-research-findings.md).

## Where things stand

1. **Research spike (done, committed).** Tested ESPN's `site.api.espn.com`/`sports.core.api.espn.com` endpoints live for NBA, NFL, NHL. Findings:
   - NBA: basic box score, roster, injuries, schedule/rest all migrate cleanly. `usg_pct`/`pace`/off-def rating are derivable via formula from raw ESPN numbers (points, FGA/FTA/TOV, `estimatedPossessions`) even though not published as named fields per-game.
   - NBA hard gap: `touches`/`time_of_possession`/`paint_touches`/`avg_speed` have **no ESPN equivalent anywhere** (checked core-API stat splits, hustle/tracking guesses, and play-by-play — none carry it). This is Second Spectrum optical tracking data, exclusive to `stats.nba.com`.
   - NFL and NHL: green light, ESPN coverage meets or exceeds the required stat set (NFL even includes targets/QBR/passer rating free; NHL includes full TOI splits/faceoff%/giveaways).
   - Reliability: no IP blocking or rate limiting observed, historical depth verified back to 2010, identical URL pattern across all three sports.

2. **Touches vs. usg_pct impact test (done, not written up as a doc — captured here).** `touches` is the *primary* opportunity-gating signal in the live picks engine (`analytics/screener/screen.py`, `analytics/engine/backtest.py`), with `usg_pct` as an existing documented fallback. Ran a real-data comparison (120 random player/date samples × 4 stats, `MIN_HIT_RATE=0.55` gate from `analytics/engine/scorer.py`):
   - Only 23/480 attempts produced any backtest result at all (separate finding: the historical-matching filters are strict/data is sparse generally, independent of touches vs usg).
   - Of 19 paired results: mean hit-rate diff 4.7 points, max 12.6 points, **pick-decision flip rate 1/19 (5.3%)**.
   - Caveat: n=19 is thin (only ~6 weeks, 2026-05-05 to 2026-06-19, had both signals populated). Not enough to be fully confident in the 5.3% figure.

## Open decision (not yet made)

For NBA, pick one before writing the migration spec:
- **(a) Hybrid:** move box score/roster/injuries/schedule to ESPN, keep a slim `nba_api` call alive just for `PlayerTrackV3` (touches). Preserves the tuned touches signal, shrinks `nba_api` call volume drastically (one call/game instead of every call), reduces but doesn't eliminate rate-limit exposure.
- **(b) Full cutover:** drop `nba_api` entirely, rely on ESPN-derived `usg_pct` as the permanent opportunity signal (not just rampup fallback). ~5% of pick decisions would flip per the (thin) test above.

Leaning toward (a) as of the last discussion, but it's the user's call.

## Next steps (once resumed)

1. Optionally: re-run the touches-vs-usg comparison over a full season instead of 6 weeks to firm up the flip-rate number, before committing to (a) or (b).
2. Write NBA migration spec (via brainstorming → writing-plans), scoped to whichever option above is chosen.
3. Write NFL buildout spec — new pipeline mirroring `analytics/{data,batch,engine,picks,screener}/mlb/` shape.
4. Write NHL buildout spec — same shape.
5. MLB stays untouched (`statsapi.mlb.com` already works, out of scope per original scoping decision).

## Unrelated, interrupted side-thread

User was separately asking how to re-authenticate the GitHub MCP connector so Claude Code on the web can publish/push a branch — that's for the cloud deployment workflow, unrelated to the ESPN work. Was mid-lookup via the `claude-code-guide` agent when this doc was requested; that agent run was stopped by the user before finishing. Worth resuming as its own task, not part of this thread.
