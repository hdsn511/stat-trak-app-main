# StatTrak Runbook

How to install, run, and keep the pipeline healthy. Covers both one-off setup and day-to-day operation.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node | 20+ | `node --version` |
| npm | 10+ | ships with Node |
| Python | 3.12 | required by `supabase-py` |
| git | any | |
| Supabase project | — | URL + service-role key |

On Windows, bash (Git Bash / WSL) is recommended for shell commands. PowerShell works too but paths differ.

---

## 2. One-time setup

```bash
# 1. Clone + install top-level deps
git clone <repo-url> stat-trak-app
cd stat-trak-app
npm install                    # installs root devDeps (concurrently, vitest)
npm install --prefix client
npm install --prefix server

# 2. Python venv + analytics deps
python -m venv venv
# Windows:
source venv/Scripts/activate
# Linux/macOS:
source venv/bin/activate
pip install -r analytics/requirements.txt
```

### 2.1 Environment variables

Create `server/.env`:

```ini
# Supabase (service role — full access; never expose to the client)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# OpenAI (optional — only used for some SportQuery paths)
OPENAI_API_KEY=sk-...

# Groq (used by SportQuery main path)
GROQ_API_KEY=gsk_...

# API-Sports
API_SPORTS_KEY=...

# Postgres direct (Supavisor pooler)
# Format: postgres://<user>.<project-ref>:<password>@aws-1-us-east-2.pooler.supabase.com:6543/postgres
DATABASE_URL=postgres://sportquery_app.<ref>:<pw>@aws-1-us-east-2.pooler.supabase.com:6543/postgres

PORT=3000

# Optional: override Python binary used by the in-server cron scheduler
# Defaults to repo's venv (venv/Scripts/python.exe on Windows, venv/bin/python on Unix)
# PYTHON_PATH=/custom/path/to/python
```

The Python analytics modules also read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `server/.env` via `python-dotenv`, so one env file covers everything.

### 2.2 Initial database population

New install — hydrate NBA data before anything else works:

```bash
source venv/Scripts/activate     # (once per shell)
python -m analytics.batch.backfill_season --since 2025-10-01
```

This walks every game date missing box scores and fetches them from the ESPN API (no `nba_api`, no rate limits). It is idempotent, so re-run it to resume. NHL/NFL: `python -m analytics.batch.nhl_init --rosters --season 2026` (and `nfl_init`).

Verify once done:

```bash
python server/scripts/check_missing_stats.py
```

---

## 3. Running the app

### 3.1 Dev mode — everything local

```bash
# From repo root — starts Vite (5173) + Express (3000) concurrently
npm run dev:both
```

Or split across two terminals:

```bash
# Terminal 1 — frontend
npm run dev                      # Vite on :5173

# Terminal 2 — backend + scheduler
npm run dev:server               # Nodemon, Express on :3000
```

Open http://localhost:5173. The backend at http://localhost:3000 serves API; `/health` is a no-auth check.

### 3.2 Production-style (same machine)

```bash
# Build client
npm run build                    # outputs client/dist

# Build + start server
cd server
npm run build                    # compiles TS to dist/
npm start                        # node dist/server.js
```

Serve the `client/dist` folder via any static host (nginx, Cloudflare Pages, Vercel, etc). The Express server runs the API + the in-process cron scheduler.

### 3.3 Production scheduling: GitHub Actions

Production data sync runs on GitHub Actions, **not** the in-process scheduler.
`server/src/server.ts` (local / PM2 entrypoint) calls `startScheduler()`
(`server/src/jobs/scheduler.ts`, node-cron); `server/src/lambda.ts` (what
`deploy-api.yml` builds via `build:lambda`) does not, and says so. So in
production the node-cron jobs never run; they only matter for a local or PM2
host. Do not run both against the same database.

| Workflow | Cron (UTC) | Purpose |
|----------|-----------|---------|
| `daily-data-sync.yml` | `0 11 * * *` | One daily sync. Job `data`: NFL/NHL ESPN ingest, MLB rosters + nightly (incl. reconcile) + enrich + trends, NBA nightly (incl. reconcile, backfill, conditions) + 7-day slate + trends, then the read-only freshness check. Job `picks`: MLB + NBA picks (never fails `data`). |
| `mlb-selfheal-picks.yml` | `0 13-23`, `0 0-4` | MLB picks only; adds newly opened Kalshi markets for not-yet-started games. |
| `injury-check.yml` | `0 14-23`, `0 0-3` | Injury check + pick invalidation (NBA, MLB). Early exit when no games or all games final. |
| `mlb-performance-report.yml` | `30 17 * * *` | Performance + calibration report (needs reconciled picks from the 11:00 sync). |

Manual run of one league: Actions -> Daily Data Sync -> Run workflow -> `league`.
Retired (manual-only): `nightly-pipeline`, `mlb-nightly-pipeline`,
`espn-nightly-ingest`, `reconcile-picks`, `mlb-reconcile-picks`.

Freshness: `python -m analytics.batch.freshness_check` (read-only). Fails if an
in-season league (any game within +/-3 days) has no final box score in 2 days;
off-season leagues pass.

### 3.4 Local node-cron scheduler (local / PM2 only)

`server/src/jobs/scheduler.ts` registers jobs via `node-cron` inside the Express
process started by `server.ts`. Jobs only run while that process is alive.

| Cron | What runs | Purpose |
|------|-----------|---------|
| `0 2 * * *` | `python -m analytics.batch.nightly --date <today>` | NBA slate + `daily_conditions` |
| `30 2 * * *` | `nightly --date <today+1..+7>` | Pre-fetch upcoming week |
| `0 3 * * *` | `python -m analytics.picks.generate --date <today>` | NBA picks |
| `0 10-23 * * *` | `injury_check --date <today>` | Injury check |
| `0 12 * * *` | `nightly --date <yesterday>` | Reconcile |

Times are server-local. See `scheduler.ts` for the authoritative list.

### 3.5 Alternative: system cron (if you don't want the server running 24/7)

Local/self-hosted only (production uses GitHub Actions, 3.3). The scheduler is just a convenience wrapper. You can instead run the Python modules directly from system cron:

```crontab
# /etc/cron.d/stat-trak (Linux)
0 2 * * * cd /path/to/repo && ./venv/bin/python -m analytics.batch.nightly --date $(date -I) >> /var/log/stat-trak/nightly.log 2>&1
30 2 * * * cd /path/to/repo && for i in 1 2 3 4 5 6 7; do ./venv/bin/python -m analytics.batch.nightly --date $(date -d "+$i days" -I); done >> /var/log/stat-trak/slate.log 2>&1
0 3 * * * cd /path/to/repo && ./venv/bin/python -m analytics.picks.generate --date $(date -I) >> /var/log/stat-trak/picks.log 2>&1
0 10-23 * * * cd /path/to/repo && ./venv/bin/python -m analytics.batch.injury_check --date $(date -I) >> /var/log/stat-trak/injury.log 2>&1
0 12 * * * cd /path/to/repo && ./venv/bin/python -m analytics.batch.nightly --date $(date -d "yesterday" -I) >> /var/log/stat-trak/reconcile.log 2>&1
```

Windows: use Task Scheduler to invoke the same commands (one task per job).

---

## 4. Manual / one-off commands

### Catch up missed cron runs

If the server was down for days and `games` is missing rows, run nightly for each missing date:

```bash
source venv/Scripts/activate
for date in 2026-04-22 2026-04-23 2026-04-25 2026-04-26 2026-04-27; do
  python -m analytics.batch.nightly --date $date
done
```

### Generate picks for a specific date

```bash
python -m analytics.picks.generate --date 2026-04-25           # live Kalshi
python -m analytics.picks.generate --date 2026-04-25 --mock    # mock Kalshi (no API key needed)
```

### Re-check a specific backtest

```bash
python -m analytics.engine.backtest --player-id 1 --stat pts --line 25.5 --date 2026-04-25
python -m analytics.engine.backtest --game-id 501 --prop-type winner --date 2026-04-25
```

### Game model self-test (math only, no DB)

```bash
python -m analytics.engine.game_model
# Expect: "game_model.py self-test PASSED"
```

### SportQuery smoke test

See `docs/sportquery-smoke-checklist.md` for the end-to-end test flow via the client UI.

### Compute trends (server-side TypeScript job)

The `computeNBATrends.ts` job in `server/src/jobs/` populates the `nba_trends` table. It isn't currently in the cron schedule — run manually when you've ingested new games:

```bash
cd server
npx tsx src/jobs/computeNBATrends.ts
```

(Consider adding this to the scheduler if/when the team is happy with it running nightly.)

---

## 5. Verifying things are healthy

### The endpoints

```bash
# Health
curl -s http://localhost:3000/health

# Today's picks — should return non-empty for an active slate
curl -s http://localhost:3000/api/nba/picks/today | jq '.data.allPicks | length'

# Top trending — requires nba_trends populated
curl -s http://localhost:3000/api/nba/trends/top | jq 'length'

# New picks/streaks endpoints
curl -s 'http://localhost:3000/api/nba/picks/top?limit=5' | jq
curl -s 'http://localhost:3000/api/nba/streaks/perfect?type=player&stat=pts&window=5' | jq
```

### The data

Run these queries via the Supabase dashboard or MCP:

```sql
-- Recent daily_lines coverage
SELECT game_date, prop_type, COUNT(*)
FROM daily_lines
WHERE game_date >= current_date - interval '7 days'
GROUP BY game_date, prop_type
ORDER BY game_date DESC, prop_type;

-- Games table coverage (should match daily_lines.game_date range)
SELECT game_date, COUNT(*) AS games
FROM games
WHERE league_id = 1 AND game_date >= current_date - interval '3 days'
GROUP BY game_date
ORDER BY game_date DESC;

-- Recent pick_results
SELECT game_date, prop_type, pick_type, COUNT(*)
FROM pick_results
WHERE game_date >= current_date - interval '3 days'
GROUP BY game_date, prop_type, pick_type
ORDER BY game_date DESC;

-- nba_trends age (should update after games complete)
SELECT COUNT(*) AS trend_rows, MAX(computed_at) AS last_computed FROM nba_trends;
```

### The scheduler log

```bash
tail -f server/logs/cron.log
```

Expect entries like `[cron:start] nightly`, `[cron:done] nightly (exit 0)`, and per-script stdout interleaved with `[nightly] ...`. Exit codes other than 0 signal a failed run — search backwards for the `stderr`.

---

## 6. Common failures

| Symptom | Fix |
|---------|-----|
| Python `ModuleNotFoundError` (e.g. `supabase`) when cron fires | `PYTHON_PATH` not pointing at venv. Set it in `server/.env`, or ensure `venv/Scripts/python.exe` exists (Windows) / `venv/bin/python` (Unix) — scheduler auto-picks this path. |
| `/api/nba/trends/top` returns empty | `nba_trends` not populated. Run `npx tsx server/src/jobs/computeNBATrends.ts` manually. |
| `daily_lines.entity_id` NULL for recent game-prop rows | `games` table missing rows for those dates. Run the catch-up loop in §4. Kalshi markets list ~7 days out; the 2:30am job back-fills this going forward. |
| Picks pipeline returns "No candidates found" | Either no games on slate or all players filtered out by availability / min-minutes thresholds. Check `player_availability` hasn't marked the whole slate Out by mistake. |
| SportQuery returns "unknown SQL error" | The Groq model may be returning malformed JSON. Check `GROQ_API_KEY` is valid and the model ID in `server/src/config/groq.ts` is not retired. |
| SportQuery "Tenant or user not found" | `DATABASE_URL` user must be `<user>.<project-ref>`, not bare `<user>`. |

---

## 7. Deployment checklist

- [ ] `.env` populated with real (non-example) values
- [ ] Python venv created; `pip install -r analytics/requirements.txt` done
- [ ] `python -m analytics.batch.backfill_season --since <season start>` run once — games and player_stats populated from ESPN
- [ ] `client/` + `server/` both build cleanly (`npm run build` in each)
- [ ] Server runs: `node server/dist/server.js` (or via process manager)
- [ ] Production: confirm the first `Daily Data Sync` Actions run (11:00 UTC) is green. Local/PM2 only: tail `server/logs/cron.log` after the first 2am window — confirm jobs ran and exited 0
- [ ] Spot-check `pick_results.created_at` advances daily
- [ ] Spot-check `daily_lines.game_date` coverage extends 7 days ahead of current date
