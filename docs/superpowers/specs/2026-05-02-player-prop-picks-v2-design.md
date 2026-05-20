# NBA Player Prop Picks Pipeline v2 — Design Spec

**Date:** 2026-05-02
**Scope:** Refactor the existing NBA player prop picks pipeline (`analytics/`) to use direct opportunity signals, recency-weighted hit rates, a stricter loosening order, optional teammate-injury matching, and a bounded modifier system. Streaks pipeline is untouched except for display-only enrichment.

---

## 1. Goal

Identify tonight's NBA player prop bets where historical games matched on tonight's actual conditions show a hit rate that meaningfully beats Kalshi's implied probability. Output two picks per (player, stat) when the data supports them: the **safe** pick (highest hit rate line) and the **value** pick (highest edge line, if distinct from safe).

---

## 2. What stays the same

- Existing tables: `games`, `players`, `teams`, `nba_player_stats`, `team_game_stats`, `opponent_position_defense`, `player_availability`, `daily_lines`, `pick_results`.
- Kalshi client (`analytics/kalshi/client.py`).
- nba_api retry/backoff helper (`api_call_with_retry()` in `analytics/data/enrich_games.py`).
- Pipeline entry points: `python -m analytics.batch.nightly`, `python -m analytics.picks.generate`.
- Streaks selection logic in `picksController.ts` — only the response is enriched with new context fields.
- Hard-gate constants: `MIN_SAMPLE_SIZE`, `MIN_HIT_RATE`, `MIN_EDGE`, `MAX_IMPLIED_PROB` (values preserved unless tuned later).
- Pick output schema fields except for the additions in §4.

---

## 3. What changes

| Module | Change type | Summary |
|---|---|---|
| Supabase schema | Add columns | `player_game_conditions`, `daily_conditions`, `pick_results` |
| `data/enrich_games.py` | Extend | Wire `BoxScorePlayerTrackV3`, extract touches/TOP/etc; add `--backfill-track` mode with speed-tuned retry constants |
| `batch/nightly.py` | Extend | Compute `rolling_touches_5g`, `rolling_top_5g`, `key_teammates_out`, `positional_sub_for`, `recent_opp_<stat>_form` into `daily_conditions` |
| `screener/screen.py` | Refactor | Replace `MIN_ROLLING_USG`-style gating with touches/TOP-based gating |
| `engine/backtest.py` | Refactor in place | New 5+1 condition set, weighted hit rate, new loosening order |
| `engine/scorer.py` | Refactor in place | Remove B2B hit-rate adjustment, remove all first-half handling, add modifier system with cap (B2B becomes a modifier) |
| `picks/generate.py` | Extend | Filter first-half props at Kalshi parse, store modifiers JSONB, two-pick output (safe + value if distinct) |
| `kalshi/client.py` | Extend | Mark first-half markets and skip them at parse time |
| `picksController.ts` | Extend | Streaks endpoint surfaces new context fields when available (display only) |

---

## 4. Schema changes

```sql
-- analytics/db/migrate.py: add to player_game_conditions
ALTER TABLE player_game_conditions
  ADD COLUMN touches FLOAT,
  ADD COLUMN front_court_touches FLOAT,
  ADD COLUMN time_of_possession FLOAT,        -- minutes
  ADD COLUMN paint_touches FLOAT,
  ADD COLUMN avg_speed FLOAT;

-- daily_conditions
ALTER TABLE daily_conditions
  ADD COLUMN rolling_touches_5g FLOAT,
  ADD COLUMN rolling_top_5g FLOAT,
  ADD COLUMN season_avg_touches FLOAT,
  ADD COLUMN season_avg_top FLOAT,
  ADD COLUMN key_teammates_out INT[] DEFAULT '{}',
  ADD COLUMN positional_sub_for INT,           -- player_id this candidate is subbing for; NULL when not applicable
  ADD COLUMN recent_opp_pts_form FLOAT,        -- (opp_last7_pts_allowed / opp_season_pts_allowed) - 1
  ADD COLUMN recent_opp_reb_form FLOAT,
  ADD COLUMN recent_opp_ast_form FLOAT,
  ADD COLUMN recent_opp_fg3m_form FLOAT;

-- pick_results
ALTER TABLE pick_results
  ADD COLUMN modifiers JSONB DEFAULT '{}'::JSONB;  -- { recent_opp_form: +0.04, b2b: -3.0, ... }
```

Migration applied via Supabase MCP. The `migrate.py` script's documented schema is updated to match.

---

## 5. Backfill plan (background subagent)

**Scope:** `BoxScorePlayerTrackV3` for every completed regular-season + playoff game in seasons 2023-24, 2024-25, 2025-26. Approximately 3,700 games.

**Speed-tuned retry — added to `enrich_games.py`:**

```python
# TODO: tune against observed nba_api behavior. Lower if API tolerates faster cadence;
# raise if 429s become frequent.
FAST_RETRY_SECONDS = 5            # first-failure quick retry — most transient errors clear in <5s
DOUBLE_FAIL_TRIGGERS_COOLDOWN = True  # if 5s retry also fails, escalate to full _trigger_cooldown()
BACKFILL_API_DELAY_SECONDS = 0.0  # in --backfill-track mode, skip the inter-call delay; rely on fail signal
```

**Behavior in `--backfill-track` mode:**
1. Fire calls back-to-back (no `API_DELAY_SECONDS` floor).
2. On any failure (timeout / connection error / non-rate-limit error): wait `FAST_RETRY_SECONDS`, retry once.
3. If that retry also fails: invoke `_trigger_cooldown()` (existing 120–180s jittered cooldown + 30-call slow mode).
4. 429s still go through the existing `MAX_RATE_LIMIT_RETRIES` doubling-backoff (unchanged).
5. Hard timeout via `ThreadPoolExecutor` preserved (`HARD_TIMEOUT_SECONDS = 45`).

**Orchestration:** the backfill subagent is launched in the background immediately after Phase 1 (schema migration applied). Picks generation in subsequent days operates on whatever has been backfilled — `MIN_SAMPLE_SIZE = 8` naturally suppresses picks with insufficient history.

---

## 6. Conditions (5 core + 1 optional)

### 6.1 Core conditions

| # | Condition | Match rule | Droppable? |
|---|---|---|---|
| 1 | **Opportunity** | Historical game's `touches` within `±OPPORTUNITY_TOUCH_BUCKET` AND `time_of_possession` within `±OPPORTUNITY_TOP_BUCKET` of the candidate's `rolling_touches_5g` / `rolling_top_5g`. | **No** |
| 2 | **Pace** | Historical game's `pace` within `±PACE_BUCKET_WIDTH` (existing 5.0) | **No** |
| 3 | **Rest** | Historical game's `_rest_category(days_rest)` matches today's category. Buckets: `b2b` (0d), `short` (1d), `normal` (2-3d), `extended` (4+d). | **No** |
| 4 | **Matchup rank** | Historical opponent's stat-specific position rank within `±MATCHUP_RANK_WINDOW` (12) of today's opponent rank. *Stat-specific*: `pts → opp_def_rank_position`, `reb → opp_reb_rank_position`, `ast → opp_ast_rank_position`, `fg3m → opp_fg3m_rank_position`. | Yes (drop 2nd) |
| 5 | **Home/Away** | Exact match on `home_away`. | Yes (drop 1st) |

### 6.2 Optional condition (non-droppable when active)

| # | Condition | Activation | Match rule |
|---|---|---|---|
| 6 | **Key teammate out** | Activates if EITHER scenario is true tonight: **(a)** the candidate is the *positional sub* for any out starter, OR **(b)** any top-3-by-season-avg-usage teammate is out. | Historical game's `out_teammate_ids` set must intersect tonight's `key_teammates_out` set (exact player ID match — at least one of the same out-teammates was also out historically). Activates only if ≥`MIN_TEAMMATE_HISTORICAL_SAMPLES` (3) such historical games exist. |

**Positional sub definition:** Same `position_group` (G / F / C) as the out starter, next-highest `season_avg_minutes` on the team who is not also out.

**Top-3-usage definition:** Sorted by `players.season_avg_usg` (already used in screener); ties broken by minutes.

If activation fires but historical sample with the exact-player intersection rule is < 3, the condition does **not** activate for this backtest run (we don't want to fire a non-droppable condition on too-thin a sample). The candidate proceeds with the 5 core conditions only, and the lineup state is logged in metadata for transparency.

### 6.3 Loosening order

```
home_away  →  matchup_rank
```

Maximum 2 drops. End at 3 active core conditions. Optional condition stays active when active. `total_conditions` reported = 5 + (1 if optional active else 0).

---

## 7. Hit rate (recency-weighted)

```python
# TODO: recalibrate against observed sample sizes after backfill completes.
# Higher DECAY (closer to 1.0) flattens the curve toward equal-weighting.
# Lower DECAY weights very recent games more aggressively.
HIT_RATE_DECAY = 0.95
```

Within the matched-condition history (sorted chronologically, most recent first):

```
games_ago_i = i  (i=0 for most recent)
weight_i    = HIT_RATE_DECAY ** games_ago_i
hit_rate    = sum(weight_i * hit_i) / sum(weight_i)
sample_size = len(matches)             # raw count, used for sample_weight gating
```

The `hit_i` term is `1` if historical actual exceeded the line, else `0`. No separate decay window — the matched history is the window.

---

## 8. Scorer

### 8.1 Hard gates (preserved)

```
MIN_SAMPLE_SIZE      = 8
MIN_HIT_RATE         = 0.60
MIN_EDGE             = 0.08
MAX_IMPLIED_PROB     = 0.88
```

A pick failing any gate is discarded (returns `{confidence: 0, edge: …, reason: <gate>}`).

### 8.2 Removed

- **`B2B_PENALTY_FACTOR`** — old 0.93x multiplier on hit_rate. Deleted. The B2B signal is now a modifier (§8.4).
- **`FIRST_HALF_CONFIDENCE_CAP`** — deleted entirely. The `is_first_half` parameter is removed from `score()`. First-half props are filtered before reaching the scorer (§10).

### 8.3 Base confidence

```
base = hit_rate * 100
sample_weight   = min(1.0, sample_size / SAMPLE_WEIGHT_TARGET)
condition_bonus = (conditions_matched / total_conditions) * CONDITION_BONUS_MAX
edge_bonus      = min(edge * EDGE_BONUS_SCALE, EDGE_BONUS_CAP)
ip_penalty      = max(0, implied_prob - IMPLIED_PROB_PENALTY_THRESHOLD)
                  * IMPLIED_PROB_PENALTY_SCALE

base_confidence = (base * sample_weight) + condition_bonus + edge_bonus - ip_penalty
```

Constants preserved:
- `SAMPLE_WEIGHT_TARGET = 25`
- `CONDITION_BONUS_MAX = 8`
- `EDGE_BONUS_SCALE = 150`
- `EDGE_BONUS_CAP = 10`
- `IMPLIED_PROB_PENALTY_THRESHOLD = 0.65`
- `IMPLIED_PROB_PENALTY_SCALE = 30`

### 8.4 Modifiers (applied after base_confidence, capped)

Modifiers tilt; they don't drive. Each modifier produces a signed contribution. Total modifier impact is clamped before being added to `base_confidence`.

```python
# Scorer-side modifier constants (analytics/engine/scorer.py)

# Recent opponent defensive form (the form value itself is precomputed in nightly.py;
# scorer just applies the scale + cap)
# TODO: tune scale + cap against observed correlation between recent_opp_form
# and actual hit-rate divergence vs season-average-form picks.
FORM_MODIFIER_SCALE      = 30       # 10% form delta → 3.0 confidence pts
FORM_MODIFIER_CAP        = 5        # cap on this single modifier's contribution

# Back-to-back rest penalty (kept as a modifier to avoid double-counting rest as a condition)
# TODO: tune against observed B2B vs non-B2B hit-rate divergence in the backtest data.
B2B_MODIFIER_VALUE       = -3.0     # flat penalty when days_rest == 0

# Total modifier cap
MAX_MODIFIER_IMPACT      = 7        # |sum(modifiers)| cannot exceed this
```

In `analytics/batch/nightly.py`:
```python
# TODO: window N=7 chosen as "recent enough to capture trend, not so short as to be noisy".
# Recalibrate after collecting recent_opp_form data for a full season.
RECENT_OPP_FORM_WINDOW = 7
```

**Form modifier:**
```
form = recent_opp_<stat>_form          # signed, e.g. +0.10 means opp has been worse vs this stat recently
form_mod = clamp(form * FORM_MODIFIER_SCALE, -FORM_MODIFIER_CAP, +FORM_MODIFIER_CAP)
```

**B2B modifier:**
```
b2b_mod = B2B_MODIFIER_VALUE if days_rest == 0 else 0
```

**Game stakes modifier:** Stubbed and disabled (constant flag `GAME_STAKES_MODIFIER_ENABLED = False`). Code path present but no-op until standings data is wired in a follow-up.

**Application:**
```
modifier_total = clamp(sum(active modifiers), -MAX_MODIFIER_IMPACT, +MAX_MODIFIER_IMPACT)
final_confidence = clamp(base_confidence + modifier_total, 0, 100)
```

The scorer returns:
```python
{
    "confidence": final_confidence,
    "edge": edge,
    "hit_rate_adjusted": hit_rate,        # unchanged from input
    "modifiers": {
        "recent_opp_form": form_mod,
        "b2b": b2b_mod,
        # game_stakes: omitted while disabled
    },
}
```

---

## 9. Output

For each (player_id, stat) where the screener produced a candidate and at least one Kalshi line is available:

1. Backtest every Kalshi line for that (player, stat) pair.
2. Score each result.
3. From the set of lines that pass all gates:
   - **`safe`** = the line with the highest `hit_rate_adjusted`
   - **`value`** = the line with the highest `edge`, *if it is a different line than safe*
4. If no lines pass gates → no picks output for this (player, stat).

Each pick row inserted into `pick_results`:

```
game_date, prop_type='player', entity_id=player_id, stat,
pick_type ∈ {'safe', 'value'},
recommended_line, hit_rate, sample_size, conditions_matched, total_conditions,
key_conditions JSONB,           -- which of the 5+1 were active vs dropped
modifiers JSONB,                -- per §8.4
confidence_score, implied_prob, edge,
alt_lines_tested JSONB          -- existing field; preserved
```

`key_conditions` JSONB shape:
```json
{
  "opportunity":   "active",
  "pace":          "active",
  "rest":          "active",
  "matchup_rank":  "active" | "dropped",
  "home_away":     "active" | "dropped",
  "key_teammate_out": "active" | "inactive"   // omitted entirely if no teammates out tonight
}
```

---

## 10. First-half props: deleted from the pipeline

- `kalshi/client.py` — `parse_player_props()` flags first-half markets via existing ticker patterns and **excludes them from the returned list**. No longer surfaced to the picks pipeline at all.
- `engine/scorer.py` — `is_first_half` parameter removed. `FIRST_HALF_CONFIDENCE_CAP` constant deleted.
- `engine/backtest.py` — no first-half pathways exist (already full-game).
- `picks/generate.py` — no first-half handling.

---

## 11. Streaks display alignment

`getPerfectStreaks` in `server/src/controllers/picksController.ts`: the response shape extends with optional context fields per row, sourced from `daily_conditions` for tonight's slate:

```ts
interface PlayerStreakRow {
  // ... existing fields ...

  // NEW (display-only; nullable when data not yet present)
  recent_opp_form: number | null            // stat-specific opp recent-form delta
  key_teammates_out: number[] | null        // player_ids of out teammates relevant tonight
  opportunity_trend: number | null          // (rolling_touches_5g - season_avg_touches) / season_avg_touches
}
```

Selection logic (which streaks make the list) **unchanged**. The frontend may use these fields to badge a row with "good matchup", "lineup boost", or "opportunity ↑".

---

## 12. Constants reference (single source per file)

Every constant below is declared at the top of its file with a TODO comment explaining what it controls and what data would justify changing it.

### `analytics/data/enrich_games.py` (additions)
```
FAST_RETRY_SECONDS = 5
DOUBLE_FAIL_TRIGGERS_COOLDOWN = True
BACKFILL_API_DELAY_SECONDS = 0.0
```

### `analytics/screener/screen.py` (replacements)
```
MIN_ROLLING_TOUCHES = 25.0       # replaces MIN_ROLLING_USG-style gating
MIN_ROLLING_TOP     = 1.5        # minutes; ~equivalent gate to "real ball-handler"
# Stat-min gates (MIN_ROLLING_PTS / REB / AST / FG3M) preserved.
# MIN_ROLLING_MINUTES preserved.
```

### `analytics/engine/backtest.py` (additions)
```
OPPORTUNITY_TOUCH_BUCKET = 8.0       # ±touches around rolling avg
OPPORTUNITY_TOP_BUCKET   = 0.5       # ±minutes of TOP around rolling avg
HIT_RATE_DECAY           = 0.95
MIN_TEAMMATE_HISTORICAL_SAMPLES = 3  # min historical games matching exact-teammate-out filter to activate the optional condition
CONDITION_DROP_ORDER     = ["home_away", "matchup_rank"]   # only droppable conditions
MIN_CONDITIONS_ACTIVE    = 3
```

PACE_BUCKET_WIDTH, MATCHUP_RANK_WINDOW, MAX_DAYS_REST, MIN_SAMPLE_SIZE preserved.
USG_BUCKET_WIDTH, OFF_RATING_BUCKET_WIDTH, DEF_RATING_BUCKET_WIDTH, COMBINED_PACE_BUCKET_WIDTH unchanged (game-prop backtest still uses them).

### `analytics/engine/scorer.py` (additions / removals)
```
# Removed:
#   B2B_PENALTY_STATS, B2B_PENALTY_FACTOR
#   FIRST_HALF_CONFIDENCE_CAP

# Added:
B2B_MODIFIER_VALUE          = -3.0
FORM_MODIFIER_SCALE         = 30
FORM_MODIFIER_CAP           = 5
MAX_MODIFIER_IMPACT         = 7
GAME_STAKES_MODIFIER_ENABLED = False    # stub
```

Hard gates and base-confidence constants unchanged.

---

## 13. Implementation phases

```
Phase 1 (foreground):  Apply schema migration via Supabase MCP. Update migrate.py docs.
Phase 1.5 (background): Kick off backfill subagent
                       (BoxScorePlayerTrackV3, seasons 2023-24/2024-25/2025-26)
Phase 2 (foreground):  Wire BoxScorePlayerTrackV3 in enrich_games.py for go-forward
Phase 3 (foreground):  Update nightly.py:
                         - rolling_touches_5g, rolling_top_5g, season_avg_touches/top
                         - key_teammates_out, positional_sub_for
                         - recent_opp_<stat>_form (stat-specific, last 7 games)
Phase 4 (foreground):  Refactor screener/screen.py to use touches/TOP gates
Phase 5 (foreground):  Refactor engine/backtest.py:
                         - new 5+1 conditions
                         - recency-weighted hit rate
                         - new loosening order
Phase 6 (foreground):  Refactor engine/scorer.py:
                         - remove B2B hit-rate adjustment + first-half cap
                         - add modifier system (B2B + recent_opp_form, capped)
Phase 7 (foreground):  Update picks/generate.py:
                         - filter first-half via Kalshi parse
                         - safe/value selection
                         - modifiers JSONB write
Phase 8 (foreground):  Update kalshi/client.py:
                         - flag and drop first-half markets at parse
Phase 9 (foreground):  Update picksController.ts streaks endpoint:
                         - surface new context fields when available
Phase 10 (foreground): Sanity-check on tonight's slate; verify pick output and modifier values
                       Backfill agent may still be running — that's OK, sample sizes climb daily
```

---

## 14. Testing

- `engine/scorer.py` self-test (existing pattern) extended with cases for:
  - B2B modifier applied vs not
  - Recent-form modifier positive / negative / zero
  - Modifier total clamping at `MAX_MODIFIER_IMPACT`
  - First-half input no longer accepted (parameter removed from signature)
- Backtest: small-sample teammate-out condition correctly fails to activate (< MIN_TEAMMATE_HISTORICAL_SAMPLES).
- Backtest: weighted hit rate computed correctly for known toy inputs (assert decay applied).
- End-to-end: run `python -m analytics.picks.generate --date <today> --mock` against a small synthetic dataset, confirm pick output schema matches §9 and `modifiers` JSONB is populated.

---

## 15. Out of scope

- Game-stakes modifier (deferred — stubbed only, requires standings ingestion).
- ML / learned scoring weights — pipeline remains closed-form.
- Game-prop pipeline (`backtest_game_prop`) — unchanged unless a downstream task touches it.
- Streaks selection logic — only display fields are added.
- Frontend rendering of new modifier breakdown — separate UI task.

---

## 16. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Backfill takes longer than estimated | Picks degrade gracefully — `MIN_SAMPLE_SIZE` gate suppresses thin-data picks; pipeline runs at lower volume until backfill completes. |
| `BoxScorePlayerTrackV3` fields change name across `nba_api` versions | Single accessor function in `enrich_games.py` with field-name fallback list; logged WARNINGs on missing fields. |
| Optional teammate condition produces too-thin samples even at the 3-game floor | `MIN_TEAMMATE_HISTORICAL_SAMPLES` is a single named constant — easily raised to 5+ after observation. |
| Modifier cap silently muting strong signals | Modifier breakdown stored verbatim in `pick_results.modifiers` JSONB so post-hoc analysis can quantify how often the cap binds. |
| Removing first-half props breaks anything downstream | `picksController.ts` and frontend never displayed 1H props as a primary card; the change is invisible to users. |
