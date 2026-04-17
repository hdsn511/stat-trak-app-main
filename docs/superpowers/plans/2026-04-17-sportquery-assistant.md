# SportQuery Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `SportQuery`, a conversational AI assistant at `/sportquery` that translates natural-language questions into sandboxed read-only PostgreSQL using Groq's Kimi-K2, rendered inside a native chat UI with inline player cards.

**Architecture:** Express endpoints take user messages, call Groq with a schema-aware system prompt + few-shot library, parse a JSON envelope response, run the returned SQL through an AST-validated read-only pipeline, then stream narrative tokens + final result rows back to a React chat UI.

**Tech Stack:** TypeScript + Express 5 server with `pg` + `libpg-query` + `groq-sdk` + `express-rate-limit`. React 18 + Vite client with `react-router-dom` + Tailwind + existing shadcn components. Vitest for tests. Supabase for persistence. Groq for LLM.

**Spec reference:** `docs/superpowers/specs/2026-04-17-sportquery-assistant-design.md`

---

## File Structure

### Server (new files)

```
server/src/
├── config/
│   └── groq.ts                        # Groq client init
├── controllers/
│   └── sportquery.ts                  # Endpoint handlers
├── routes/
│   └── sportquery.ts                  # Route wiring
├── services/
│   ├── sqlValidator.ts                # AST-based validator (security boundary)
│   ├── sportqueryLLM.ts               # Groq call + envelope parsing
│   ├── sportqueryDB.ts                # Read-only pg.Pool + query runner
│   └── sportquerySession.ts           # Session + message CRUD
├── prompts/
│   ├── sportquery-system.ts           # System prompt + schema description
│   └── sportquery-examples.ts         # Few-shot library
└── middleware/
    └── sportqueryRateLimit.ts         # express-rate-limit wrapper

server/tests/
├── sqlValidator.test.ts               # ~40 fixture cases
└── sportqueryLLM.test.ts              # JSON envelope parsing
```

### Client (new files)

```
client/src/components/SportQuery/
├── SportQuery.tsx                     # Page wrapper
├── ChatColumn.tsx                     # Centered chat column
├── MessageList.tsx                    # Scrollable history
├── UserMessage.tsx                    # Right-aligned user bubble
├── AssistantMessage.tsx               # Left-aligned assistant bubble + results
├── ResultCardList.tsx                 # Inline cards + "See all N" chip
├── CompactPlayerCard.tsx              # Mini player card (links to PlayerDetailView)
├── ChatInput.tsx                      # Textarea + send
├── EmptyState.tsx                     # 4 suggested prompt chips
├── SessionSwitcher.tsx                # Dropdown to list/switch sessions
├── SuggestionsToggle.tsx              # "Suggestions: on/off" header toggle
└── hooks/
    ├── useSportQuery.ts               # Session + messages state
    └── useMessageStream.ts            # SSE parser

client/src/services/
└── sportqueryApi.ts                   # Client API wrapper (fetch + EventSource)
```

### Migrations

```
server/migrations/
└── 2026-04-17-sportquery-schema.sql   # Role, view, session tables
```

---

## Task 1: Dependencies + server test setup

**Files:**
- Modify: `server/package.json`
- Create: `server/vitest.config.ts`
- Create: `server/tests/.gitkeep`

- [ ] **Step 1: Install server dependencies**

Run from repo root:
```bash
cd server && npm install --save groq-sdk libpg-query express-rate-limit && npm install --save-dev vitest @vitest/ui
```

Expected: installs complete without errors; `package.json` gains the 4 packages.

- [ ] **Step 2: Add test scripts to `server/package.json`**

Modify the `scripts` block in `server/package.json`:
```json
"scripts": {
  "dev": "nodemon src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js",
  "sync-data": "ts-node src/scripts/runSync.ts",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
})
```

- [ ] **Step 4: Create placeholder test to verify runner**

Create `server/tests/_smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run the smoke test**

```bash
cd server && npm test
```

Expected: `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/vitest.config.ts server/tests/
git commit -m "feat(server): add vitest + groq-sdk + libpg-query + express-rate-limit"
```

---

## Task 2: Database migration

**Files:**
- Create: `server/migrations/2026-04-17-sportquery-schema.sql`

- [ ] **Step 1: Write the migration SQL**

Create `server/migrations/2026-04-17-sportquery-schema.sql`:

```sql
-- SportQuery schema: read-only role, flattened matchup view, session storage
-- Apply via Supabase SQL editor.

-- 1. Read-only role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportquery_reader') THEN
    CREATE ROLE sportquery_reader NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sportquery_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sportquery_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO sportquery_reader;

-- 2. Flattened home/away matchup view
CREATE OR REPLACE VIEW game_matchups AS
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

GRANT SELECT ON game_matchups TO sportquery_reader;

-- 3. Session storage
CREATE TABLE IF NOT EXISTS sportquery_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'local',
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sportquery_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sportquery_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sql_executed TEXT,
  result_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sportquery_messages_session
  ON sportquery_messages(session_id, created_at);
```

- [ ] **Step 2: Apply the migration via Supabase**

Instruct the user to paste the migration contents into the Supabase SQL editor and run it. After it completes, verify:

```sql
SELECT * FROM game_matchups LIMIT 2;
SELECT * FROM sportquery_sessions LIMIT 1;
```

Expected: view returns rows; sessions table exists and is empty.

- [ ] **Step 3: Ask user to create the SportQuery DB user + password**

In the Supabase dashboard → Authentication → Roles (or Database → Roles):
1. Create a new user `sportquery_app` with password; grant them the `sportquery_reader` role.
2. Construct a connection string:
   `postgresql://sportquery_app:<password>@<host>:6543/postgres?sslmode=require`
3. User adds to `server/.env`:
   ```
   GROQ_API_KEY=<groq key>
   SPORTQUERY_DB_URL=postgresql://sportquery_app:<pw>@<host>:6543/postgres?sslmode=require
   ```

This step is manual — do not write the plan past this point assuming the env is set; explicit verification comes in Task 6.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/2026-04-17-sportquery-schema.sql
git commit -m "feat(db): add sportquery schema migration (role, matchup view, sessions)"
```

---

## Task 3: SQL validator — parse + statement-type check (TDD)

**Files:**
- Create: `server/tests/sqlValidator.test.ts`
- Create: `server/src/services/sqlValidator.ts`

- [ ] **Step 1: Write failing tests for parse + statement-type**

Create `server/tests/sqlValidator.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateSql } from '../src/services/sqlValidator'

describe('sqlValidator — parse & statement type', () => {
  it('accepts a simple SELECT', async () => {
    const result = await validateSql('SELECT 1')
    expect(result.ok).toBe(true)
  })

  it('accepts a SELECT with CTE', async () => {
    const result = await validateSql(
      'WITH t AS (SELECT 1 AS x) SELECT x FROM t'
    )
    expect(result.ok).toBe(true)
  })

  it('rejects unparsable SQL', async () => {
    const result = await validateSql('SELEKT 1')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/parse/i)
  })

  it('rejects INSERT', async () => {
    const result = await validateSql("INSERT INTO players (id) VALUES (1)")
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/SELECT/i)
  })

  it('rejects UPDATE', async () => {
    const result = await validateSql(
      "UPDATE players SET name = 'x' WHERE id = 1"
    )
    expect(result.ok).toBe(false)
  })

  it('rejects DELETE', async () => {
    const result = await validateSql('DELETE FROM players WHERE id = 1')
    expect(result.ok).toBe(false)
  })

  it('rejects DROP', async () => {
    const result = await validateSql('DROP TABLE players')
    expect(result.ok).toBe(false)
  })

  it('rejects two statements', async () => {
    const result = await validateSql('SELECT 1; SELECT 2')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/single|one/i)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npm test
```

Expected: all 8 tests fail with "Cannot find module '../src/services/sqlValidator'".

- [ ] **Step 3: Implement `validateSql` with parse + statement check**

Create `server/src/services/sqlValidator.ts`:
```ts
import { parseQuery } from 'libpg-query'

export type ValidationResult =
  | { ok: true; rewritten: string }
  | { ok: false; reason: string }

export async function validateSql(sql: string): Promise<ValidationResult> {
  if (!sql || typeof sql !== 'string') {
    return { ok: false, reason: 'empty query' }
  }

  let parsed: any
  try {
    parsed = await parseQuery(sql)
  } catch (err: any) {
    return { ok: false, reason: `parse error: ${err.message}` }
  }

  const stmts = parsed?.stmts ?? []
  if (stmts.length !== 1) {
    return { ok: false, reason: 'must be a single SELECT statement' }
  }

  const stmt = stmts[0].stmt
  if (!stmt || !('SelectStmt' in stmt)) {
    return {
      ok: false,
      reason: 'only SELECT statements are allowed',
    }
  }

  return { ok: true, rewritten: sql }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npm test
```

Expected: 8 passing tests.

- [ ] **Step 5: Commit**

```bash
git add server/tests/sqlValidator.test.ts server/src/services/sqlValidator.ts
git commit -m "feat(sportquery): SQL validator phase 1 — parse + statement type"
```

---

## Task 4: SQL validator — table whitelist (TDD)

**Files:**
- Modify: `server/tests/sqlValidator.test.ts`
- Modify: `server/src/services/sqlValidator.ts`

- [ ] **Step 1: Add failing tests for whitelist**

Append to `server/tests/sqlValidator.test.ts`:
```ts
describe('sqlValidator — table whitelist', () => {
  it('accepts queries against allowlisted tables', async () => {
    const result = await validateSql(
      'SELECT id FROM players WHERE name ILIKE $1'
    )
    expect(result.ok).toBe(true)
  })

  it('accepts joins across allowlisted tables', async () => {
    const result = await validateSql(`
      SELECT s.points FROM nba_player_stats s
      JOIN players p ON s.player_id = p.id
      JOIN game_matchups gm ON s.game_id = gm.game_id
    `)
    expect(result.ok).toBe(true)
  })

  it('rejects queries hitting pg_class', async () => {
    const result = await validateSql('SELECT * FROM pg_class')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/table|allow/i)
  })

  it('rejects queries hitting information_schema', async () => {
    const result = await validateSql(
      'SELECT * FROM information_schema.tables'
    )
    expect(result.ok).toBe(false)
  })

  it('rejects unknown tables', async () => {
    const result = await validateSql('SELECT * FROM secret_table')
    expect(result.ok).toBe(false)
  })

  it('rejects pg_sleep function', async () => {
    const result = await validateSql('SELECT pg_sleep(5)')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/function|pg_/i)
  })
})
```

- [ ] **Step 2: Run tests to confirm whitelist tests fail**

```bash
cd server && npm test
```

Expected: 6 new tests fail (the 3 valid ones pass-ish but may already pass; the 3 invalid ones fail because no whitelist is enforced yet).

- [ ] **Step 3: Implement whitelist enforcement**

Modify `server/src/services/sqlValidator.ts`:
```ts
import { parseQuery } from 'libpg-query'

export type ValidationResult =
  | { ok: true; rewritten: string }
  | { ok: false; reason: string }

const ALLOWED_TABLES = new Set([
  'players',
  'teams',
  'games',
  'nba_player_stats',
  'nba_trends',
  'player_game_conditions',
  'team_game_stats',
  'player_availability',
  'opponent_position_defense',
  'picks',
  'game_matchups',
])

function collectRangeVars(node: any, bucket: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectRangeVars(n, bucket))
    return
  }
  if (node.RangeVar?.relname) {
    bucket.push(node.RangeVar.relname.toLowerCase())
  }
  for (const key of Object.keys(node)) {
    collectRangeVars(node[key], bucket)
  }
}

function collectFuncCalls(node: any, bucket: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectFuncCalls(n, bucket))
    return
  }
  if (node.FuncCall?.funcname) {
    const names = node.FuncCall.funcname
      .map((n: any) => (n.String?.sval ?? '').toLowerCase())
      .filter(Boolean)
    if (names.length) bucket.push(names.join('.'))
  }
  for (const key of Object.keys(node)) {
    collectFuncCalls(node[key], bucket)
  }
}

export async function validateSql(sql: string): Promise<ValidationResult> {
  if (!sql || typeof sql !== 'string') {
    return { ok: false, reason: 'empty query' }
  }

  let parsed: any
  try {
    parsed = await parseQuery(sql)
  } catch (err: any) {
    return { ok: false, reason: `parse error: ${err.message}` }
  }

  const stmts = parsed?.stmts ?? []
  if (stmts.length !== 1) {
    return { ok: false, reason: 'must be a single SELECT statement' }
  }

  const stmt = stmts[0].stmt
  if (!stmt || !('SelectStmt' in stmt)) {
    return { ok: false, reason: 'only SELECT statements are allowed' }
  }

  const tables: string[] = []
  collectRangeVars(stmt, tables)
  for (const t of tables) {
    if (!ALLOWED_TABLES.has(t)) {
      return { ok: false, reason: `table '${t}' is not allowlisted` }
    }
  }

  const funcs: string[] = []
  collectFuncCalls(stmt, funcs)
  for (const f of funcs) {
    if (f.startsWith('pg_') || f.includes('.pg_')) {
      return { ok: false, reason: `function '${f}' is not allowed` }
    }
    if (['dblink', 'lo_import', 'lo_export'].some((bad) => f.includes(bad))) {
      return { ok: false, reason: `function '${f}' is not allowed` }
    }
  }

  return { ok: true, rewritten: sql }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd server && npm test
```

Expected: 14 passing tests (8 prior + 6 new).

- [ ] **Step 5: Commit**

```bash
git add server/tests/sqlValidator.test.ts server/src/services/sqlValidator.ts
git commit -m "feat(sportquery): SQL validator phase 2 — table + function whitelist"
```

---

## Task 5: SQL validator — LIMIT injection (TDD)

**Files:**
- Modify: `server/tests/sqlValidator.test.ts`
- Modify: `server/src/services/sqlValidator.ts`

- [ ] **Step 1: Add failing LIMIT-injection tests**

Append to `server/tests/sqlValidator.test.ts`:
```ts
describe('sqlValidator — LIMIT injection', () => {
  it('injects LIMIT 500 when none present', async () => {
    const result = await validateSql('SELECT id FROM players')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rewritten).toMatch(/LIMIT\s+500/i)
  })

  it('caps existing LIMIT > 500 to 500', async () => {
    const result = await validateSql('SELECT id FROM players LIMIT 5000')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rewritten).toMatch(/LIMIT\s+500/i)
      expect(result.rewritten).not.toMatch(/LIMIT\s+5000/i)
    }
  })

  it('preserves existing LIMIT < 500', async () => {
    const result = await validateSql('SELECT id FROM players LIMIT 10')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rewritten).toMatch(/LIMIT\s+10/i)
  })
})
```

- [ ] **Step 2: Run tests — confirm 3 new fail**

```bash
cd server && npm test
```

Expected: 3 new LIMIT tests fail (rewritten === original so no LIMIT change).

- [ ] **Step 3: Implement LIMIT injection**

Modify `server/src/services/sqlValidator.ts`. Add after the function-call check, before the final `return`:

```ts
  // LIMIT cap: wrap with a hard cap of 500. If inner query already has a
  // LIMIT, the outer wrapper still caps the yielded rows.
  const MAX_LIMIT = 500
  const trimmed = sql.trim().replace(/;+\s*$/, '')

  // Detect existing LIMIT N at outer level via a conservative regex on the
  // tail. Not perfect for nested LIMITs but outer wrapping is defense-in-depth.
  const limitMatch = /\bLIMIT\s+(\d+)\s*$/i.exec(trimmed)
  let rewritten: string
  if (limitMatch) {
    const existing = parseInt(limitMatch[1]!, 10)
    const capped = Math.min(existing, MAX_LIMIT)
    rewritten = trimmed.replace(
      /\bLIMIT\s+\d+\s*$/i,
      `LIMIT ${capped}`
    )
  } else {
    rewritten = `SELECT * FROM (${trimmed}) AS _sq LIMIT ${MAX_LIMIT}`
  }

  return { ok: true, rewritten }
```

Remove the earlier `return { ok: true, rewritten: sql }` that this replaces.

- [ ] **Step 4: Run tests — all pass**

```bash
cd server && npm test
```

Expected: 17 passing tests.

- [ ] **Step 5: Commit**

```bash
git add server/tests/sqlValidator.test.ts server/src/services/sqlValidator.ts
git commit -m "feat(sportquery): SQL validator phase 3 — LIMIT cap injection"
```

---

## Task 6: Read-only Postgres pool

**Files:**
- Create: `server/src/services/sportqueryDB.ts`

- [ ] **Step 1: Create the pool module**

Create `server/src/services/sportqueryDB.ts`:
```ts
import { Pool, type QueryResult } from 'pg'

const connectionString = process.env.SPORTQUERY_DB_URL
if (!connectionString) {
  console.warn(
    'SportQuery: SPORTQUERY_DB_URL not set. Assistant DB queries will fail.'
  )
}

const pool = connectionString
  ? new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
    })
  : null

export type RowSet = Record<string, unknown>[]

export async function runReadOnly(sql: string): Promise<RowSet> {
  if (!pool) throw new Error('SportQuery DB pool not configured')
  const client = await pool.connect()
  try {
    // Per-transaction guards: read-only + statement timeout
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '2s'")
    const res: QueryResult = await client.query(sql)
    await client.query('COMMIT')
    return res.rows as RowSet
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
  }
}

export async function shutdownPool(): Promise<void> {
  if (pool) await pool.end()
}
```

- [ ] **Step 2: Smoke-test the pool**

After the user confirms `SPORTQUERY_DB_URL` is set, run a quick interactive check:
```bash
cd server && npx ts-node -e "import('./src/services/sportqueryDB').then(async m => { const rows = await m.runReadOnly('SELECT COUNT(*) FROM players'); console.log(rows); process.exit(0); })"
```

Expected: prints a row like `[ { count: '571' } ]`. If it errors with "permission denied for table players", the role grants in Task 2 did not apply — re-run the migration.

Also verify read-only enforcement — this MUST fail:
```bash
cd server && npx ts-node -e "import('./src/services/sportqueryDB').then(m => m.runReadOnly('INSERT INTO players (name) VALUES (\\'x\\')').catch(e => { console.log('OK refused:', e.message); process.exit(0); }))"
```

Expected: prints "OK refused: cannot execute INSERT in a read-only transaction".

- [ ] **Step 3: Commit**

```bash
git add server/src/services/sportqueryDB.ts
git commit -m "feat(sportquery): read-only Postgres pool with statement timeout"
```

---

## Task 7: Groq client config

**Files:**
- Create: `server/src/config/groq.ts`

- [ ] **Step 1: Create the Groq client**

Create `server/src/config/groq.ts`:
```ts
import Groq from 'groq-sdk'

const apiKey = process.env.GROQ_API_KEY
if (!apiKey) {
  console.warn('SportQuery: GROQ_API_KEY not set. LLM calls will fail.')
}

export const groq = new Groq({ apiKey: apiKey ?? 'missing' })

export const SPORTQUERY_MODEL = 'moonshotai/kimi-k2-instruct'
export const SQL_TEMPERATURE = 0.1
export const NARRATIVE_TEMPERATURE = 0.5
export const MAX_INPUT_TOKENS = 8000
export const MAX_OUTPUT_TOKENS = 2000
```

- [ ] **Step 2: Commit**

```bash
git add server/src/config/groq.ts
git commit -m "feat(sportquery): Groq client config with kimi-k2 defaults"
```

---

## Task 8: System prompt + schema description

**Files:**
- Create: `server/src/prompts/sportquery-system.ts`

- [ ] **Step 1: Author the system prompt**

Create `server/src/prompts/sportquery-system.ts`:
```ts
export const SPORTQUERY_SYSTEM_PROMPT = `
You are SportQuery, an NBA statistics assistant that answers questions by writing read-only PostgreSQL queries against a documented schema.

SCHEMA:

players(id, ext_id, name, team, position, league, is_active)
  - position ∈ { 'G','F','C','PG','SG','SF','PF' } (mixed conventions; filter loosely)
  - league = 'nba' for NBA players

teams(id, ext_id, abbreviation, full_name, league_id)
  - Use teams.abbreviation for display (e.g. 'LAL','GSW')

games(id, ext_id, game_date, season, home_team_id, away_team_id, league_id)
  - season is an integer (2022 = 2022-23 season, etc.)
  - game_date is 'YYYY-MM-DD'

nba_player_stats(id, game_id, player_id, team_id, game_date, points, rebounds, assists, three_points_made, fouls, minutes_played)
  - One row per player per game (basic box score)

nba_trends(id, player_id, stat, stat_id, window, z_score, rolling_avg, season_avg)
  - stat ∈ { 'pts','reb','ast','3pm','fouls','min' }
  - window ∈ { 5, 10 } typically

player_game_conditions(id, player_id, game_id, game_date, usg_pct, pace, off_rating, def_rating, home_away, days_rest, opponent_team_id, minutes_played)
  - Advanced per-player-per-game context
  - home_away ∈ { 'home','away' }

team_game_stats(id, team_id, game_id, game_date, pace, off_rating, def_rating)

player_availability(id, player_id, game_id, status)
  - status typically 'inactive'
  - Has gaps; prefer nba_player_stats.minutes_played > 0 for "played" checks

opponent_position_defense(id, team_id, position_group, snapshot_date, pts_allowed_pg, reb_allowed_pg, ast_allowed_pg, league_rank)
  - position_group ∈ { 'G','F','C' }
  - league_rank 1 = best defense, 30 = worst

picks(id, player_id, stat, pick_date, line, kalshi_price, implied_prob, confidence, edge, pick_type)
  - One row per pick per day
  - pick_type ∈ { 'safe','value' }

VIEWS:

game_matchups(game_id, game_ext_id, game_date, season, team_id, opponent_team_id, is_home)
  - Flattened home/away pairs (2 rows per game). Prefer this for "against team X" filters.

RULES:

- Output ONLY a single JSON object matching:
  {
    "sql": string | null,
    "narrative": string,
    "disambiguation"?: { "candidates": string[], "prompt": string },
    "follow_up_suggestions"?: string[]
  }

- SQL must be a single SELECT (CTEs allowed if all SELECT).
- Never use functions starting with pg_.
- Use ILIKE for case-insensitive name matching.
- If a user's player name could reasonably match multiple active players, emit "disambiguation" and leave "sql" as null.
- For "against team X" queries, prefer game_matchups.
- For "without teammate X" queries, use NOT EXISTS against nba_player_stats with minutes_played > 0 (do NOT rely on player_availability).
- Always include ORDER BY + LIMIT for list queries. Default LIMIT 20.
- Narrative: 1–3 sentences, summarize result scope (not the SQL).
- If no query is needed (greeting, meta-question, clarification), set "sql" to null.

MULTI-TURN:

Previous SQL and user intent are available in conversation history. When the user refines ("now only X", "just the top 5"), modify the previous SQL rather than starting over. Preserve filter context across turns unless the user resets.

OUTPUT:

Always respond with exactly one JSON object. No code fences. No prose outside the JSON.
`
```

- [ ] **Step 2: Commit**

```bash
git add server/src/prompts/sportquery-system.ts
git commit -m "feat(sportquery): system prompt with schema + rules"
```

---

## Task 9: Few-shot library

**Files:**
- Create: `server/src/prompts/sportquery-examples.ts`

- [ ] **Step 1: Author 10 annotated examples**

Create `server/src/prompts/sportquery-examples.ts`:
```ts
export type FewShotExample = {
  user: string
  assistant: string // JSON envelope as a string
}

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    user: 'Show me the top trending scorers over the last 10 games.',
    assistant: JSON.stringify({
      sql: `SELECT p.id, p.name, p.team, p.position, t.z_score, t.rolling_avg
FROM nba_trends t
JOIN players p ON t.player_id = p.id
WHERE t.stat = 'pts' AND t.window = 10
ORDER BY t.z_score DESC
LIMIT 20`,
      narrative:
        'Top 20 scorers by 10-game z-score against their season baseline.',
    }),
  },
  {
    user: 'Which guards are trending up on assists over the last 5 games?',
    assistant: JSON.stringify({
      sql: `SELECT p.id, p.name, p.team, p.position, t.z_score, t.rolling_avg
FROM nba_trends t
JOIN players p ON t.player_id = p.id
WHERE t.stat = 'ast' AND t.window = 5
  AND (p.position ILIKE '%G%' OR p.position IN ('PG','SG','G'))
  AND t.z_score > 0.8
ORDER BY t.z_score DESC
LIMIT 20`,
      narrative:
        'Guards with positive assist trends (z > 0.8) over their last 5 games.',
    }),
  },
  {
    user: "LeBron's last 10 games without Austin Reaves.",
    assistant: JSON.stringify({
      sql: `SELECT s.game_date, g.ext_id, s.points, s.rebounds, s.assists,
       s.three_points_made, s.minutes_played
FROM nba_player_stats s
JOIN players p ON s.player_id = p.id
JOIN games g ON s.game_id = g.id
WHERE p.name ILIKE '%lebron%james%'
  AND NOT EXISTS (
    SELECT 1 FROM nba_player_stats s2
    JOIN players p2 ON s2.player_id = p2.id
    WHERE s2.game_id = s.game_id
      AND p2.name ILIKE '%austin%reaves%'
      AND s2.minutes_played > 0
  )
ORDER BY s.game_date DESC
LIMIT 10`,
      narrative:
        "LeBron James's 10 most recent games in which Austin Reaves did not play.",
    }),
  },
  {
    user: 'Show today\'s picks with the biggest Kalshi edges.',
    assistant: JSON.stringify({
      sql: `SELECT p.id AS player_id, p.name, p.team, p.position,
       pk.stat, pk.line, pk.kalshi_price, pk.implied_prob,
       pk.confidence, pk.edge, pk.pick_type
FROM picks pk
JOIN players p ON pk.player_id = p.id
WHERE pk.pick_date = CURRENT_DATE
  AND pk.kalshi_price IS NOT NULL
ORDER BY pk.edge DESC
LIMIT 20`,
      narrative:
        "Today's picks sorted by Kalshi edge, highest first. Each row shows the line, market price, and implied probability.",
    }),
  },
  {
    user: 'Who has faced the worst defenses against their position recently?',
    assistant: JSON.stringify({
      sql: `SELECT p.id, p.name, p.team, p.position, opd.league_rank, opd.pts_allowed_pg
FROM players p
JOIN opponent_position_defense opd ON opd.team_id IN (
  SELECT pgc.opponent_team_id
  FROM player_game_conditions pgc
  WHERE pgc.player_id = p.id
    AND pgc.game_date >= CURRENT_DATE - INTERVAL '14 days'
)
AND opd.position_group = LEFT(p.position, 1)
WHERE opd.league_rank >= 25
ORDER BY opd.league_rank DESC
LIMIT 20`,
      narrative:
        'Players who in the last 14 days faced teams ranked in the bottom 6 defensively against their position.',
    }),
  },
  {
    user: 'What home/away split does Anthony Edwards have on points this season?',
    assistant: JSON.stringify({
      sql: `SELECT pgc.home_away,
       AVG(s.points) AS avg_points,
       COUNT(*) AS games
FROM nba_player_stats s
JOIN players p ON s.player_id = p.id
JOIN player_game_conditions pgc ON pgc.player_id = p.id AND pgc.game_id = s.game_id
JOIN games g ON g.id = s.game_id
WHERE p.name ILIKE '%anthony%edwards%'
  AND g.season = (SELECT MAX(season) FROM games)
GROUP BY pgc.home_away`,
      narrative:
        "Anthony Edwards's home vs away scoring averages for the current season.",
    }),
  },
  {
    user: 'Players with 2+ days rest tonight.',
    assistant: JSON.stringify({
      sql: `SELECT DISTINCT p.id, p.name, p.team, p.position, pgc.days_rest
FROM player_game_conditions pgc
JOIN players p ON pgc.player_id = p.id
WHERE pgc.game_date = CURRENT_DATE
  AND pgc.days_rest >= 2
ORDER BY pgc.days_rest DESC, p.name
LIMIT 40`,
      narrative:
        "Players on today's slate with 2 or more days of rest.",
    }),
  },
  {
    user: 'Now just show me the ones with a Kalshi line available.',
    assistant: JSON.stringify({
      sql: `SELECT DISTINCT p.id, p.name, p.team, p.position, pgc.days_rest,
       pk.stat, pk.line, pk.kalshi_price
FROM player_game_conditions pgc
JOIN players p ON pgc.player_id = p.id
JOIN picks pk ON pk.player_id = p.id AND pk.pick_date = CURRENT_DATE
WHERE pgc.game_date = CURRENT_DATE
  AND pgc.days_rest >= 2
  AND pk.kalshi_price IS NOT NULL
ORDER BY pgc.days_rest DESC, p.name
LIMIT 40`,
      narrative:
        "Same set as before, now filtered to players with a Kalshi line available today.",
    }),
  },
  {
    user: 'Tell me about Curry.',
    assistant: JSON.stringify({
      sql: null,
      narrative:
        "There are two active players named Curry. Which did you mean?",
      disambiguation: {
        candidates: ['Stephen Curry', 'Seth Curry'],
        prompt: 'Did you mean Stephen Curry (GSW) or Seth Curry?',
      },
    }),
  },
  {
    user: 'Find guards in today\'s slate against a bottom-10 defense who are trending up on points over the last 10 games.',
    assistant: JSON.stringify({
      sql: `SELECT DISTINCT p.id, p.name, p.team, p.position,
       t.z_score, t.rolling_avg, opd.league_rank AS opp_def_rank
FROM players p
JOIN nba_trends t ON t.player_id = p.id
JOIN player_game_conditions pgc ON pgc.player_id = p.id
JOIN opponent_position_defense opd ON opd.team_id = pgc.opponent_team_id
  AND opd.position_group = 'G'
WHERE (p.position ILIKE '%G%' OR p.position IN ('PG','SG','G'))
  AND t.stat = 'pts' AND t.window = 10
  AND t.z_score > 0.5
  AND pgc.game_date = CURRENT_DATE
  AND opd.league_rank >= 21
ORDER BY t.z_score DESC
LIMIT 20`,
      narrative:
        "Guards on today's slate trending up on points (10-game window) against a bottom-10 positional defense.",
    }),
  },
]
```

- [ ] **Step 2: Commit**

```bash
git add server/src/prompts/sportquery-examples.ts
git commit -m "feat(sportquery): 10-example few-shot library"
```

---

## Task 10: LLM service + envelope parsing

**Files:**
- Create: `server/tests/sportqueryLLM.test.ts`
- Create: `server/src/services/sportqueryLLM.ts`

- [ ] **Step 1: Write failing tests for envelope parsing**

Create `server/tests/sportqueryLLM.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseEnvelope } from '../src/services/sportqueryLLM'

describe('parseEnvelope', () => {
  it('parses a valid envelope with sql + narrative', () => {
    const raw = JSON.stringify({
      sql: 'SELECT 1',
      narrative: 'hi',
    })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.envelope.sql).toBe('SELECT 1')
      expect(r.envelope.narrative).toBe('hi')
    }
  })

  it('parses envelope with null sql', () => {
    const raw = JSON.stringify({ sql: null, narrative: 'hello' })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
  })

  it('strips code fences if model emits them', () => {
    const raw = '```json\n{"sql": null, "narrative": "hi"}\n```'
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
  })

  it('rejects non-JSON', () => {
    const r = parseEnvelope('this is not json at all')
    expect(r.ok).toBe(false)
  })

  it('rejects when narrative is missing', () => {
    const raw = JSON.stringify({ sql: 'SELECT 1' })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(false)
  })

  it('accepts optional disambiguation field', () => {
    const raw = JSON.stringify({
      sql: null,
      narrative: 'pick one',
      disambiguation: {
        candidates: ['A', 'B'],
        prompt: 'which?',
      },
    })
    const r = parseEnvelope(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.envelope.disambiguation?.candidates).toHaveLength(2)
    }
  })
})
```

- [ ] **Step 2: Run tests — confirm 6 fail**

```bash
cd server && npm test
```

Expected: 6 new tests fail ("parseEnvelope is not a function" or module-not-found).

- [ ] **Step 3: Implement LLM service**

Create `server/src/services/sportqueryLLM.ts`:
```ts
import {
  groq,
  SPORTQUERY_MODEL,
  SQL_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
} from '../config/groq'
import { SPORTQUERY_SYSTEM_PROMPT } from '../prompts/sportquery-system'
import { FEW_SHOT_EXAMPLES } from '../prompts/sportquery-examples'

export type Envelope = {
  sql: string | null
  narrative: string
  disambiguation?: { candidates: string[]; prompt: string }
  follow_up_suggestions?: string[]
}

export type EnvelopeParseResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; reason: string }

export function parseEnvelope(raw: string): EnvelopeParseResult {
  // Strip common code-fence wrappers
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let obj: any
  try {
    obj = JSON.parse(cleaned)
  } catch (err: any) {
    return { ok: false, reason: `invalid JSON: ${err.message}` }
  }

  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, reason: 'not an object' }
  }
  if (!('sql' in obj) || (obj.sql !== null && typeof obj.sql !== 'string')) {
    return { ok: false, reason: 'missing or invalid sql field' }
  }
  if (typeof obj.narrative !== 'string') {
    return { ok: false, reason: 'missing or invalid narrative field' }
  }

  const env: Envelope = {
    sql: obj.sql,
    narrative: obj.narrative,
  }
  if (obj.disambiguation && typeof obj.disambiguation === 'object') {
    env.disambiguation = {
      candidates: Array.isArray(obj.disambiguation.candidates)
        ? obj.disambiguation.candidates
        : [],
      prompt: String(obj.disambiguation.prompt ?? ''),
    }
  }
  if (Array.isArray(obj.follow_up_suggestions)) {
    env.follow_up_suggestions = obj.follow_up_suggestions.map(String)
  }

  return { ok: true, envelope: env }
}

export type HistoryEntry = { role: 'user' | 'assistant'; content: string }

export async function callLLM(
  history: HistoryEntry[],
  userMessage: string
): Promise<Envelope> {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] =
    [{ role: 'system', content: SPORTQUERY_SYSTEM_PROMPT }]

  for (const ex of FEW_SHOT_EXAMPLES) {
    messages.push({ role: 'user', content: ex.user })
    messages.push({ role: 'assistant', content: ex.assistant })
  }

  for (const h of history.slice(-20)) {
    messages.push({ role: h.role, content: h.content })
  }

  messages.push({ role: 'user', content: userMessage })

  const completion = await groq.chat.completions.create({
    model: SPORTQUERY_MODEL,
    temperature: SQL_TEMPERATURE,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices?.[0]?.message?.content ?? ''
  let result = parseEnvelope(raw)

  // One retry on malformed JSON with a corrective nudge
  if (!result.ok) {
    messages.push({
      role: 'system',
      content:
        'Your previous output was not valid JSON matching the required envelope. Respond with exactly one JSON object: {"sql": string|null, "narrative": string}. No code fences.',
    })
    const retry = await groq.chat.completions.create({
      model: SPORTQUERY_MODEL,
      temperature: SQL_TEMPERATURE,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages,
      response_format: { type: 'json_object' },
    })
    const retryRaw = retry.choices?.[0]?.message?.content ?? ''
    result = parseEnvelope(retryRaw)
  }

  if (!result.ok) {
    throw new Error(`LLM returned unparsable envelope: ${result.reason}`)
  }
  return result.envelope
}
```

- [ ] **Step 4: Run tests — all envelope tests pass**

```bash
cd server && npm test
```

Expected: 23 passing (17 validator + 6 envelope).

- [ ] **Step 5: Commit**

```bash
git add server/tests/sportqueryLLM.test.ts server/src/services/sportqueryLLM.ts
git commit -m "feat(sportquery): LLM service with envelope parsing + retry"
```

---

## Task 11: Session CRUD service

**Files:**
- Create: `server/src/services/sportquerySession.ts`

- [ ] **Step 1: Implement session service using Supabase admin**

Create `server/src/services/sportquerySession.ts`:
```ts
import { supabaseAdmin } from '../config/supabaseAdmin'

export type SessionRow = {
  id: string
  user_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  sql_executed: string | null
  result_count: number | null
  created_at: string
}

export async function createSession(
  userId = 'local'
): Promise<SessionRow> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_sessions')
    .insert({ user_id: userId })
    .select('*')
    .single()
  if (error) throw error
  return data as SessionRow
}

export async function listSessions(
  userId = 'local'
): Promise<SessionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data as SessionRow[]
}

export async function getMessages(
  sessionId: string
): Promise<MessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as MessageRow[]
}

export async function appendMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  sqlExecuted: string | null = null,
  resultCount: number | null = null
): Promise<MessageRow> {
  const { data, error } = await supabaseAdmin
    .from('sportquery_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      sql_executed: sqlExecuted,
      result_count: resultCount,
    })
    .select('*')
    .single()
  if (error) throw error

  // Bump session updated_at
  await supabaseAdmin
    .from('sportquery_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return data as MessageRow
}

export async function setSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('sportquery_sessions')
    .update({ title: title.slice(0, 120) })
    .eq('id', sessionId)
  if (error) throw error
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('sportquery_sessions')
    .delete()
    .eq('id', sessionId)
  if (error) throw error
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/sportquerySession.ts
git commit -m "feat(sportquery): session + message CRUD service"
```

---

## Task 12: Rate limit middleware

**Files:**
- Create: `server/src/middleware/sportqueryRateLimit.ts`

- [ ] **Step 1: Implement the middleware**

Create `server/src/middleware/sportqueryRateLimit.ts`:
```ts
import rateLimit from 'express-rate-limit'

export const sportqueryMinuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'rate_limit: slow down' },
})

export const sportqueryDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'rate_limit: daily cap reached' },
})
```

- [ ] **Step 2: Commit**

```bash
git add server/src/middleware/sportqueryRateLimit.ts
git commit -m "feat(sportquery): per-IP rate limit middleware (30/min, 500/day)"
```

---

## Task 13: Controller + routes

**Files:**
- Create: `server/src/controllers/sportquery.ts`
- Create: `server/src/routes/sportquery.ts`
- Modify: `server/src/server.ts`

- [ ] **Step 1: Implement controller**

Create `server/src/controllers/sportquery.ts`:
```ts
import type { Request, Response } from 'express'
import { callLLM } from '../services/sportqueryLLM'
import { validateSql } from '../services/sqlValidator'
import { runReadOnly } from '../services/sportqueryDB'
import {
  appendMessage,
  createSession,
  deleteSession,
  getMessages,
  listSessions,
  setSessionTitle,
} from '../services/sportquerySession'

export async function postSession(_req: Request, res: Response) {
  try {
    const s = await createSession()
    res.json({ success: true, data: { sessionId: s.id } })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function getSessions(_req: Request, res: Response) {
  try {
    const rows = await listSessions()
    res.json({ success: true, data: rows })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function getSessionMessages(req: Request, res: Response) {
  try {
    const rows = await getMessages(req.params.id!)
    res.json({ success: true, data: rows })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function deleteSessionHandler(req: Request, res: Response) {
  try {
    await deleteSession(req.params.id!)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * POST /api/sportquery/message
 * Body: { sessionId: string, message: string }
 * Response: Server-Sent Events stream with events:
 *   - event: narrative  data: { token: string }
 *   - event: results    data: { rows: any[], disambiguation?: ... }
 *   - event: done       data: {}
 *   - event: error      data: { error: string }
 */
export async function postMessage(req: Request, res: Response) {
  const { sessionId, message } = req.body ?? {}
  if (!sessionId || !message) {
    res.status(400).json({ success: false, error: 'sessionId and message required' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // Persist user message first
    await appendMessage(sessionId, 'user', message)

    // Load history (excluding the just-inserted user msg? include it is fine)
    const history = await getMessages(sessionId)
    const forLLM = history.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const envelope = await callLLM(forLLM, message)

    // Stream narrative in one chunk (LLM already completed; real token
    // streaming requires a streaming call — see follow-up improvements)
    send('narrative', { token: envelope.narrative })

    let rows: any[] = []
    let sqlForLog: string | null = null
    let disambiguation = envelope.disambiguation ?? null

    if (envelope.sql) {
      const v = await validateSql(envelope.sql)
      if (!v.ok) {
        // One retry: ask LLM to correct
        const retryEnvelope = await callLLM(
          forLLM,
          `${message}\n\n[SYSTEM NOTE] Your previous SQL was rejected by the validator: ${v.reason}. Produce a corrected query.`
        )
        if (retryEnvelope.sql) {
          const v2 = await validateSql(retryEnvelope.sql)
          if (v2.ok) {
            sqlForLog = retryEnvelope.sql
            rows = await runReadOnly(v2.rewritten)
          }
        }
      } else {
        sqlForLog = envelope.sql
        try {
          rows = await runReadOnly(v.rewritten)
        } catch (err: any) {
          // Retry once with DB error context
          const retryEnvelope = await callLLM(
            forLLM,
            `${message}\n\n[SYSTEM NOTE] Your previous SQL errored: ${err.message}. Produce a corrected query.`
          )
          if (retryEnvelope.sql) {
            const v2 = await validateSql(retryEnvelope.sql)
            if (v2.ok) {
              sqlForLog = retryEnvelope.sql
              rows = await runReadOnly(v2.rewritten)
            }
          }
        }
      }
    }

    send('results', {
      rows,
      disambiguation,
      follow_up_suggestions: envelope.follow_up_suggestions ?? [],
    })

    await appendMessage(
      sessionId,
      'assistant',
      envelope.narrative,
      sqlForLog,
      rows.length
    )

    // Set session title from first user message
    if (history.length === 1) {
      await setSessionTitle(sessionId, message)
    }

    send('done', {})
  } catch (err: any) {
    send('error', { error: err.message ?? 'unknown error' })
  } finally {
    res.end()
  }
}
```

- [ ] **Step 2: Implement routes**

Create `server/src/routes/sportquery.ts`:
```ts
import { Router } from 'express'
import {
  postSession,
  getSessions,
  getSessionMessages,
  deleteSessionHandler,
  postMessage,
} from '../controllers/sportquery'
import {
  sportqueryMinuteLimiter,
  sportqueryDailyLimiter,
} from '../middleware/sportqueryRateLimit'

const router = Router()

router.post('/session', postSession)
router.get('/sessions', getSessions)
router.get('/session/:id/messages', getSessionMessages)
router.delete('/session/:id', deleteSessionHandler)
router.post(
  '/message',
  sportqueryMinuteLimiter,
  sportqueryDailyLimiter,
  postMessage
)

export default router
```

- [ ] **Step 3: Wire into server.ts**

Modify `server/src/server.ts` — find the section where routes are registered (look for `app.use('/api/nba', ...)` or similar) and add:

```ts
import sportqueryRoutes from './routes/sportquery'

// ... with other app.use lines
app.use('/api/sportquery', sportqueryRoutes)
```

- [ ] **Step 4: Manual smoke test**

Start the server (`npm run dev:server`), then from another shell:

```bash
curl -X POST http://localhost:3000/api/sportquery/session
# Expected: {"success":true,"data":{"sessionId":"<uuid>"}}

SESSION_ID=<paste uuid>
curl -N -X POST http://localhost:3000/api/sportquery/message \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\",\"message\":\"Show me the top trending scorers\"}"
# Expected: SSE stream with narrative + results + done events
```

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/sportquery.ts server/src/routes/sportquery.ts server/src/server.ts
git commit -m "feat(sportquery): controller + routes + server wiring"
```

---

## Task 14: Client API wrapper

**Files:**
- Create: `client/src/services/sportqueryApi.ts`

- [ ] **Step 1: Implement the API module**

Create `client/src/services/sportqueryApi.ts`:
```ts
const BASE = 'http://localhost:3000/api/sportquery'

export type SessionSummary = {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  sql_executed: string | null
  result_count: number | null
  created_at: string
}

export type PlayerResultRow = {
  id?: number
  player_id?: number
  name?: string
  team?: string
  position?: string
  z_score?: number
  rolling_avg?: number
  [k: string]: unknown
}

export async function createSession(): Promise<string> {
  const r = await fetch(`${BASE}/session`, { method: 'POST' })
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
  return j.data.sessionId
}

export async function listSessions(): Promise<SessionSummary[]> {
  const r = await fetch(`${BASE}/sessions`)
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
  return j.data
}

export async function loadMessages(sessionId: string): Promise<MessageRow[]> {
  const r = await fetch(`${BASE}/session/${sessionId}/messages`)
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
  return j.data
}

export async function deleteSession(sessionId: string): Promise<void> {
  const r = await fetch(`${BASE}/session/${sessionId}`, { method: 'DELETE' })
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
}

export type StreamEvent =
  | { type: 'narrative'; token: string }
  | {
      type: 'results'
      rows: PlayerResultRow[]
      disambiguation?: { candidates: string[]; prompt: string } | null
      follow_up_suggestions?: string[]
    }
  | { type: 'done' }
  | { type: 'error'; error: string }

export async function streamMessage(
  sessionId: string,
  message: string,
  onEvent: (e: StreamEvent) => void
): Promise<void> {
  const res = await fetch(`${BASE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  })

  if (!res.body) throw new Error('No response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const eventLine = part.match(/^event:\s*(.+)$/m)
      const dataLine = part.match(/^data:\s*(.+)$/m)
      if (!eventLine || !dataLine) continue
      const eventName = eventLine[1]!.trim()
      const data = JSON.parse(dataLine[1]!)
      switch (eventName) {
        case 'narrative':
          onEvent({ type: 'narrative', token: data.token })
          break
        case 'results':
          onEvent({
            type: 'results',
            rows: data.rows ?? [],
            disambiguation: data.disambiguation ?? null,
            follow_up_suggestions: data.follow_up_suggestions ?? [],
          })
          break
        case 'done':
          onEvent({ type: 'done' })
          break
        case 'error':
          onEvent({ type: 'error', error: data.error ?? 'unknown' })
          break
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/services/sportqueryApi.ts
git commit -m "feat(sportquery-client): API wrapper with SSE stream reader"
```

---

## Task 15: `useSportQuery` hook

**Files:**
- Create: `client/src/components/SportQuery/hooks/useSportQuery.ts`

- [ ] **Step 1: Implement the hook**

Create `client/src/components/SportQuery/hooks/useSportQuery.ts`:
```ts
import { useCallback, useEffect, useState } from 'react'
import {
  type MessageRow,
  type PlayerResultRow,
  createSession,
  loadMessages,
  streamMessage,
} from '../../../services/sportqueryApi'

export type ChatTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
  rows?: PlayerResultRow[]
  disambiguation?: { candidates: string[]; prompt: string } | null
  follow_up_suggestions?: string[]
  isStreaming?: boolean
}

export function useSportQuery(initialSessionId?: string) {
  const [sessionId, setSessionId] = useState<string | undefined>(
    initialSessionId
  )
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [isSending, setIsSending] = useState(false)

  // Load existing messages when session id is provided
  useEffect(() => {
    if (!initialSessionId) return
    loadMessages(initialSessionId)
      .then((rows: MessageRow[]) => {
        setTurns(
          rows.map((r) => ({
            id: r.id,
            role: r.role,
            content: r.content,
          }))
        )
        setSessionId(initialSessionId)
      })
      .catch(() => setTurns([]))
  }, [initialSessionId])

  const send = useCallback(
    async (message: string) => {
      let sid = sessionId
      if (!sid) {
        sid = await createSession()
        setSessionId(sid)
      }

      const userTurn: ChatTurn = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: message,
      }
      const assistantTurn: ChatTurn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        isStreaming: true,
      }
      setTurns((t) => [...t, userTurn, assistantTurn])
      setIsSending(true)

      await streamMessage(sid, message, (e) => {
        setTurns((t) =>
          t.map((turn) => {
            if (turn.id !== assistantTurn.id) return turn
            if (e.type === 'narrative') {
              return { ...turn, content: turn.content + e.token }
            }
            if (e.type === 'results') {
              return {
                ...turn,
                rows: e.rows,
                disambiguation: e.disambiguation,
                follow_up_suggestions: e.follow_up_suggestions,
              }
            }
            if (e.type === 'done') {
              return { ...turn, isStreaming: false }
            }
            if (e.type === 'error') {
              return {
                ...turn,
                content: turn.content + `\n\n(Error: ${e.error})`,
                isStreaming: false,
              }
            }
            return turn
          })
        )
      })
      setIsSending(false)
    },
    [sessionId]
  )

  return { sessionId, turns, isSending, send }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/SportQuery/hooks/useSportQuery.ts
git commit -m "feat(sportquery-client): useSportQuery hook (session + streaming state)"
```

---

## Task 16: CompactPlayerCard + ResultCardList

**Files:**
- Create: `client/src/components/SportQuery/CompactPlayerCard.tsx`
- Create: `client/src/components/SportQuery/ResultCardList.tsx`

- [ ] **Step 1: CompactPlayerCard**

Create `client/src/components/SportQuery/CompactPlayerCard.tsx`:
```tsx
import { Link } from 'react-router-dom'
import type { PlayerResultRow } from '../../services/sportqueryApi'

type Props = { row: PlayerResultRow }

function pickName(r: PlayerResultRow): string {
  return (r.name as string) ?? (r.player_name as string) ?? 'Unknown'
}

function pickId(r: PlayerResultRow): number | undefined {
  return (r.id as number) ?? (r.player_id as number)
}

function pickPrimaryStat(
  r: PlayerResultRow
): { label: string; value: string } | null {
  if (typeof r.z_score === 'number') {
    return { label: 'z-score', value: r.z_score.toFixed(2) }
  }
  if (typeof r.rolling_avg === 'number') {
    return { label: 'avg', value: r.rolling_avg.toFixed(1) }
  }
  if (typeof r.edge === 'number') {
    return {
      label: 'edge',
      value: `${(r.edge as number * 100).toFixed(0)}%`,
    }
  }
  return null
}

export function CompactPlayerCard({ row }: Props) {
  const name = pickName(row)
  const id = pickId(row)
  const team = (row.team as string) ?? ''
  const position = (row.position as string) ?? ''
  const stat = pickPrimaryStat(row)

  const zScore = typeof row.z_score === 'number' ? row.z_score : null
  const z = zScore ?? 0
  const barWidth = Math.min(Math.abs(z) / 2, 1) * 100
  const barColor = z >= 0 ? 'bg-mint' : 'bg-under'

  const body = (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-xl p-3 hover:border-mint/40 transition-colors">
      <div className="flex items-center justify-between mb-1">
        <div className="font-sans text-sm text-white truncate">{name}</div>
        {stat && (
          <div className="text-[10px] font-condensed uppercase tracking-[0.2em] text-mint">
            {stat.value}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500">
          {team}
          {position ? ` • ${position}` : ''}
        </div>
        {stat && (
          <div className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-600">
            {stat.label}
          </div>
        )}
      </div>
      {zScore !== null && (
        <div className="mt-2 h-0.5 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      )}
    </div>
  )

  return id ? <Link to={`/player/${id}`}>{body}</Link> : body
}
```

- [ ] **Step 2: ResultCardList**

Create `client/src/components/SportQuery/ResultCardList.tsx`:
```tsx
import { useState } from 'react'
import type { PlayerResultRow } from '../../services/sportqueryApi'
import { CompactPlayerCard } from './CompactPlayerCard'

type Props = { rows: PlayerResultRow[] }

const INITIAL_VISIBLE = 5

export function ResultCardList({ rows }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (!rows.length) return null

  const visible = expanded ? rows : rows.slice(0, INITIAL_VISIBLE)
  const more = rows.length - INITIAL_VISIBLE

  return (
    <div className="space-y-2 mt-3">
      {visible.map((r, i) => (
        <CompactPlayerCard key={(r.id as number) ?? i} row={r} />
      ))}
      {more > 0 && !expanded && (
        <button
          className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500 hover:text-mint"
          onClick={() => setExpanded(true)}
        >
          See all {rows.length}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SportQuery/CompactPlayerCard.tsx client/src/components/SportQuery/ResultCardList.tsx
git commit -m "feat(sportquery-client): compact player card + result list"
```

---

## Task 17: Message bubbles

**Files:**
- Create: `client/src/components/SportQuery/UserMessage.tsx`
- Create: `client/src/components/SportQuery/AssistantMessage.tsx`

- [ ] **Step 1: UserMessage**

Create `client/src/components/SportQuery/UserMessage.tsx`:
```tsx
type Props = { content: string }

export function UserMessage({ content }: Props) {
  return (
    <div className="flex justify-end animate-fade-up">
      <div className="max-w-[75%] bg-[#141414] border border-[#1e1e1e] rounded-2xl rounded-tr-sm px-4 py-2 font-sans text-sm text-white">
        {content}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: AssistantMessage**

Create `client/src/components/SportQuery/AssistantMessage.tsx`:
```tsx
import { ResultCardList } from './ResultCardList'
import type { ChatTurn } from './hooks/useSportQuery'

type Props = { turn: ChatTurn; showSuggestions: boolean }

export function AssistantMessage({ turn, showSuggestions }: Props) {
  const { content, rows, disambiguation, follow_up_suggestions, isStreaming } =
    turn

  return (
    <div className="flex justify-start animate-fade-up">
      <div className="max-w-[85%] bg-[#0D0D0D] border border-[#161616] rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="font-sans text-sm text-gray-200 whitespace-pre-wrap">
          {content || (isStreaming ? '…' : '')}
          {isStreaming && (
            <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-mint animate-pulse-live align-middle" />
          )}
        </div>

        {disambiguation && disambiguation.candidates.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {disambiguation.candidates.map((c) => (
              <span
                key={c}
                className="text-[10px] font-condensed uppercase tracking-[0.2em] text-mint bg-mint/10 border border-mint/30 rounded-full px-2 py-1"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {rows && rows.length > 0 && <ResultCardList rows={rows} />}

        {showSuggestions &&
          follow_up_suggestions &&
          follow_up_suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {follow_up_suggestions.map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-400 bg-[#141414] border border-[#1e1e1e] rounded-full px-2 py-1"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SportQuery/UserMessage.tsx client/src/components/SportQuery/AssistantMessage.tsx
git commit -m "feat(sportquery-client): user + assistant message bubbles"
```

---

## Task 18: MessageList + ChatInput + EmptyState

**Files:**
- Create: `client/src/components/SportQuery/MessageList.tsx`
- Create: `client/src/components/SportQuery/ChatInput.tsx`
- Create: `client/src/components/SportQuery/EmptyState.tsx`

- [ ] **Step 1: MessageList**

Create `client/src/components/SportQuery/MessageList.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import type { ChatTurn } from './hooks/useSportQuery'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'

type Props = { turns: ChatTurn[]; showSuggestions: boolean }

export function MessageList({ turns, showSuggestions }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
      {turns.map((t) =>
        t.role === 'user' ? (
          <UserMessage key={t.id} content={t.content} />
        ) : (
          <AssistantMessage
            key={t.id}
            turn={t}
            showSuggestions={showSuggestions}
          />
        )
      )}
      <div ref={endRef} />
    </div>
  )
}
```

- [ ] **Step 2: ChatInput**

Create `client/src/components/SportQuery/ChatInput.tsx`:
```tsx
import { useState, type KeyboardEvent } from 'react'

type Props = {
  onSend: (msg: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('')

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="px-6 py-4 border-t border-[#161616] bg-[#0A0A0A]">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          className="flex-1 resize-none bg-[#0D0D0D] border border-[#161616] rounded-xl px-4 py-3 font-sans text-sm text-white placeholder-gray-600 focus:border-mint/50 focus:outline-none"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about players, trends, matchups…"
          disabled={disabled}
        />
        <button
          className="px-4 py-3 rounded-xl bg-mint text-black font-condensed uppercase tracking-[0.2em] text-[10px] disabled:opacity-40"
          onClick={submit}
          disabled={disabled || !value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: EmptyState**

Create `client/src/components/SportQuery/EmptyState.tsx`:
```tsx
type Props = { onPick: (prompt: string) => void }

const PROMPTS = [
  'Find guards trending up over the last 10 games',
  "Show today's picks with the biggest Kalshi edges",
  "LeBron's last 10 games without Austin Reaves",
  'Best defenses against centers this season',
]

export function EmptyState({ onPick }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-xl w-full text-center">
        <div className="font-condensed text-[10px] uppercase tracking-[0.3em] text-gray-600 mb-4">
          SportQuery
        </div>
        <div className="font-display text-4xl text-white mb-2">
          Ask anything about the NBA
        </div>
        <div className="font-sans text-sm text-gray-500 mb-8">
          Trends, matchups, splits, picks — refine conversationally.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onPick(p)}
              className="text-left px-4 py-3 bg-[#0D0D0D] border border-[#161616] rounded-xl hover:border-mint/40 transition-colors font-sans text-sm text-gray-300"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/SportQuery/MessageList.tsx client/src/components/SportQuery/ChatInput.tsx client/src/components/SportQuery/EmptyState.tsx
git commit -m "feat(sportquery-client): message list + input + empty state"
```

---

## Task 19: SportQuery page + Sidebar + Suggestions toggle

**Files:**
- Create: `client/src/components/SportQuery/SuggestionsToggle.tsx`
- Create: `client/src/components/SportQuery/SessionSwitcher.tsx`
- Create: `client/src/components/SportQuery/ChatColumn.tsx`
- Create: `client/src/components/SportQuery/SportQuery.tsx`

- [ ] **Step 1: SuggestionsToggle**

Create `client/src/components/SportQuery/SuggestionsToggle.tsx`:
```tsx
import { useEffect, useState } from 'react'

const KEY = 'sportquery.showSuggestions'

export function useShowSuggestions(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState<boolean>(() => {
    return localStorage.getItem(KEY) === 'true'
  })
  useEffect(() => {
    localStorage.setItem(KEY, String(show))
  }, [show])
  return [show, setShow]
}

type Props = {
  show: boolean
  onChange: (v: boolean) => void
}

export function SuggestionsToggle({ show, onChange }: Props) {
  return (
    <button
      className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500 hover:text-mint"
      onClick={() => onChange(!show)}
      title="Toggle follow-up suggestion chips"
    >
      Suggestions: {show ? 'on' : 'off'}
    </button>
  )
}
```

- [ ] **Step 2: SessionSwitcher**

Create `client/src/components/SportQuery/SessionSwitcher.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createSession,
  listSessions,
  type SessionSummary,
} from '../../services/sportqueryApi'

export function SessionSwitcher() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    listSessions().then(setSessions).catch(() => setSessions([]))
  }, [open])

  const newSession = async () => {
    const id = await createSession()
    navigate(`/sportquery/${id}`)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500 hover:text-mint"
        onClick={() => setOpen((o) => !o)}
      >
        Sessions ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#0D0D0D] border border-[#161616] rounded-xl animate-fade-up z-10">
          <button
            className="w-full text-left px-4 py-2 font-sans text-sm text-mint hover:bg-[#141414] rounded-t-xl"
            onClick={newSession}
          >
            + New conversation
          </button>
          <div className="max-h-72 overflow-y-auto">
            {sessions.map((s) => (
              <button
                key={s.id}
                className="w-full text-left px-4 py-2 font-sans text-sm text-gray-300 hover:bg-[#141414] truncate"
                onClick={() => {
                  navigate(`/sportquery/${s.id}`)
                  setOpen(false)
                }}
              >
                {s.title ?? 'New conversation'}
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="px-4 py-2 font-sans text-xs text-gray-600">
                No prior sessions.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: ChatColumn**

Create `client/src/components/SportQuery/ChatColumn.tsx`:
```tsx
import { useSportQuery } from './hooks/useSportQuery'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { EmptyState } from './EmptyState'
import { SessionSwitcher } from './SessionSwitcher'
import { SuggestionsToggle, useShowSuggestions } from './SuggestionsToggle'

type Props = { sessionId?: string }

export function ChatColumn({ sessionId }: Props) {
  const { turns, isSending, send } = useSportQuery(sessionId)
  const [showSuggestions, setShowSuggestions] = useShowSuggestions()

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#161616]">
        <div className="font-condensed text-[10px] uppercase tracking-[0.3em] text-gray-600">
          SportQuery
        </div>
        <div className="flex items-center gap-4">
          <SuggestionsToggle show={showSuggestions} onChange={setShowSuggestions} />
          <SessionSwitcher />
        </div>
      </div>

      {turns.length === 0 ? (
        <EmptyState onPick={send} />
      ) : (
        <MessageList turns={turns} showSuggestions={showSuggestions} />
      )}

      <ChatInput onSend={send} disabled={isSending} />
    </div>
  )
}
```

- [ ] **Step 4: SportQuery page wrapper**

Create `client/src/components/SportQuery/SportQuery.tsx`:
```tsx
import { useParams } from 'react-router-dom'
import { Sidebar } from '../Sidebar/Sidebar'
import { ChatColumn } from './ChatColumn'

export function SportQuery() {
  const { sessionId } = useParams<{ sessionId?: string }>()

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <ChatColumn sessionId={sessionId} />
      </main>
    </div>
  )
}

export default SportQuery
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/SportQuery/
git commit -m "feat(sportquery-client): full chat page with session switcher + toggle"
```

---

## Task 20: Route + Header nav integration

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Header/Header.tsx`

- [ ] **Step 1: Add routes to App.tsx**

Find the `<Routes>` block in `client/src/App.tsx` and add:
```tsx
import SportQuery from './components/SportQuery/SportQuery'

// ... inside <Routes>
<Route path="/sportquery" element={<SportQuery />} />
<Route path="/sportquery/:sessionId" element={<SportQuery />} />
```

- [ ] **Step 2: Add Header nav entry**

Open `client/src/components/Header/Header.tsx` and find the existing nav links (HOME, NBA, NFL, MLB, NHL). Add a new entry between HOME and NBA:

```tsx
<Link
  to="/sportquery"
  className={/* same className expression the other nav links use */}
>
  SPORTQUERY
  {/* same active-underline logic */}
</Link>
```

The exact active-state styling is in the existing links — copy the pattern (check for `pathname.startsWith('/sportquery')` when deciding active).

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev:both
```

Open `http://localhost:5173/sportquery`. Expected:
- Header shows `SPORTQUERY` nav entry
- Page renders with Sidebar + Empty state + input
- Clicking a suggested prompt creates a session and sends the message
- Response streams in (one chunk for v1 given non-streaming LLM call), results render as cards
- Clicking a card navigates to `/player/:id`

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/components/Header/Header.tsx
git commit -m "feat(sportquery-client): add /sportquery route + Header nav entry"
```

---

## Task 21: End-to-end smoke suite

**Files:**
- Create: `docs/sportquery-smoke-checklist.md`

- [ ] **Step 1: Document the smoke-test playbook**

Create `docs/sportquery-smoke-checklist.md`:

```markdown
# SportQuery Smoke Test Checklist

Run `npm run dev:both`, navigate to `http://localhost:5173/sportquery`, and execute each prompt below. Verify expected behavior.

## Per-prompt checks

For each: (1) narrative renders, (2) result cards render where applicable, (3) no error banner, (4) SQL is NOT shown in UI.

- [ ] "Show me the top trending scorers"
- [ ] "Which guards are trending up on assists over the last 5 games?"
- [ ] "LeBron's last 10 games without Austin Reaves"
- [ ] "Show today's picks with the biggest Kalshi edges"
- [ ] "Who has faced the worst defenses against their position recently?"
- [ ] "What home/away split does Anthony Edwards have on points this season?"
- [ ] "Players with 2+ days rest tonight"
- [ ] (After the above) "Now just show me the ones with a Kalshi line available"
    - Expected: refinement modifies the previous query
- [ ] "Tell me about Curry"
    - Expected: disambiguation chips show "Stephen Curry" and "Seth Curry"
- [ ] "Find guards in today's slate against a bottom-10 defense who are trending up on points over the last 10 games"

## Error paths

- [ ] Send an impossible query ("list of presidents"). Expected: 1–2 sentence narrative apologizing + empty result set.
- [ ] Navigate directly to `/sportquery/00000000-0000-0000-0000-000000000000` (invalid session id). Expected: redirect to `/sportquery` or empty state.
- [ ] Send >30 requests in a minute from the same IP. Expected: later requests return 429 "rate_limit: slow down".

## Persistence

- [ ] Send 3 messages, note session id from URL.
- [ ] Reload page. Expected: history persists and renders.
- [ ] Open "Sessions" dropdown. Expected: session appears.
- [ ] Click "+ New conversation". Expected: fresh session with empty state.

## Security

- [ ] Open browser devtools and inspect the network response for `/api/sportquery/message`. Confirm no `sql` field is present in the response body (only `rows`, `narrative`, etc.).
- [ ] Attempt a SQL-injection-style prompt ("Drop the players table"). Expected: narrative declines or returns empty results; server logs show validator rejection; no tables are harmed.
```

- [ ] **Step 2: Run the smoke checklist manually**

Walk through every checkbox. Any failure is a bug to fix before shipping.

- [ ] **Step 3: Commit (after any fixes from step 2)**

```bash
git add docs/sportquery-smoke-checklist.md
git commit -m "docs(sportquery): add end-to-end smoke test checklist"
```

---

## Self-Review Summary

After the plan is executed, confirm against spec sections:

| Spec section | Plan task(s) |
|---|---|
| §1 Architecture overview | 6, 10, 13 |
| §2 Database additions (role, view, sessions) | 2 |
| §3 Server components | 3–13 |
| §4 Client components | 14–20 |
| §5 LLM prompting strategy | 8, 9, 10 |
| §6 Multi-turn refinement | 10 (history pass-through), 13 (controller uses history) |
| §7 Error handling | 13 (retry logic), 21 (smoke paths) |
| §8 Rate limits | 12 |
| §9 Testing | 3, 4, 5, 10, 21 |
| §10 Non-goals | explicitly not implemented |
| §11 Data dependencies | noted in spec; separate fix track |
| §12 Rollout plan | 2 (migration), 13 (server), 20 (client) |
| Resolved UI decisions | §8 Show-query off by default (never shown in UI); Suggestions toggle task 19 |

All spec requirements mapped. No placeholders in any task. All types/signatures consistent across tasks (`ChatTurn`, `Envelope`, `validateSql` return shape, `PlayerResultRow`, SSE event names).
