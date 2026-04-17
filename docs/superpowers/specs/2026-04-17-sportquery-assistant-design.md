# StatTrak SportQuery Assistant Design

**Date:** 2026-04-17
**Status:** Draft (pending user review)
**Goal:** Add a conversational AI assistant ("SportQuery") that lets users query NBA player and game statistics through multi-turn natural-language chat. Queries are translated by Groq's Kimi-K2 model into sandboxed read-only PostgreSQL executed against the existing Supabase database. Results render inline in the chat as native StatTrak player cards.

---

## Context

StatTrak already has a rich NBA dataset in Supabase:

| Table / View | Purpose |
|---|---|
| `players` | name, team, position, ext_id, is_active |
| `teams` | abbreviation, full name, league |
| `games` | date, season, home/away team ids, ext_id |
| `nba_player_stats` | per-player-per-game basic box (pts/reb/ast/3pm/fouls/min) |
| `nba_trends` | z-scores, rolling averages by stat/window |
| `player_game_conditions` | per-player-per-game advanced (usg, pace, ratings, days rest, matchup) |
| `team_game_stats` | per-team-per-game advanced (pace, off/def rating) |
| `player_availability` | inactive flags per player per game |
| `opponent_position_defense` | team × position_group rank, pts/reb/ast allowed |
| `picks` | daily picks with Kalshi lines, confidence scores |

The backend is Express 5 / TypeScript, reading from Supabase via `@supabase/supabase-js` using a service-role key. The frontend is React 18 / Vite / TypeScript, styled with Tailwind and shadcn/ui.

No chat or LLM integration currently exists in either tier. Groq is the chosen LLM provider.

SportQuery must feel like a first-class feature of the app — its own route, its own header entry — not a corner widget.

---

## Section 1 — Architecture Overview

```
┌────────────────┐   fetch/EventSource    ┌───────────────────┐
│  React client  │ ─────────────────────> │  Express server   │
│   /sportquery  │ <───────────────────── │  /api/sportquery  │
└────────────────┘   streamed response    └────────┬──────────┘
                                                    │
                          ┌─────────────────────────┼──────────────┐
                          │                         │              │
                          ▼                         ▼              ▼
                  ┌──────────────┐         ┌──────────────┐   ┌─────────┐
                  │   Groq API   │         │   Supabase   │   │ Session │
                  │  (Kimi-K2)   │         │ (read-only)  │   │ storage │
                  └──────────────┘         └──────────────┘   └─────────┘
```

**Flow for one user message:**

1. Client posts message + session id to `/api/sportquery/message`.
2. Server loads conversation history from `sportquery_messages` (last N turns).
3. Server calls Groq with system prompt (schema + few-shot) + history + new message.
4. Groq returns a JSON envelope: `{ sql: string | null, narrative: string, disambiguation?: {...} }`.
5. If `sql` is present, server validates it (AST parse, whitelist, limit injection), executes against a **read-only** Postgres role, and collects rows.
6. Server streams a response to the client: narrative tokens as they arrive from Groq, then a final `results` event carrying the rows (shaped into `PlayerCard[]` or similar).
7. Both user message and assistant response are persisted to `sportquery_messages`.

---

## Section 2 — Database Additions

### New migration: `sportquery_schema.sql`

```sql
-- Read-only role for the assistant's DB connection
CREATE ROLE sportquery_reader NOLOGIN;
GRANT USAGE ON SCHEMA public TO sportquery_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sportquery_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO sportquery_reader;

-- Attach the role to a dedicated Supabase user used only by SportQuery.
-- (Created via Supabase dashboard; credentials go in .env as SPORTQUERY_DB_URL)

-- Flattened matchup view for clean "against team X" queries
CREATE VIEW game_matchups AS
SELECT
  g.id           AS game_id,
  g.ext_id       AS game_ext_id,
  g.game_date,
  g.season,
  g.home_team_id AS team_id,
  g.away_team_id AS opponent_team_id,
  TRUE           AS is_home
FROM games g
UNION ALL
SELECT
  g.id, g.ext_id, g.game_date, g.season,
  g.away_team_id, g.home_team_id, FALSE
FROM games g;

-- Session + message tables
CREATE TABLE sportquery_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'local',
  title TEXT,                    -- auto-summarized from first user msg
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sportquery_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sportquery_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sql_executed TEXT,             -- nullable: present for assistant msgs that ran SQL
  result_count INTEGER,          -- nullable: number of rows returned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sportquery_messages_session
  ON sportquery_messages(session_id, created_at);
```

### Why the matchup view

Queries like "LeBron vs Warriors when Curry didn't play" otherwise require a `CASE` join against `games`. The view pre-flattens home/away pairs so every such query becomes a clean 3-table join. Reduces LLM SQL-generation error rate and improves readability of SQL shown in error messages.

---

## Section 3 — Server Components

### New files

```
server/src/
├── config/
│   └── groq.ts              # Groq client initialization
├── controllers/
│   └── sportquery.ts        # POST /message, GET /sessions, etc.
├── routes/
│   └── sportquery.ts        # Route wiring
├── services/
│   ├── sqlValidator.ts      # AST parse + whitelist + LIMIT injection
│   ├── sportqueryLLM.ts     # Groq call + response envelope parsing
│   ├── sportqueryDB.ts      # Read-only pool + query execution
│   └── sportquerySession.ts # Session + message CRUD
├── prompts/
│   ├── sportquery-system.ts # Base system prompt with schema
│   └── sportquery-examples.ts # Few-shot library (array of {user, sql, narrative})
└── jobs/ (unchanged)
```

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sportquery/session` | Create new session, returns `{sessionId}` |
| `GET` | `/api/sportquery/session/:id/messages` | Load message history |
| `POST` | `/api/sportquery/message` | Send user message; returns SSE stream of tokens + final results |
| `GET` | `/api/sportquery/sessions` | List user's sessions (for session switcher) |
| `DELETE` | `/api/sportquery/session/:id` | Delete session |

### Response envelope from the LLM

We instruct Groq to always respond with JSON matching:

```ts
type LLMResponse = {
  sql: string | null;          // null when no query needed (greeting, clarification, etc.)
  narrative: string;           // streamed to client
  disambiguation?: {           // optional: when name is ambiguous
    candidates: string[];      // e.g. ["Stephen Curry", "Seth Curry"]
    prompt: string;            // "Did you mean Stephen or Seth?"
  };
  follow_up_suggestions?: string[]; // optional: quick-pick refinements for the UI
};
```

Validation: if Groq returns malformed JSON, retry once with a clarifying system nudge. If still malformed, surface as generic "I couldn't understand — try rephrasing."

### SQL validation pipeline (`sqlValidator.ts`)

Every SQL string from the LLM goes through:

1. **Parse.** Use `libpg_query` (via `libpg-query` npm package) to produce an AST. If parsing fails, reject.
2. **Statement type check.** Must be a single `SELECT` (including CTEs that are only `SELECT`). Reject `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `EXECUTE`, `CALL`, `COPY`, etc.
3. **Table whitelist.** Every referenced table/view must be in the allowlist: `players`, `teams`, `games`, `nba_player_stats`, `nba_trends`, `player_game_conditions`, `team_game_stats`, `player_availability`, `opponent_position_defense`, `picks`, `game_matchups`. Reject anything else (e.g. `pg_*`, `information_schema`, session tables).
4. **Function denylist.** Reject `pg_sleep`, `pg_read_file`, `pg_ls_dir`, `dblink_*`, `lo_*`, any function starting with `pg_`. (Whitelist harder — a few hundred functions are fine; enumerating safe ones is more error-prone than banning obvious danger.)
5. **LIMIT injection.** If the outermost SELECT has no `LIMIT`, wrap the query: `SELECT * FROM (<original>) AS _sq LIMIT 500`. If it has `LIMIT`, cap to 500.
6. **Execute** against the read-only pool (`SPORTQUERY_DB_URL`) with `statement_timeout = 2s` set per-connection.

The validator is unit tested with a fixture list of known-good and known-bad inputs (see Testing section).

### Dual-key DB configuration

Add to `server/.env`:

```
GROQ_API_KEY=...
SPORTQUERY_DB_URL=postgresql://sportquery_reader:<pw>@<host>:<port>/postgres?sslmode=require
```

`supabaseAdmin.ts` is unchanged (still uses service role). `sportqueryDB.ts` creates a separate `pg.Pool` with the read-only URL. The two never mix.

---

## Section 4 — Client Components

### New route

Add to `client/src/App.tsx`:

```tsx
<Route path="/sportquery" element={<SportQuery />} />
<Route path="/sportquery/:sessionId" element={<SportQuery />} />
```

### New Header entry

`client/src/components/Header/Header.tsx` — add a fourth nav item `SPORTQUERY` between `HOME` and `NBA`. Uses the existing active-underline pattern (`bg-mint bottom-0`).

### New component tree

```
client/src/components/SportQuery/
├── SportQuery.tsx            # Page wrapper: Sidebar + chat main
├── ChatColumn.tsx            # Centered column, message list + input
├── MessageList.tsx           # Scrollable message history
├── UserMessage.tsx           # Right-aligned user bubble
├── AssistantMessage.tsx      # Left-aligned assistant bubble (narrative + results)
├── ResultCardList.tsx        # Up to 5 inline compact player cards + "See all N" chip
├── CompactPlayerCard.tsx     # Mini card (name, position, key stat badge, z-score bar)
├── ChatInput.tsx             # Textarea + send button, handles submit
├── SessionSidebar.tsx        # Overrides Sidebar body to show session list (optional v1.5)
└── hooks/
    ├── useSportQuery.ts      # Session state, message append, SSE client
    └── useMessageStream.ts   # SSE parsing, token accumulation
```

For v1, the existing `Sidebar` component stays as-is (today's NBA games). Session switching is a simple dropdown in the chat header. `SessionSidebar.tsx` is a follow-up.

### Styling

All new components use existing design tokens:

- Containers: `bg-[#0D0D0D] border border-[#161616] rounded-2xl`
- Labels: `text-[10px] font-bold text-gray-600 uppercase tracking-[0.2em] font-condensed`
- Accents: `text-mint` for highlights (z-score positives, active send button)
- Typography: `font-sans` (DM Sans) for body, `font-condensed` (Barlow) for labels, `font-display` (Doto) for large numbers in cards
- Animations: `animate-fade-up` for new message appearance, existing `animate-pulse-live` for the streaming indicator dot

Compact player cards reuse the visual vocabulary of TrendFinder's result rows but at smaller dimensions.

### Clickable results

Every `CompactPlayerCard` wraps in `<Link to={/player/${id}}>`. Navigates to existing `PlayerDetailView` in the same tab.

### Streaming UX

While the assistant is typing: a mint pulse dot appears in the assistant's message bubble. Narrative text appears token-by-token. When results arrive (single event after SQL completes), cards fade in below the narrative. "See all N" expansion is a local state toggle (no round-trip).

### Empty state

First visit to `/sportquery` with no session id → show a welcome panel with 4 suggested prompt chips:

- "Find guards trending up over the last 10 games"
- "Show today's picks with the biggest Kalshi edges"
- "LeBron's last 10 games without Austin Reaves"
- "Best defenses against centers this season"

Clicking a chip creates a session and sends the prompt.

---

## Section 5 — LLM Prompting Strategy

### System prompt structure

```
You are SportQuery, an assistant that answers questions about NBA
statistics by writing read-only PostgreSQL queries against a known schema.

SCHEMA:
  <table-by-table description, column types, key relationships>

VIEWS:
  game_matchups(game_id, game_ext_id, game_date, season, team_id,
                opponent_team_id, is_home)
    -- flat home/away pairs, 2 rows per game

RULES:
  - Output ONLY a single JSON object matching:
    { "sql": string | null, "narrative": string,
      "disambiguation": {...}?, "follow_up_suggestions": string[]? }
  - SQL must be a single SELECT (CTEs allowed if all SELECT).
  - Never use functions starting with pg_.
  - Use ILIKE for case-insensitive name matching.
  - When the user references a player by partial name, write
    p.name ILIKE '%<name>%'. If a name could match multiple
    players you know of, emit disambiguation instead of SQL.
  - Prefer `game_matchups` for "against team X" filters.
  - For "without teammate X" use NOT EXISTS against nba_player_stats
    with minutes_played > 0 (do NOT rely on player_availability).
  - Always include ORDER BY + LIMIT for list queries. Default LIMIT 20.
  - Narrative: 1–3 sentences. Summarize the result scope, not the SQL.

MULTI-TURN:
  Previous SQL and user intent are available in the conversation
  history. When the user refines ("now only X", "just the first 5"),
  modify the previous SQL rather than starting over.
```

### Few-shot library

Target 10–12 examples in `sportquery-examples.ts`:

1. Top trending players by z-score (simple single-table)
2. Today's NBA slate with opponent defensive ranks
3. Today's picks with highest Kalshi edge
4. Player X vs Team Y head-to-head
5. Player X's last N games without teammate Y (the key pattern)
6. Player X's road splits last season
7. Opponent position defense rankings
8. Players with rest advantage tonight (days_rest filter)
9. Teammate absent (game-level OR player-level variant)
10. Z-score trend refinement ("just the ones with usg_pct > 25")
11. Disambiguation example ("Curry" → Steph or Seth)
12. Empty result + relaxation ("No results. Want to extend window?")

Each example is `{ user: string, assistantJSON: string, explanation: string }`.

---

## Section 6 — Multi-Turn Refinement

State carried per session:

- **Full message history** (user + assistant, plus the SQL string that was run for each assistant turn) is passed to Groq on every call.
- **Last `sql_executed`** is highlighted in the system prompt as the "current query to potentially modify."

Example refinement:

- Turn 1 user: "Find guards trending up over the last 10 games"
  Turn 1 assistant SQL: `SELECT ... FROM nba_trends t JOIN players p ... WHERE p.position IN ('PG','SG') AND t.z_score > 1 AND t.window = 10 ...`
- Turn 2 user: "Now only show me the ones with a Kalshi line available"
  Turn 2 assistant SQL: modifies turn 1 by adding a `JOIN picks pk ON pk.player_id = p.id` and `WHERE pk.kalshi_price IS NOT NULL`.

The LLM does the modification; we don't need a query-diffing engine on our side. Groq's context window (200K+ for Kimi) easily handles 20+ turns of history.

---

## Section 7 — Error Handling

| Failure | Behavior |
|---|---|
| Groq API error (5xx, network) | Retry once with 1s backoff. If still fails: assistant message "Having trouble reaching the model — try again in a moment." |
| Malformed JSON from Groq | Retry once with a nudge ("Your previous output wasn't valid JSON. Respond with JSON only."). If still fails: generic error message. |
| SQL fails AST parse / whitelist | Feed error back to Groq once for a corrected retry. If still invalid: "I couldn't query that — can you rephrase?" (do not surface validator details to the user) |
| SQL executes but errors at Postgres level | Same as above: one retry with error message as context, then surface generic. |
| SQL returns 0 rows | Narrative includes "No results match. Want to widen [suggested filter]?" — Groq generates suggestions in `follow_up_suggestions`. |
| Ambiguous player name | Groq returns `disambiguation` instead of SQL; UI renders candidate chips. User clicks or types; next turn resolves. |
| User hits rate limit | Server returns 429; client shows "Slow down — try again in a minute." |
| Session not found | 404; client redirects to `/sportquery` (fresh session). |

All LLM-visible errors are captured in `sportquery_messages` (stored in `content` with a marker) so the next turn can see what went wrong.

---

## Section 8 — Rate Limits

- **Per-IP:** 30 requests/minute, 500 requests/day. Implemented via `express-rate-limit` with a custom store (in-memory for v1; upgradeable to Redis later).
- **Groq cost protection:** Hard cap on input+output tokens per request: 8K input, 2K output. Guards against runaway conversations.
- **Query row cap:** 500 rows max (enforced in SQL validator).
- **Session message cap:** 50 messages per session. After 50, create-new-session nudge in UI.

These are not security boundaries (no auth in v1); they're guardrails against accidental runaway loops or cost spikes.

---

## Section 9 — Testing Strategy

### Server

**`sqlValidator.test.ts`** (highest priority — this is the security boundary):

- Fixtures file with ~40 SQL strings, each labeled `valid` or `invalid:<reason>`.
- Covers: plain SELECT (valid), CTE SELECT (valid), multi-statement (invalid), INSERT/UPDATE/DELETE (invalid), DROP (invalid), `pg_sleep` (invalid), `information_schema` (invalid), view reference (valid), unknown table (invalid), nested subquery (valid), `LIMIT` already present (valid, capped), no `LIMIT` (valid, injected).
- Runs in CI.

**`sportqueryLLM.test.ts`:**

- Mock Groq client, assert system prompt includes schema + examples.
- Test JSON envelope parsing (good, malformed, missing fields).

**`sportqueryDB.test.ts`:**

- Integration test against a throwaway Postgres with seeded fixtures.
- Verify `statement_timeout` works (run `SELECT pg_sleep(5)` — should be rejected by validator first, but also confirm the timeout fires if somehow a slow query slips through).
- Verify read-only role can't INSERT (should error).

### Client

**`useSportQuery.test.tsx`:** React Testing Library tests for session creation, message append, SSE handling (with a mock EventSource).

**Visual verification:** Developer runs `npm run dev`, manually tests the flow (no automated E2E for v1).

---

## Section 10 — Non-Goals (YAGNI for v1)

Explicitly not in scope:

- Multi-user authentication
- Shared/public session links
- Voice input
- Chart or visualization rendering in responses (cards + text only)
- Saved/favorited queries
- Conversation export / PDF
- Non-NBA sports (NFL, MLB, NHL — data pipelines not populated)
- Caching layer for repeat queries
- Query cost/token-usage telemetry dashboard
- Streaming of result rows (only narrative streams)
- Edit-previous-message functionality
- "Regenerate" button

These are all additive and reasonable to consider post-v1 once usage patterns are known.

---

## Section 11 — Data Dependencies

This feature benefits from (but does not require) the bug fixes to `enrich_games.py` flagged in the backfill review:

- Silent `"OK"` bug (line 629) — affects log clarity, not query results
- `_load_already_enriched` resume hole — affects data completeness in `player_availability`

SportQuery uses `minutes_played > 0` against `nba_player_stats` for teammate-absence queries (the common case), so `player_availability` gaps do not block the primary use case. Queries that explicitly reference "listed as inactive" will have gaps until the resume-hole is fixed.

These fixes are tracked separately, not in this spec's scope.

---

## Section 12 — Rollout Plan

1. **Migration** — Run `sportquery_schema.sql` against Supabase (creates role, view, session tables).
2. **Env setup** — Add `GROQ_API_KEY` and `SPORTQUERY_DB_URL` to `server/.env`.
3. **Server** — Build validator + LLM service + endpoints. Unit-test validator first.
4. **Few-shot library** — Write and hand-verify 10–12 examples against the actual database.
5. **Client** — Build chat UI, wire to endpoints, manually test each query pattern.
6. **Smoke test** — Run through all 10 few-shot queries end-to-end plus 5 novel variations.
7. **Ship** — Add Header nav entry; route is live.

Estimated effort (without the frontend overhaul which is a separate project): ~2 days of focused work.

---

## Open Questions for User Review

None blocking. The following would be nice-to-have refinements and can be deferred:

- Do you want a keyboard shortcut (⌘K / Ctrl+K) from anywhere in the app to jump to SportQuery with focus in the input?
- Do you want Groq's SQL to be visible in the UI (behind a "Show query" toggle) for debugging/transparency?
- Should follow-up suggestion chips appear automatically after every result, or only when opted in?

---

## References

- [Groq docs](https://console.groq.com/docs) — Kimi-K2, streaming, JSON mode
- [libpg_query](https://github.com/pganalyze/libpg_query) — PostgreSQL AST parser used by the validator
- [Vercel AI SDK streaming patterns](https://sdk.vercel.ai/docs/ai-sdk-core/stream-text) — Reference for SSE client patterns; we use a minimal custom implementation
- Existing spec: `docs/superpowers/specs/2026-04-14-picks-pipeline-frontend.md`
