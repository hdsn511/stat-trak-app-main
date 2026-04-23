# Kalshi spread market team-perspective gap

> Captured 2026-04-23 while shipping sub-project B.

## The gap

`daily_lines.line` for `prop_type='spread'` rows stores the unsigned absolute spread (e.g. `3.5` for a "Lakers -3.5" market). Nothing in `daily_lines` captures WHICH team the market asks about — only the ticker + `entity_id` (game_id) + `line`. As a result, "did team X cover" can't be determined from the stored row alone.

The `analytics/kalshi/client.py::parse_game_props` function detects `prop_type='spread'` via title keywords but doesn't extract the favored team or sign the line.

## Impact

- `GET /api/nba/streaks/perfect?type=game&stat=cover_spread` was initially implemented in Task 7 of the picks/streaks backend plan but removed before shipping because the math was ambiguous.
- Any "cover_spread" analytics (streaks, pick_results labeling, backtester enrichment) are blocked until this is resolved.

## Proposed fix (defer until needed)

Option A — add columns to `daily_lines`:
- `favored_team_id INTEGER` — the team_id the YES market asks about covering
- Keep `line` as unsigned absolute; interpret as "favorite wins by >= line"

Option B — keep schema flat, encode sign:
- Store spread signed from the home team's perspective (favorite = negative, underdog = positive)
- Update backtester/controllers accordingly

Option A is cleaner (explicit > implicit); Option B matches Kalshi's native spread convention.

## Where to implement

- `analytics/kalshi/client.py::parse_game_props` needs to extract the favored team from the market `title` or `ticker`. For Kalshi v2 tickers like `KXNBASPREAD-<DATE><AWAY><HOME>-<FAVORED>`, parsing the final segment works; confirm with a real data sample first.
- `analytics/picks/generate.py::_store_daily_lines` needs to write the new column.
- `server/src/controllers/picksController.ts::getGamePerfectStreaks` re-adds `cover_spread` support (straightforward once team is known).
