# SportQuery result enrichment — backlog for sub-project B

> Captured 2026-04-22 during sub-project A debugging. Belongs in the **B (game props pipeline + streaks + SportQuery backend)** spec.

## The gap

SportQuery currently returns raw SQL rows to the frontend. The display layer (`client/src/components/SportQuery/AssistantMessage.tsx`, `CompactPlayerCard.tsx`, `ResultCardList.tsx`) is hardcoded to render **player-shape rows** only. When the LLM returns a different shape — game rows, pick rows, line rows — every cell maps to `Unknown` because the frontend is looking for `name`, `team`, `position`, `z_score`, etc. and those keys don't exist on the returned rows.

Meanwhile the **player profile page** (`/player/:id`) gets a rich, structured response from `/api/nba/players/:id/games`: full player object + games list + zScores + rollingAvgs. The display there is satisfying.

## User's ask

> "the same population that can happen with the player profiles should happen in sportquery"

SportQuery's backend should enrich raw SQL results into **typed, shape-aware envelopes** — parallel to how `getPlayerGames` returns a structured profile — so the frontend can render them richly instead of falling back to "Unknown".

## Design implications for the B spec

The current envelope is:

```ts
type Envelope = {
  sql: string | null
  narrative: string
  disambiguation?: { candidates: string[]; prompt: string }
  follow_up_suggestions?: string[]
}
```

Extend with a **result-shape discriminator** and per-shape enrichment. Candidate shapes, driven by SQL the LLM already generates today:

| Shape | Triggered when SQL returns | Enrichment |
|---|---|---|
| `player_trends` | `nba_trends` joined to `players` | Attach `z_score` color bucket, season baseline, today's opponent if on slate |
| `player_games` | `nba_player_stats` joined to `players` | Attach opponent abbr (via `game_matchups`), mini bar chart series, hit-rate vs a default threshold |
| `picks` | `pick_results` joined to `players` | Attach `statLabel`, `edge %`, `confidence` bucket, matching the existing `TodaysPicks` shape |
| `lines` | `daily_lines` | Attach `impliedProbPct`, `bookKalshi` label |
| `generic` | Everything else | Pass through as a table; frontend renders generic table view |

Shape detection can happen post-query in the backend service — either by inspecting returned columns (cheap) or by having the LLM emit a `shape` hint alongside the SQL (more reliable, slight prompt cost).

## Frontend touch-points (part of C but coordinated with B)

- Replace the single `CompactPlayerCard` with a **shape-aware renderer**: `PlayerTrendsCard`, `PlayerGamesCard` (mini bar chart like PlayerDetailView), `PickCard`, `LineCard`, `GenericTable`.
- `AssistantMessage.tsx` switches on `envelope.shape` to pick the right renderer.
- Keep graceful fallback: unknown shape → GenericTable with column headers derived from the first row's keys (no more "Unknown").

## Secondary issue noted during A debugging

The LLM's today-scoped SQL uses a strict `WHERE game_date = CURRENT_DATE` filter, which returns empty when today's picks haven't been populated yet. The REST `/api/nba/picks/today` endpoint in `nbaController.ts:244-256` falls back to the nearest upcoming date with picks. Consider:

- Teaching the LLM (via few-shot examples) to use a "today or next available slate" pattern, OR
- Having the backend transparently widen a `CURRENT_DATE` filter to "nearest upcoming slate" when the strict filter returns zero rows and the query targets picks/lines.

## Out of scope for this backlog item

- Full shadcn migration of SportQuery components → covered in sub-project C.
- New streak/top-5 picks UI sections → covered in sub-project B (backend) + C (frontend).
