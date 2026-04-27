# UI Fixes & Data Pipeline Corrections — 2026-04-27

## Overview

Seven targeted fixes across the frontend and analytics pipeline. No new features; each item corrects existing behaviour to match intent.

---

## 1. POTD Game Date Display

**Problem:** `PickOfTheDay` calls `getTodaysPicks` which returns `gameDate` in its payload, but the `TodaysPicks` TS type doesn't expose it and the component never renders it. Users can't tell which slate the pick is for.

**Fix:**
- Add `gameDate: string` to the `TodaysPicks` interface in `client/src/services/api.ts`.
- In `PickOfTheDay.tsx`, render the date as a small formatted string (e.g. `"Apr 27"`) inline next to the "Pick of the Day" flame label — same row, right-aligned or after a `·` separator.

---

## 2. TrendFinder: Top-10 Trending Default + Clear Filter

**Problem:** TrendFinder always fires a filtered trends query on mount (even with no threshold), returning noisy low-z results. The standalone `TopTrending` row below it on the NBA page duplicates the concept.

**Fix:**

Two modes based on whether `threshold` has a value:

| Mode | Trigger | Data source | Cap |
|------|---------|-------------|-----|
| Trending (default) | No threshold entered | `nbaApi.getTopTrending()` | 10 |
| Filtered | Threshold > 0 entered | `nbaApi.getTrends({ stat, window, threshold })` | 10 |

- In filtered mode, a `✕ Clear` button appears to the right of the Line input. Clicking it clears the threshold and returns to trending mode.
- Changing the stat tab or window in filtered mode re-runs the filtered query (does NOT reset to trending).
- Remove the standalone `TopTrending` row from `NBA.tsx` (rows 34-45) — it is now redundant with TrendFinder's default state.

---

## 3. Search UI — Remove Nested Border

**Problem:** `Header.tsx` wraps `<Search icon> + <Input>` in a `div` with `border border-[#1E1E1E] rounded-xl`, while the shadcn `<Input>` component also renders its own border/ring, producing a double-border.

**Fix:** Add `border-0 bg-transparent focus-visible:ring-0 shadow-none p-0` to the `<Input>` className override inside the search wrapper so the Input itself is borderless. The outer wrapper retains its `border border-[#1E1E1E] rounded-xl` and `focus-within:border-mint/30` behaviour.

---

## 4. PlayerDetailView Chart — Order + Date Label

**Problem:** `chartGames` is sliced from `profile.games` which comes from the API ordered most-recent-first. Bars render left-to-right with index 0 leftmost, so the most recent game is on the left. Game labels show only opponent abbreviation.

**Fix:**
- Reverse `chartGames` before rendering so the oldest game is leftmost and the most recent is rightmost: `[...chartGames].reverse()`.
- In the game labels section, add a second line below the opponent showing the game date in `MMM D` format (e.g. `"Apr 20"`). Requires `game.date` to be present in the `GameStat` type — verify the API returns it; if not, add it to the `getPlayerProfile` endpoint select.
- **Preserve bar colors** as changed by user: over = `bg-green-500/80 group-hover:bg-green-500/100`, under = `bg-red-500/80 group-hover:bg-red-500/100`.
- Update legend dots to match: `bg-green-500/80` (over), `bg-red-500/80` (under).

---

## 5. Game Picks (Spread / ML / Total) — Mock Bug Fix

**Problem:** `_mock_nba_markets` in `analytics/kalshi/client.py` generates game markets with `ticker: "NBA-MOCK-0025"`. `parse_game_props` filters by `self._series_prefix(ticker) not in game_series_set` — prefix `"NBA"` is not in `GAME_PROP_SERIES`, so **all mock game markets are silently dropped**. Running `--mock` mode never exercises the game picks pipeline.

**Fix:**
- Change mock game market tickers to use `"KXNBAGAME-"` prefix (e.g. `"KXNBAGAME-27APR26LALGSW-001"`) so they pass the series filter.
- Ensure mock `event_ticker` values match the pattern used by `event_key_to_game_id` lookup (team abbreviations embedded in the key).
- Add a `print` statement after `parse_game_props` call in `generate.py` to log how many game prop combos were parsed (already exists for player props).

**Note on live Kalshi:** If live Kalshi returns zero markets from `GAME_PROP_SERIES` tickers, game pick cards will remain empty. The mock fix ensures the code path is exercisable offline. Verifying live game markets requires running `python -m analytics.kalshi.client --live`.

---

## 6. Streaks — Nearest-Date Fallback

**Problem:** `getPerfectStreaks` in `picksController.ts` hardcodes `today` for the `daily_lines` query. If the pipeline hasn't run yet today, `daily_lines` has no rows for today → zero candidates → empty streaks.

**Fix:** Add a `findNearestLinesDate` helper (mirrors `findNearestPickDate`) that queries `daily_lines` for `game_date >= today` ordered ascending, limit 1. Use that date for the `daily_lines` candidate query instead of `today`. The ESPN slate still anchors to today's actual games — only the lines lookup falls back to the nearest available date.

---

## Files Changed

| File | Change |
|------|--------|
| `client/src/services/api.ts` | Add `gameDate: string` to `TodaysPicks`; add `date` to `GameStat` if missing |
| `client/src/components/Home/PickOfTheDay.tsx` | Render `gameDate` on card |
| `client/src/components/TrendFinder/TrendFinder.tsx` | Two-mode logic + Clear button |
| `client/src/pages/NBA/NBA.tsx` | Remove standalone `TopTrending` row |
| `client/src/components/Header/Header.tsx` | Flatten Input border |
| `client/src/components/TrendFinder/PlayerDetailView.tsx` | Reverse chart order; date label; legend colour fix |
| `analytics/kalshi/client.py` | Fix mock game ticker prefix |
| `server/src/controllers/picksController.ts` | `findNearestLinesDate` fallback for streaks |
| `server/src/controllers/nbaController.ts` | Verify/add `date` field to `getPlayerProfile` game rows |

---

## Out of Scope

- PropsTable spread/total tabs: kept as-is; will populate once game picks pipeline generates data.
- PicksRow game card slots: kept as-is; cards show "No X pick" when empty which is correct behaviour.
- No changes to StreaksCard UI — only the server-side date fallback.
