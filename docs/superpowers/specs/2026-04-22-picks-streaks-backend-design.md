# Sub-project B — Picks, streaks, game-prop backend + SportQuery enrichment

> Spec for **B** from the session-resume doc (`2026-04-22-session-resume.md`). Builds on A's fixes and on the already-shipped analytics engine (`analytics/picks/generate.py`, `computeNBATrends.ts`).
> Q1 and Q2 from the resume doc are answered; this consolidates the answers into an end-to-end backend design.

## Goal

Give the NBA page (and eventually NFL/MLB/NHL) three useful, truthful cards powered entirely by existing tables + a small nightly compute:

1. **Top Picks card** — 5 player picks + 5 game picks side by side
2. **Streaks card** — Perfect-N leaderboard (player or game, tab-toggled)
3. **Featured Game Picks** — ML / Spread / Total "of the day" inside the Top Picks card's game side

Plus close the SportQuery display gap so the assistant returns shape-aware envelopes like `/api/nba/players/:id/games` does.

## Non-goals

- No ML libraries, no clustering, no historical odds pipeline — free-tier closed-form math only.
- No schema changes. Everything fits into existing tables (`pick_results`, `nba_player_stats`, `nba_trends`, `daily_lines`, `opponent_position_defense`, `player_availability`, `team_game_stats`, `games`, `game_matchups`, `daily_conditions`).
- No frontend work in this spec. That's sub-project C. This spec stops at API contracts.

## Existing constraints to honor

From `analytics/picks/generate.py` and `analytics/engine/backtest.py`:

- `pick_results` is the single output table for picks. Columns used: `game_date`, `prop_type`, `entity_id`, `stat`, `pick_type` (`'safe' | 'value'`), `recommended_line`, `hit_rate`, `sample_size`, `confidence_score`, `implied_prob`, `edge`, `conditions_matched`, `total_conditions`, `key_conditions`, `alt_lines_tested`.
- Current `prop_type` values in use: `'player'`, `'spread'`, `'total'`. **ML (`'winner'`) is explicitly skipped** in generate.py:361 (`if prop_type == "winner": continue  # backtest only supports total and spread`). This is the gap we close.
- `MIN_CONFIDENCE=70`, `MIN_EDGE` from `scorer.py` — keep these thresholds.
- `nba_trends.stat` is smallint (0=pts, 1=reb, 2=ast, 3=3pm, 4=fouls, 5=min). `window_size` is 3/5/10. `trend_val` is z-score.
- Server already filters picks by today's ESPN slate ∩ `player_availability.status != 'out'` in `nbaController.getTopTrending`. Reuse that helper.

---

## Design — Top Picks card (5 player + 5 game)

### Backend

Single new endpoint, pulls from `pick_results` for today's slate:

```
GET /api/nba/picks/top?limit=5
```

**Response envelope:**

```ts
{
  success: true,
  data: {
    game_date: string,          // "YYYY-MM-DD"
    player: PlayerPick[],       // length up to limit
    game:   GamePick[],         // length up to limit — mix of winner/spread/total
  }
}

type PlayerPick = {
  player_id: number;
  player_name: string;
  team: string;
  position: string;
  stat: 'pts' | 'reb' | 'ast' | 'fg3m' | ...;
  pick_type: 'safe' | 'value';
  line: number;
  direction: 'over' | 'under';  // derived from line vs. season_avg
  hit_rate: number;             // 0..1
  confidence: number;           // 0..100
  edge: number;                 // 0..1
  sample_size: number;
  implied_prob: number;         // 0..1
  opponent?: { team: string; league_rank: number | null };
};

type GamePick = {
  game_id: number;
  prop_type: 'winner' | 'spread' | 'total';
  home_team: string;            // e.g., "LAL"
  away_team: string;
  pick_type: 'safe' | 'value';
  line: number | null;          // null for winner — use model_prob instead
  side: 'home' | 'away' | 'over' | 'under';
  hit_rate: number;
  confidence: number;
  edge: number;
  implied_prob: number | null;  // null if no matching Kalshi market
  model_prob?: number;          // for winner, model's predicted win prob (see compute)
};
```

**Selection logic** (in the controller, not a new table):

- Filter `pick_results` to `game_date = <today or next upcoming slate>` (same "widen on empty" fallback the existing `/api/nba/picks/today` uses — reuse, don't re-implement).
- Player side: rows with `prop_type='player'`, order by `confidence_score DESC`, dedupe to one per `(entity_id, stat)` preferring `pick_type='safe'`, take top `limit`. Join `players`, `games`, `opp_defense` for enrichment.
- Game side: rows with `prop_type IN ('winner','spread','total')`, order by `confidence_score DESC`, take top `limit`. Join `games`, `teams`.

### Compute (closing the ML gap)

Extend `analytics/engine/backtest.py` to support `prop_type='winner'` so the existing pipeline in `analytics/picks/generate.py:361` can stop skipping it.

Closed-form model — **one shared matchup-strength calc per game**, then three outputs:

```python
# File: analytics/engine/game_model.py  (new, ~80 lines)

def compute_game_strength(team_id, game_date):
    """
    Inputs (from existing tables):
      - rolling_net_rating: avg(off_rtg - def_rtg) over last 10-15 games from team_game_stats
      - weighted_absent_usage: sum(rolling_usg_5g) for players with player_availability.status='out'
                                on today's game_id (uses daily_conditions if populated,
                                else falls back to season avg usg from nba_player_stats)
      - home_bump: +2.5 if home team, else 0
      - rest_adjustment: -1.5 if on back-to-back, +0.5 if 3+ days rest
    Returns a scalar "adjusted strength" in net-rating units.
    """

def predict_winner(home_strength, away_strength) -> (win_prob_home, margin):
    diff = home_strength - away_strength
    win_prob = 1 / (1 + exp(-diff / 6.0))   # 6 = softness coef; calibrate from historical
    margin   = diff * 0.55                   # margin_coef from historical margin/diff regression
    return win_prob, margin

def predict_total(home_pace, away_pace, home_off, away_off) -> total:
    pace = (home_pace + away_pace) / 2
    off  = (home_off + away_off) / 2
    return pace * off / 100
```

Calibration: `softness_coef=6.0` and `margin_coef=0.55` come from a one-time offline regression against last season's `games` + `team_game_stats`. Hard-coded as constants in `game_model.py`; revisit annually.

### Kalshi line matching

Today's `daily_lines` rows with `prop_type in ('winner','spread','total')` are matched to games by `entity_id` (which `_store_daily_lines` already writes as `None` for game props — **this is a bug that must be fixed**: store `game_id` in `entity_id` for game props so we can join them to today's games). The match gives us `implied_prob`; edge = `model_prob - implied_prob`.

**Kalshi divergence handling (Q1 answer):** Spread and ML can land on different games if Kalshi's ML price for the game with the biggest margin is already efficient. The ranking already naturally handles this — we rank by `confidence_score` (which factors in `edge = model_prob - implied_prob`), not by raw model margin. So when Kalshi has priced in a blowout, edge compresses and another game rises to the top.

### New backtester for `winner`

`analytics/engine/backtest.py::backtest_game_prop` currently handles `'total'` and `'spread'` via historical line backtesting. For `'winner'`:

- Historical lines don't exist → we can't do a traditional backtest.
- Instead, treat the **model's own historical accuracy** as the "hit_rate": replay the model over last N games in the schedule and count correct picks. This is a coarse proxy and must be labeled as such in `conditions_matched`.
- `sample_size` = number of historical games the model produced a prediction for in the trailing window (default: this season to date).

This keeps `pick_results` uniform across all prop types without inventing a second table.

---

## Design — Streaks card (Perfect N leaderboard)

### Player streaks

4 separate lists: **PTS, REB, AST, 3PM**. Single UI shows one list at a time; stat and window are query params.

```
GET /api/nba/streaks/perfect?type=player&stat=<pts|reb|ast|3pm>&window=<3|5|10>
```

**Hit definition:**

- PTS, REB, AST: `hit = game_value >= season_avg` for that player
- 3PM: `hit = game_value >= max(2, player_avg_3pm - 1)`  (scales for high-volume shooters)

**Qualifying filter:** every player in the response must satisfy **all** of:

1. Player's team is on today's ESPN scoreboard (reuse `getTopTrending`'s ESPN fetch + `todayTeams` set).
2. `player_availability.status != 'out'` for today's game.
3. A row exists in today's `daily_lines` with `prop_type='player'`, `entity_id=player_id`, `stat=<stat>`, AND `implied_prob <= 0.80`.

**Hit-rate condition:** player's last `window` games must all be hits (100%). Ties count as hits.

**Sort:** `opponent_position_defense.league_rank` for that player's position DESC (30 = worst defense = top of list, 1 = best = bottom). Secondary sort: season avg DESC.

**Cut:** top 10.

**Response shape:**

```ts
{
  success: true,
  data: {
    stat: string,
    window: number,
    rows: Array<{
      player_id: number;
      player_name: string;
      team: string;
      position: string;
      season_avg: number;
      rolling_avg: number;
      streak_count: number;          // === window (always 100%), included for UI clarity
      opponent: { team: string; league_rank: number | null };
      todays_line: number;
      todays_implied_prob: number;
    }>
  }
}
```

### Game streaks

```
GET /api/nba/streaks/perfect?type=game&stat=<cover_spread|over_total|winner>&window=<3|5|10>
```

- `cover_spread`: team covered the spread in all of its last N games (historical spread via `daily_lines` joined to final margin from `games` + `team_game_stats`). Requires spread lines existed — naturally skips games where we have no line.
- `over_total`: game went over its total in all of last N games (joined similarly).
- `winner`: team won straight up in all of last N games (no line dependency).

**Qualifying filter:** team plays today.
**Response:** analogous to player side, keyed on `team_id` with opponent context.

### Implementation — where it lives

A nightly cron in `analytics/batch/nightly.py` computes and writes to a new lightweight view or materialized table? **No** — we said no schema changes. Instead:

- Streaks are computed **at request time** by the controller. Each request is a single SQL against `nba_player_stats` (or `team_game_stats`) filtered to last N games per player/team on today's slate. With today's ~30 players per stat × 3 windows, that's well under 100 players/queries per page load — acceptable latency (<300ms on current db).
- If this becomes hot later, cache in memory per (stat, window, game_date) for ~5 minutes. Out of scope now.

---

## Design — Featured Game Picks (inside Top Picks card's game side)

Three **single featured cards** mixed into the 5 game-side picks:

- **ML of the Day** — game with highest `model_prob` across today's slate (winner prop_type in pick_results)
- **Spread of the Day** — game with largest absolute `model_margin` (spread prop_type)
- **Total of the Day** — game with model total furthest from league baseline (~220 for NBA; constant in `game_model.py`)

These are just the top pick of each prop_type from the main `pick_results` rank, labeled accordingly by the frontend. **No new endpoint** — they come through `GET /api/nba/picks/top`, which is responsible for including at least one of each type among the 5 game picks when available.

**Selection rule** inside `/api/nba/picks/top` game side:
1. Take top pick by confidence from `prop_type='winner'`, label it `featured: 'ml'`.
2. Take top pick from `prop_type='spread'`, label `featured: 'spread'`.
3. Take top pick from `prop_type='total'`, label `featured: 'total'`.
4. Fill remaining slots up to `limit` with next-highest-confidence rows of any game prop_type, `featured: null`.
5. If the top spread and top ML are the same game (mathematically linked, expected per Q1), keep both entries — they're different prop types and the user asked for this.

Add `featured?: 'ml' | 'spread' | 'total' | null` to `GamePick`.

**Card truthfulness (from resume doc):** until Kalshi game lines are flowing reliably, UI must label these as "Model's most confident pick" / "Model's widest spread" / "Model's highest total" — not "Best bet". The backend includes both `model_prob` and `implied_prob` so the frontend can show edge when available and suppress when `implied_prob` is null.

---

## Design — SportQuery result envelope enrichment

Implements the backlog doc at `docs/superpowers/backlog/2026-04-22-sportquery-result-enrichment.md`.

### Current flow (verified against `server/src/controllers/sportquery.ts`)

The LLM returns an `Envelope` (`sql`, `narrative`, `disambiguation?`, `follow_up_suggestions?`). The controller executes the SQL, then streams an SSE `results` event with `{rows, disambiguation, follow_up_suggestions}`. The frontend renders `rows` via a hardcoded player-shape component.

### New flow

The `results` SSE payload is extended with a `shape` discriminator + enriched rows:

```ts
// emitted from sportquery.ts in the `results` SSE event
{
  shape: 'player_trends' | 'player_games' | 'picks' | 'lines' | 'generic',
  rows: EnrichedRow[],            // shape-specific — see below
  disambiguation: ...,
  follow_up_suggestions: string[]
}
```

The LLM `Envelope` type stays unchanged. Shape detection + enrichment is a new step in `sportquery.ts::postMessage` after `runReadOnly` returns and before `send('results', ...)` fires. Implemented via a new helper module `server/src/services/sportqueryEnrich.ts`. Shape is detected by inspecting the first row's columns (cheap, no extra LLM call):

| Shape | Detection heuristic | Enrichment added |
|---|---|---|
| `player_trends` | Columns include `trend_val` AND `window_size` | `statLabel`, `zScoreBucket` ('hot'\|'warm'\|'cold'), `seasonAvg`, `todaysOpponent?: { team, leagueRank }` |
| `player_games` | Columns include `game_id` AND `player_id` AND (`pts` OR `reb`) | `opponentAbbr`, `hit` (bool vs default threshold), `seasonAvg`, `isHome` |
| `picks` | `prop_type` AND (`pick_type` OR `confidence_score`) | `statLabel`, `confidenceBucket`, `edgePct`, `directionLabel` |
| `lines` | `kalshi_price` OR `implied_prob` | `impliedProbPct`, `bookLabel: 'Kalshi'` |
| `generic` | Anything else | Pass-through; frontend renders a generic table |

### Today-widening fallback (A follow-up)

The LLM currently emits strict `WHERE game_date = CURRENT_DATE` filters. When the query targets picks or lines and returns zero rows, the backend transparently retries with the "nearest upcoming slate" lookup used by `getTodaysPicks` in `nbaController.ts:246-255`. Implemented as a wrapper around `runReadOnly` in `sportquery.ts::postMessage`:

```ts
if (rows.length === 0 && /FROM (pick_results|daily_lines)/i.test(sql) && /CURRENT_DATE/.test(sql)) {
  const nextDate = await findNearestUpcomingSlate();
  sql = sql.replace(/CURRENT_DATE/g, `'${nextDate}'`);
  rows = await execute_sql(sql);
  narrative = `No picks for today yet — showing ${nextDate}.` + narrative;
}
```

Alternative (cleaner long-term) is teaching the LLM this pattern via few-shot examples in `sportquery-examples.ts`. Defer — start with the backend widening since we already hit this issue in A.

---

## API surface — summary

| Endpoint | Purpose | New? |
|---|---|---|
| `GET /api/nba/picks/top?limit=5` | Top 5 player + 5 game picks for today's slate, featured flags | **New** |
| `GET /api/nba/streaks/perfect?type=&stat=&window=` | Perfect-N leaderboard (player or game) | **New** |
| `GET /api/nba/picks/today` | Unchanged (keep for backwards compat) | — |
| `GET /api/nba/top-trending` | Unchanged | — |
| `POST /api/sportquery/ask` | Response envelope extended with `shape` discriminator + enriched rows | **Modified** |

---

## Files touched

### Python (analytics)

- **New:** `analytics/engine/game_model.py` — closed-form strength / win_prob / margin / total functions + calibration constants.
- **Modified:** `analytics/engine/backtest.py` — add `backtest_winner(game_id, game_date)` using model accuracy replay.
- **Modified:** `analytics/picks/generate.py` — remove `if prop_type == "winner": continue` skip at line 361; add winner prop backtesting loop.
- **Modified:** `analytics/picks/generate.py::_store_daily_lines` — write `game_id` into `entity_id` for game props instead of `None` (bug fix needed for downstream joins).

### TypeScript (server)

- **New:** `server/src/controllers/picksController.ts` — `getTopPicks`, `getPerfectStreaks`. (Currently these might live in `nbaController.ts`; split now if it grows past ~300 lines, otherwise add there.)
- **New:** `server/src/routes/picks.ts` if split; otherwise add routes to existing `server/src/routes/nba.ts`.
- **New:** `server/src/services/sportqueryEnrich.ts` — `detectShape(rows)` + per-shape enricher functions. Pure, unit-testable.
- **Modified:** `server/src/controllers/sportquery.ts` — after `runReadOnly`, call `detectShape` + enricher; wrap in today-widening fallback; pass `shape` through in the `results` SSE event.
- **Modified:** `client/src/services/api.ts` — typed clients for the two new endpoints (no UI yet; contracts only).

### Config / constants

- **Modified:** `server/src/jobs/scheduler.ts` — no change if nightly pipeline already runs `analytics.picks.generate`. Verify it does.

---

## Rollout order

1. **Fix the `entity_id=None` bug** in `generate.py::_store_daily_lines` so game props are join-able. One-line fix. Land first; it's been silently poisoning game props.
2. **Extend backtester + generator** to produce `winner` picks. Add `game_model.py`. Run once against yesterday to verify `pick_results` gets winner rows with sane confidence distribution.
3. **Add `/api/nba/picks/top` endpoint.** Test: returns 5+5 shape, game side includes at least one winner/spread/total when available.
4. **Add `/api/nba/streaks/perfect` endpoint.** Test: hit the 4 stats × 3 windows matrix, confirm qualification filters actually cut the list.
5. **SportQuery envelope enrichment.** Implement shape detection + per-shape enrichers. Keep backwards-compatible fallback to `generic` so existing frontend doesn't break before C lands.
6. **Today-widening fallback** in sportquery service.
7. **Verify end-to-end** via existing smoke checklist from commit `e09f61f` (sportquery E2E smoke test).

---

## Test plan

**Unit-ish (analytics):**
- `game_model.compute_game_strength` — golden test with hand-picked team_id + game_date and known net rating → within 0.5 of expected.
- `predict_winner` — symmetric: equal strengths → 0.5 ± 0.01.
- `_store_daily_lines` — game prop row has non-null `entity_id` matching `game_id`.

**Integration (server):**
- `GET /api/nba/picks/top` on a date with known `pick_results` rows → expected counts and featured flags.
- `GET /api/nba/streaks/perfect?type=player&stat=pts&window=5` on a mocked DB snapshot → ordering matches expected league-rank DESC.
- SportQuery: hit each shape branch with a representative SQL. Verify `shape` field is one of the 5 valid values and enrichment keys are present.

**Manual:**
- Run `python -m analytics.picks.generate --date <today> --mock` — confirm winner rows appear in `pick_results`.
- Hit both endpoints via curl; inspect JSON.
- SportQuery smoke test (existing checklist).

---

## Open items intentionally deferred

- **Historical ML accuracy calibration** — the `softness_coef=6.0` and `margin_coef=0.55` constants need a one-time offline fit before they're trustworthy. Add a notebook `analytics/notebooks/calibrate_game_model.ipynb` as a follow-up task; ship with reasonable defaults now.
- **Cache layer for streaks endpoint** — only matters if load is high. Not now.
- **Game-prop streaks for teams without line coverage** — `cover_spread` naturally excludes teams we lack lines for; we're OK with silent exclusion (not a silent failure since the stat is "cover_spread" which requires a line by definition).
- **SportQuery LLM examples for widened dates** — once backend widening is stable, teach the LLM and retire the decorator. Not in this spec.

---

## Self-review checklist

- [ ] No placeholders. (Search for `TODO`, `TBD`, `???`.)
- [ ] All table names verified against existing code: `pick_results`, `daily_lines`, `nba_player_stats`, `nba_trends`, `player_availability`, `opponent_position_defense`, `team_game_stats`, `games`, `players` ✓
- [ ] No contradictions between "no schema changes" and endpoint contracts — verified, all fields map to existing columns.
- [ ] ML gap in existing generator.py explicitly called out and fixed in rollout step 2.
- [ ] Truthfulness concern (cards not claiming edge when no market) explicitly handled via nullable `implied_prob`.
- [ ] Matches Q1 answer: ML/Spread/Total computed per their own method + game conditions; Kalshi divergence handled via edge-based ranking.
- [ ] Matches Q2 answer: vertical layout (top picks → streaks toggle → trend finder), no separate "right card". Backend supplies what each vertical section needs.
