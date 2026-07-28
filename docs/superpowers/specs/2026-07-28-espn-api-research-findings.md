# ESPN Hidden API — Research & Validation Findings

**Date:** 2026-07-28
**Scope:** Determine whether ESPN's undocumented site API (`site.api.espn.com`) and its underlying core API (`sports.core.api.espn.com`) can (a) replace `nba_api` for NBA, and (b) support new NFL and NHL data pipelines at a depth comparable to the existing NBA/MLB pipelines. MLB is out of scope — `statsapi.mlb.com` already works well and isn't being replaced.

**Method:** Live requests against real endpoints (not the gist alone, which only documents `scoreboard`/`news`/`teams`). Sample games pulled from 2026-01-15 (NBA/NHL) and 2025-12-28 (NFL), all `STATUS_FINAL`. Raw responses inspected directly; no throwaway probe code was kept (per scope decision — this report is the only persisted artifact).

## Endpoint inventory (confirmed working, all three sports)

Base pattern: `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/{resource}`

| Resource | Path | NBA | NFL | NHL |
|---|---|---|---|---|
| Scoreboard by date | `scoreboard?dates=YYYYMMDD` | ✅ | ✅ | ✅ |
| Game boxscore/detail | `summary?event={id}` | ✅ | ✅ | ✅ |
| Team roster | `teams/{id}/roster` | ✅ | ✅ | ✅ |
| League-wide current injuries | `injuries` | ✅ | ✅ | ✅ |
| Standings | `standings` | ✅ | ✅ | ✅ |

The `summary` endpoint is the workhorse — for all three sports it returns `boxscore`, `injuries` (game-specific), `standings`, `winprobability`, `odds`/`pickcenter`, and `leaders` in one call.

There's also a second, richer layer: `sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/...`, reachable via `$ref` links inside the site API responses (e.g. a game's `competitors[].roster` entry links to `.../roster/{playerId}/statistics/0`). This is where per-player, per-game advanced stat categories live — the site API's flat boxscore table (`MIN, PTS, FG, 3PT, ...`) is only a display-friendly subset.

## NBA

**Basic box score** (`boxscore.players[].statistics[].athletes[].stats`): MIN, PTS, FG, 3PT, FT, REB, AST, TO, STL, BLK, OREB, DREB, PF, +/- — covers all four current trend stats (points/rebounds/assists/threes) plus fouls and minutes directly. ✅ full coverage.

**Advanced/tracking stats — this was the flagged risk.** Tested the core-API per-game player statistics resource (`.../competitors/{team}/roster/{player}/statistics/0`) directly, not just the season-aggregate one:

| Field NBA pipeline uses | Per-game ESPN equivalent | Verdict |
|---|---|---|
| `usg_pct` (usage %) | Not published per-game, but `fieldGoalsAttempted`, `freeThrowsAttempted`, `turnovers`, `minutes` (player) + team totals for the same are all present → standard USG% formula is fully computable | **Derivable**, not native |
| `pace` | Not published, but `estimatedPossessions` is present per team per game → pace (poss/48) is directly computable | **Derivable**, not native |
| `off_rating` / `def_rating` | Not published, but `points` and `estimatedPossessions` (both teams) are present → ORtg/DRtg (pts per 100 poss) computable from raw box score numbers | **Derivable**, not native |
| `touches`, `front_court_touches`, `paint_touches`, `time_of_possession`, `avg_speed` | **No equivalent anywhere** — checked player stats, team stats, and season-aggregate stats resources | **Hard gap** — these come from NBA's proprietary Second Spectrum optical tracking, which ESPN doesn't mirror at all |

Season-aggregate athlete stats (a different, separate endpoint) *do* expose named `usageRate`, `PER`, `VORP`, `NBARating`, `trueShootingPct` — but only as season totals, not per-game, so they can't drive per-game rolling trends the way the current pipeline needs.

**Other confirmed data:** roster with height/weight/age/DOB (`teams/{id}/roster`), league-wide live injury report with status + long-form medical notes (`injuries`), home/away and days-rest (computable from `scoreboard?dates=`), historical scoreboard depth verified back to **2010-10-26** (opening night that season returned 3 correct games) — well beyond the pipeline's 2019-20 floor.

**Verdict: partial migration, not full.** Basic box score + roster + injuries + schedule/rest context can move to ESPN outright, solving the actual pain point (rate-limiting/IP-blocking on stats.nba.com). Usage%/pace/ratings can move too, recomputed via formula from ESPN's raw numbers instead of consumed pre-labeled. **Touches/time-of-possession/paint-touches/avg-speed have no path off `nba_api` at all** — no known public API mirrors Second Spectrum tracking data. If those five fields are a hard requirement, NBA cannot go 100% ESPN; it would need to stay on `nba_api` for that one advanced-tracking call (which could plausibly run at lower frequency/priority than the full pipeline, reducing exposure to the rate limit, but doesn't eliminate it).

## NFL

**Boxscore stat groups** (`boxscore.players[].statistics[]`), confirmed via a real Cardinals @ Bengals game:

- `passing`: C/ATT, YDS, AVG, TD, INT, SACKS, QBR, RTG
- `rushing`: CAR, YDS, AVG, TD, LONG
- `receiving`: REC, YDS, AVG, TD, LONG, **TGTS** (targets — needed for target-share)
- `fumbles`, `defensive` (TOT/SOLO/SACKS/TFL/PD/QB HTS/TD), `interceptions`, `kickReturns`, `puntReturns`, `kicking`, `punting`

This fully covers the requested set (passing/rushing/receiving yards + TDs, attempts/completions, INTs) and goes further — includes targets, QBR, and passer rating natively without needing to derive anything. Did not find snap counts or Next Gen Stats fields (separation, time-to-throw, air yards) anywhere in the summary payload — those are NFL's own proprietary tracking product and, like NBA's tracking data, are not expected to be in a public API.

**Injuries:** per-game (`summary.injuries`) and league-wide (`injuries`) both return status (`Out`/`Questionable`/etc.), timestamp, and full athlete/position info.

**Verdict: strong coverage.** Core box score categories are complete and richer than the minimum ask (targets, QBR included free). Advanced NextGenStats-style metrics are a hard gap, same shape as NBA's tracking gap, but weren't part of the required set.

## NHL

**Boxscore stat groups**, confirmed via a real Canadiens @ Sabres game:

- Skaters (`forwards`/`defenses`/`skaters`): BS (blocks), HT (hits), TK (takeaways), +/-, **TOI, PPTOI, SHTOI, ESTOI** (full time-on-ice split), shifts, G, YTD goals, A, S, shots missed, SOG, faceoff wins/losses, FO%, giveaways, penalties, PIM
- Goalies: GA, SA, shootout saves/attempts, SV, SV%, even-strength/PP/SH saves, TOI, PIM

This covers the required set (goals/assists/shots/saves) and goes considerably further — TOI splits by situation, faceoff%, giveaway/takeaway are all present, which is unusually deep for a "hidden" API. No explicit Corsi/Fenwick, but with shot/block/hit counts available, those are computable if ever needed.

**Injuries/standings:** same pattern as NBA/NFL, both confirmed working.

**Verdict: strong coverage,** deeper than what MLB/NBA currently track for their own sports in some respects (TOI-by-situation has no real NBA/MLB analogue).

## Reliability

- **No IP blocking observed** — consistent with the MLB client's existing note that `site.api.espn.com`-style endpoints aren't gated the way `stats.nba.com` is.
- **No rate limiting observed** in a 20-request rapid-fire burst (all HTTP 200, no 429s, no throttling). Not a guarantee of unlimited headroom, but no wall was hit either.
- **Historical depth**: NBA scoreboard verified accurate back to 2010; not tested further back since it already exceeds the pipeline's needs.
- All three sports use the **identical URL/response shape pattern**, so a single client implementation (mirroring the existing `analytics/data/mlb/client.py` style: thin wrapper, bounded retry, no cooldown ladder needed) can serve all of them.

## Recommendation

| Sport | Recommendation |
|---|---|
| **NBA** | Migrate basic box score, roster, injuries, and schedule/rest calls to ESPN — this removes the actual rate-limiting pain point. Recompute usage%/pace/ratings from ESPN's raw numbers via formula instead of consuming `nba_api`'s pre-labeled versions. **Keep `nba_api` as the sole source for touches/time-of-possession/paint-touches/avg-speed** (no substitute exists) — this is a decision the team needs to confirm before a migration spec is written, since it means the rate-limit problem is reduced, not eliminated. |
| **NFL** | Green light — build the full pipeline on ESPN. Coverage is at or above what's needed. |
| **NHL** | Green light — build the full pipeline on ESPN. Coverage is at or above what's needed. |

**Next steps:** three follow-on specs — NBA migration (with the tracking-data caveat above resolved), NFL buildout, NHL buildout — each following the existing MLB pipeline's shape (`analytics/data/{sport}/client.py` → `batch/` → `engine/` → `picks/`/`screener/`).
