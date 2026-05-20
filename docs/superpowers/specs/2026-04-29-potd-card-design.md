# POTD Card — Design Spec
**Date:** 2026-04-29

## Problem

The NBA page top bar shows 4 pick cards (Player / Spread / Total / ML). This is cluttered and gives no explanation of *why* the model recommends each pick. Users can't evaluate quality without drilling into raw numbers.

## Solution

Replace the 4-pick row with a single **Pick of the Day** card — the highest-confidence pick across all prop types for the day — that explains the recommendation in plain language using server-derived narrative bullets.

---

## Architecture

### New endpoint: `GET /api/picks/potd`

A dedicated controller (`potdController.ts`) separate from `getTopPicks`. Returns one pick with full context.

**Logic:**
1. Find nearest pick date (same `findNearestPickDate` helper as picksController)
2. Fetch all `pick_results` for that date, order by `confidence_score DESC`, take #1
3. If player prop: join `daily_conditions` for the player on that date (rolling avg, usage, pace, days_rest, home_away, opp_def_rank_position, position_group)
4. Join `players` for name/team/position; join `games`+`teams` for opponent
5. Parse `key_conditions` JSON (stored in pick_results) to get condition breakdown
6. Compose 3 narrative bullet strings server-side (see Bullet Logic below)
7. Return pick + bullets + condition breakdown

**Response shape:**
```ts
{
  game_date: string
  prop_type: 'player' | 'winner' | 'spread' | 'total'
  player_id?: number
  player_name?: string
  team?: string
  position?: string
  opponent?: { team: string; team_name: string } | null
  stat?: string
  stat_label?: string
  line: number
  direction: 'over' | 'under'
  hit_rate: number
  confidence: number
  edge: number
  implied_prob: number
  sample_size: number
  conditions_matched: number
  total_conditions: number
  condition_breakdown: {
    usg_pct: 'active' | 'dropped'
    pace: 'active' | 'dropped'
    home_away: 'active' | 'dropped'
    matchup_rank: 'active' | 'dropped'
    rest: 'active' | 'dropped'
  }
  bullets: [string, string, string]
}
```

---

## Bullet Logic (server-side, no LLM)

All bullets are template strings composed from data fields. Always positive framing — never mention what was dropped.

### Bullet 1 — Edge (always the same structure)
> "Hit OVER {line} {stat_label} in **{hit_pct}%** of *{n} comparable games* — market prices it at *{mkt_pct}%*, a **+{edge_pct}% edge**."

### Bullet 2 — Recent form (always includes rolling avg; appends usage+pace when both active)
- If usg + pace both active:
  > "Averaging **{rolling_avg} {stat_label}** over his last 5 games at *{usg}% usage* and *{pace} pace*."
- Otherwise:
  > "Averaging **{rolling_avg} {stat_label}** over his last 5 games."

### Bullet 3 — Context (built from active conditions only)

Collect the active conditions from `{home_away, matchup_rank, rest}` and compose:

| Active conditions | Bullet text |
|---|---|
| rest + home_away + matchup | "Rested *({days} days)*, {home/away} court, facing {opp} ranked **#{rank} vs {pos_group}s**." |
| rest + matchup (no home) | "Rested *({days} days)*, facing {opp} ranked **#{rank} vs {pos_group}s**." |
| rest + home_away (no matchup) | "Rested *({days} days)*, {home/away} court vs {opp}." |
| matchup only | "Facing {opp} ranked **#{rank} vs {pos_group}s**." |
| home_away only | "{Home/Away} court vs {opp}." |
| rest only | "Rested *({days} days)* heading into tonight." |
| none (usg+pace only, 3/5) | "At **{usg}% usage** and **{pace} pace**, hit this line **{hits} of {n}** times." |

---

## Frontend

### New component: `client/src/components/NBA/PotdCard.tsx`

Replaces `<PicksRow />` in `NBA.tsx`. Full-width card using existing site tokens.

**Layout:**
```
┌─────────────────────────────────────────┬───────────────┐
│  🟠 PICK OF THE DAY · Apr 29            │               │
│                                         │      92       │
│  LeBron James                           │  Confidence   │
│  LAL · Power Forward · vs SAC           │               │
│  [↑ OVER 5.5 REB]                       │  ● Usage      │
│                                         │  ● Pace       │
│  — Hit OVER 5.5 REB in 95% of 21...    │  ● Home/Away  │
│  — Averaging 7.2 REB over last 5...    │  ● Matchup    │
│  — Rested (2 days), home court...      │  ○ Rest       │
│                                         │               │
│  MKT 74% ══════════ HIT 95% +21%       │               │
└─────────────────────────────────────────┴───────────────┘
```

**Design tokens used:**
- Card: `bg-gradient(135deg, #1a0e08, #0a0a0a, #0a0a14)` / `border border-mint/20`
- Radial glow: `radial-gradient` at 92% 50% in `mint/9`
- Label: `text-[10px] font-bold text-mint uppercase tracking-[0.18em] font-condensed`
- Player name: `text-[28px] font-black font-condensed`
- Line badge: `border border-mint/30 rounded text-mint font-black text-[11px]`
- Bullets: `text-[11.5px] text-gray-600` with `text-mint font-bold` accents, `text-gray-500` for em
- Confidence: `font-display text-[80px] font-black text-mint` (Doto)
- Condition list: vertical, `text-[9px] font-bold uppercase tracking-[0.1em]`; active=`text-mint`, dropped=`text-[#282828]`
- Clickable for player picks → `navigate(/player/{id})`

### API service update
Add `nbaApi.getPotd()` to `client/src/services/api.ts`.

---

## Files Changed

| File | Change |
|---|---|
| `server/src/controllers/potdController.ts` | **New** — endpoint logic + bullet composer |
| `server/src/routes/picks.ts` or `server.ts` | Register `GET /api/picks/potd` |
| `client/src/services/api.ts` | Add `getPotd()` |
| `client/src/components/NBA/PotdCard.tsx` | **New** — card component |
| `client/src/pages/NBA/NBA.tsx` | Replace `<PicksRow />` with `<PotdCard />` |

`PicksRow.tsx` is not deleted — it may still be used or referenced elsewhere.

---

## Edge Cases

- **No picks for today:** Show skeleton/placeholder with "Analyzing today's slate..." message (same pattern as existing PickOfTheDay on Home)
- **Game prop as POTD:** Bullets adapt — bullet 1 same structure; bullet 2 uses game total/spread context; bullet 3 uses team records or pace context. Condition pills show game-prop conditions (combined_pace, off/def ratings).
- **Missing daily_conditions:** If no row found for player, omit rolling avg from bullet 2; omit usage/pace values.
- **`rolling_{stat}_5g` is null:** Fall back to omitting that part of bullet 2 gracefully.
