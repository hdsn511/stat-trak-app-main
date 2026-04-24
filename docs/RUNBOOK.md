# StatTrak Runbook

How to install, run, and keep the pipeline healthy. Covers both one-off setup and day-to-day operation.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node | 20+ | `node --version` |
| npm | 10+ | ships with Node |
| Python | 3.12 | required by `nba_api` + `supabase-py` |
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

# API-Sports (nba_api fallback for some endpoints)
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
python server/scripts/nba_init.py
```

This fetches last 3 seasons of teams, players, rosters, games, and player stats. Takes 20-40 minutes depending on NBA API rate limits. Resume mid-run with:

```bash
python server/scripts/resume_nba_stats.py
```

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

### 3.3 The scheduler — how it runs

`server/src/jobs/scheduler.ts` registers cron jobs via `node-cron` **inside the Express server process**. It starts automatically when the server boots (`startScheduler()` call at the end of `src/server.ts`).

**Key implication:** jobs only run while the server process is alive. For 24/7 operation, keep the server running via a process manager (`pm2`, `systemd`, Docker, your platform's equivalent). When the server restarts, the scheduler re-registers — no state is lost between runs because the jobs are idempotent (each reads DB + external APIs).

Verify jobs are registered: tail `server/logs/cron.log` after startup. Expect:

```
[cron] Scheduler starting — registering jobs...
[cron] Registered 5 jobs. PYTHON=<path>. REPO_ROOT=<repo>.
```

### 3.4 Scheduled jobs

| Cron | What runs | Purpose |
|------|-----------|---------|
| `0 2 * * *` (2:00 am) | `python -m analytics.batch.nightly --date <today>` | Fetch today's NBA slate + compute `daily_conditions` for each player (rolling avgs, usage, rest, opp def rank) |
| `30 2 * * *` (2:30 am) | `nightly --date <today+1>` through `<today+7>` — 7 serial runs | Pre-fetch upcoming week's games so `entity_id` joins work on `daily_lines` when Kalshi lists future markets |
| `0 3 * * *` (3:00 am) | `python -m analytics.picks.generate --date <today>` | Fetch Kalshi lines, run condition-matched backtests, score, store to `pick_results` |
| `0 10-23 * * *` (every hour, 10am–11pm) | `python -m analytics.batch.injury_check --date <today>` | Pull ESPN injuries, upsert `player_availability`, invalidate picks for players ruled Out |
| `0 12 * * *` (12:00 pm) | `nightly --date <yesterday>` | Reconcile yesterday's picks — fill `actual_result` / `did_hit` on `pick_results` |

All timestamps are in the server's local timezone. If deploying to a cloud host, double-check `TZ` env var or explicit `cron.schedule({ timezone: 'America/Chicago' }, ...)` if the jobs need to align with a specific timezone.

### 3.5 Alternative: system cron (if you don't want the server running 24/7)

The scheduler is just a convenience wrapper. You can instead run the Python modules directly from system cron:

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
| `nba_api` ModuleNotFoundError when cron fires | `PYTHON_PATH` not pointing at venv. Set it in `server/.env`, or ensure `venv/Scripts/python.exe` exists (Windows) / `venv/bin/python` (Unix) — scheduler auto-picks this path. |
| `/api/nba/trends/top` returns empty | `nba_trends` not populated. Run `npx tsx server/src/jobs/computeNBATrends.ts` manually. |
| `daily_lines.entity_id` NULL for recent game-prop rows | `games` table missing rows for those dates. Run the catch-up loop in §4. Kalshi markets list ~7 days out; the 2:30am job back-fills this going forward. |
| Picks pipeline returns "No candidates found" | Either no games on slate or all players filtered out by availability / min-minutes thresholds. Check `player_availability` hasn't marked the whole slate Out by mistake. |
| SportQuery returns "unknown SQL error" | The Groq model may be returning malformed JSON. Check `GROQ_API_KEY` is valid and the model ID in `server/src/config/groq.ts` is not retired. |
| SportQuery "Tenant or user not found" | `DATABASE_URL` user must be `<user>.<project-ref>`, not bare `<user>`. |

---

## 7. Deployment checklist

- [ ] `.env` populated with real (non-example) values
- [ ] Python venv created; `pip install -r analytics/requirements.txt` done
- [ ] `nba_init.py` run once — teams, players, games, player_stats populated
- [ ] `client/` + `server/` both build cleanly (`npm run build` in each)
- [ ] Server runs: `node server/dist/server.js` (or via process manager)
- [ ] Tail `server/logs/cron.log` after first 2am window — confirm jobs ran and exited 0
- [ ] Spot-check `pick_results.created_at` advances daily
- [ ] Spot-check `daily_lines.game_date` coverage extends 7 days ahead of current date
