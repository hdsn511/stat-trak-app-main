# Session resume — StatTrak rework (A/B/C/D)

> Written 2026-04-22 as a checkpoint mid-brainstorm. To resume: open this file, find "Where we stopped", and continue from the OPEN QUESTIONS section. The full sub-project A/B/C/D decomposition and decisions are preserved below so a cold session can pick up.

## Top-line plan

User asked for four things in one request. They were decomposed into **four sub-projects** executed sequentially, each with its own spec + plan:

| #     | Sub-project                             | Status                  | Notes                                                                                           |
| ----- | --------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| **A** | Fix Groq 404 + related SportQuery bugs  | ✅ **DONE**             | Fixed inline; backend works; display-layer gap captured as B backlog                            |
| **B** | NBA streaks + picks + game-prop backend | 🟡 **In brainstorming** | Most design locked; 2 open questions below                                                      |
| **C** | shadcn migration + NBA page rebuild     | ⏳ Pending              | Preparatory inventory done at `docs/superpowers/specs/2026-04-22-shadcn-migration-inventory.md` |
| **D** | PlayerDetailView dashboard overhaul     | ⏳ Pending              | Not yet scoped; most creative of the four                                                       |

---

## A — What was fixed (reference)

Root cause was a cascade, not one bug. All fixed:

1. **Groq model 404** — Retired model `moonshotai/kimi-k2-instruct` replaced with `llama-3.3-70b-versatile` in `server/src/config/groq.ts` (user's tier does not have Kimi K2 access — verified via Groq models list)
2. **Compiled dist stale** — `server/dist/config/groq.js` also patched so `npm start` doesn't serve the old model
3. **Supabase DNS (`ENOTFOUND`)** — Direct host `db.<ref>.supabase.co` is IPv6-only; switched to Supavisor pooler. Correct cluster for this project = `aws-1-us-east-2` (not `aws-0`).
4. **Supabase auth (`Tenant or user not found`)** — Pooler needs `<user>.<project-ref>` username format
5. **Supabase auth (`password authentication failed`)** — User created `sportquery_app` / `sportquery_reader` roles via dashboard UI without passwords; set password via `ALTER USER sportquery_app WITH PASSWORD 'kXn9Pq3Mw7Rv2Lj8Hy4Zs6Bt'`. Least-privilege role now used instead of `postgres` superuser.
6. **Schema drift in LLM prompt** — `server/src/prompts/sportquery-system.ts` + all 4 broken `sportquery-examples.ts` entries patched to match real DB schema. Key corrections:
   - `nba_trends.z_score` → `trend_val`
   - `nba_trends.window` → `window_size`
   - `nba_trends.stat` is a smallint code (0=pts, 1=reb, 2=ast, 3=3pm, 4=fouls, 5=min) — NOT a string
   - `daily_lines.player_id` → `entity_id`, `pick_date` → `game_date`
   - `teams.full_name` → `name` + `city`
   - `nba_player_stats` and `nba_trends` have no `id` column (composite PKs)

Also unrelated but fixed earlier:

- Root `package.json` scripts now use `npm run dev --prefix client` so Vite runs from `client/` where `index.html` lives
- `server/package.json` nodemon now watches `.env` so env changes auto-restart
- Redundant `require('dotenv').config()` removed from `server/src/server.ts`

## A follow-ups in backlog

- `docs/superpowers/backlog/2026-04-22-sportquery-result-enrichment.md` — SportQuery returns rows with shapes other than player-shape (games, picks, lines), and the React display renders them as "Unknown" because `CompactPlayerCard` is hardcoded. Proposed fix: add a `shape` discriminator on the envelope and shape-aware renderers in the frontend. Belongs in B's spec.
- LLM's `WHERE game_date = CURRENT_DATE` filter returns empty sets when today's picks haven't populated; REST endpoint `/api/nba/picks/today` already falls back to nearest upcoming slate. Either teach LLM the fallback pattern or widen transparently in backend.

---

## B — Decisions locked so far

### Page layout (v2)

```
┌─────────┬────────────────────────────────┬────────────────────────┐
│ Sidebar │ Left card (tabs)               │ Right card (length 10) │
│ (games) │ ├─ Top 5 Picks                 │ [STILL OPEN — see Q]   │
│         │ │    • 5 player + 5 game = 10  │                        │
│         │ └─ Streaks (Perfect N)         │                        │
│         │      • sub-toggle: player/game │                        │
│         │                                │                        │
│         │         ——— TrendFinder ———                             │
└─────────┴────────────────────────────────┴────────────────────────┘
```

### Player Perfect N leaderboard

- 4 **separate** lists: PTS, REB, AST, 3PM (no combined PRA)
- **Single list** UI with window toggle: 3 / 5 / 10 games
- **Metric:** 100% hit rate over last N games (every game must be a hit, ties count as hits)
- **Threshold per stat:**
  - PTS, REB, AST: `hit = game_value ≥ season_avg`
  - 3PM: `hit = game_value ≥ max(2, player_avg_3pm − 1)` — scales up for high-volume shooters
- **Qualifying filter (every player shown):**
  - Team is on today's NBA slate (ESPN scoreboard intersect)
  - Player not marked `out` in `player_availability`
  - Today's Kalshi line exists for the stat AND implied prob ≤ 80%
- **Sort:** `opponent_position_defense.league_rank` descending (rank 30 = worst D = top of list, rank 1 = best D = bottom)
- **Cut:** top 10 per stat per window

### Game Prop approach — "X of the Day" (not a leaderboard)

Instead of building a game-streak leaderboard (which would need historical spread/total line data we don't have), show **three single featured cards** inside the Top 5 Picks → Game Prop tab:

- **ML of the Day** — game with highest model-predicted win probability across today's slate
- **Spread of the Day** — game with largest absolute expected margin
- **Total of the Day** — game with most extreme expected total vs. league baseline (~220 in NBA)

#### Compute model (single nightly job; mirrors `computeNBATrends.ts` pattern)

One shared matchup-strength calc per today's game, then two outputs:

```
adj_strength(team) = rolling_net_rating(last_10-15g)
                   - weighted_absent_usage   (sum of usg% of out players)
                   + home_bump               (+2.5 if home)
                   + rest_adjustment         (penalty on back-to-backs)

win_prob(A)     = sigmoid(strength_A − strength_B)
expected_margin = (strength_A − strength_B) × margin_coef  (calibrate from historical margins)
expected_total  = (pace_A + pace_B)/2 × (off_A + off_B)/100   (separate, pace-driven)
```

Inputs used and rationale:

| Input                      | ML / Spread |       Total       | Source                                                    |
| -------------------------- | :---------: | :---------------: | --------------------------------------------------------- |
| Rolling net rating         |   ✅ core   |     ➖ minor      | `team_game_stats`                                         |
| Pace                       |  ➖ minor   |      ✅ core      | `team_game_stats`                                         |
| Home / away                |     ✅      |        ✅         | `games`                                                   |
| Rest / B2B                 |     ✅      |     ➖ minor      | derive from `games.game_date` history                     |
| Injuries (absent usage)    |     ✅      | ✅ if scorers out | `player_availability` + `daily_conditions.rolling_usg_5g` |
| Head-to-head this season   | ❌ modeled  |    ❌ modeled     | **Show as card context only — too noisy to model**        |
| "Similar teams" clustering |   ❌ skip   |      ❌ skip      | Real technique, outside free-tier scope                   |

**Card labeling (important for truthfulness):**
Cards must say "Model's most confident pick", "Model's widest spread", "Model's highest total" — NOT "Best ML bet". These are informational until Kalshi game lines get piped into `daily_lines` with `prop_type='game'`, at which point cards upgrade to `model_prob vs market_prob` edge ranking.

### Spec tier

Repeatedly confirmed with user: this is **"free-tier, simple compute, same level as trend scoring"** — closed-form math, no ML libraries. Spread + total need NO historical line pipeline (skipped entirely). ML/Spread/Total use only existing tables.

---

## B — OPEN QUESTIONS (where we stopped)

The user's latest message answered the ML-compute question and said "use what will serve best" — I gave a direct recommendation. Two confirmations still needed before I can write B's spec:

### Q1 — Approve the ML/Spread/Total ranking logic?

- ML of the Day = game with highest model win probability (either side)
- Spread of the Day = game with largest absolute expected margin
- Total of the Day = game with most extreme expected total vs league baseline

User Answer:

id prefer ML, spread, and total to be computed respective to how their stat should be computed, but also by game conditions

note: spread and ML might be same but could be different if the price on kalshi doesnt align with the current measures in place but feel free to find another way around that

Note: ML and Spread are mathematically linked (often same game). Total uses different inputs and usually lands on a different game.

### Q2 — What goes in the right card (length 10)?

- **(i) TopTrending** — existing top-10 players by z-score (no new work; simply kept)
- **(ii) Slate Overview** — 10 today's games with quick model win %, spread, total (matchup cheat sheet powered by the game-props compute)
- **(iii) Something else** user has in mind

User Answer:

overall page flow for dedicated league pages should go,

## top picks 5 player 5 game, listed side by side as its own card, below that top 10 streaks and hit rates, with a tab to toggle between the two, then below the card, the trend finder w auto top 10 trending

## How to resume

1. **User answers Q1 and Q2 above.**
2. Write `docs/superpowers/specs/2026-04-22-picks-streaks-backend-design.md` containing:
   - Schema additions (none expected — all existing tables suffice; only a new compute job output)
   - New analytics job `analytics/picks/compute_game_picks.py` OR `server/src/jobs/computeGamePicks.ts` (match existing pattern — nightly job that writes to `pick_results` with `prop_type='game'` OR to a new lightweight table)
   - New/updated API endpoints:
     - `GET /api/nba/streaks/perfect?stat=<p|r|a|3pm>&window=<3|5|10>` → top 10 list
     - `GET /api/nba/picks/game-of-the-day` → ML/Spread/Total featured cards
     - Possibly widen `/api/nba/picks/today` to include game picks if going the `pick_results.prop_type='game'` route
   - Client API types in `client/src/services/api.ts`
   - Shape of envelope for SportQuery result enrichment (from the backlog doc)
   - Rollout order and test plan
3. **Self-review spec** — placeholder scan, contradictions, ambiguity, scope
4. **User review gate** — wait for approval before moving to writing-plans
5. **Invoke writing-plans skill** with the approved B spec as input
6. **After B ships:** brainstorm C using `docs/superpowers/specs/2026-04-22-shadcn-migration-inventory.md` as input
7. **After C ships:** brainstorm D (PlayerDetailView dashboard)

## Key files touched so far this session

- `package.json` (root) — scripts now delegate to client via `--prefix`
- `server/package.json` — nodemon watches `.env`
- `server/src/server.ts` — removed redundant `dotenv.config()`
- `server/src/config/groq.ts` + `server/dist/config/groq.js` — model ID fix
- `server/src/prompts/sportquery-system.ts` — SCHEMA block rewritten against real DB
- `server/src/prompts/sportquery-examples.ts` — 4 examples patched
- `server/.env` — new pooler URL with `sportquery_app` role
- `client/tsconfig.json` — removed conflicting `"module": "CommonJS"` from composite tsconfig

## Artifacts produced

- `docs/superpowers/specs/2026-04-22-shadcn-migration-inventory.md` — full component tree, per-file primitive mapping, migration order for sub-project C
- `docs/superpowers/backlog/2026-04-22-sportquery-result-enrichment.md` — shape-aware envelope design for B's spec
- `docs/superpowers/specs/2026-04-22-session-resume.md` — this file

## Brainstorming skill task state (for auditability)

Created via TaskCreate and partially completed:

| #   | Subject                                | Status                                                  |
| --- | -------------------------------------- | ------------------------------------------------------- |
| 1   | Explore project context                | ✅ completed                                            |
| 2   | Decompose scope with user              | ✅ completed (user picked option 1: A→B→C→D sequential) |
| 3   | Offer visual companion                 | ✅ completed (skipped; terminal sufficient)             |
| 4   | Ask clarifying questions one at a time | 🟡 in_progress (Q1 + Q2 outstanding)                    |
| 5   | Propose approaches with tradeoffs      | ⏳ implicitly rolling; presented inline                 |
| 6   | Present design sections                | ⏳ pending formal consolidation                         |
| 7   | Write and commit spec doc(s)           | ⏳ pending                                              |
| 8   | Self-review spec                       | ⏳ pending                                              |
| 9   | User spec review gate                  | ⏳ pending                                              |
| 10  | Invoke writing-plans skill             | ⏳ pending (terminal)                                   |
