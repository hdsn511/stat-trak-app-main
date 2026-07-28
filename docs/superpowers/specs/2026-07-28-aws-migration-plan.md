# StatTrak AWS Migration Plan

## Context

StatTrak currently runs entirely on a local machine: an Express API with an in-process node-cron scheduler (`server/src/jobs/scheduler.ts`) that shells out to a local Python venv for the data pipeline, a React/Vite frontend served via `localhost:3000`-hardcoded API calls, and Supabase for storage. The goal is to get this hosted for real — as a live, publicly reachable product — while using the migration itself as a demonstration of real software engineering judgment for a job search targeting large tech companies.

Through research, four hard constraints emerged and were locked in:

1. **Genuinely free / pay-per-use** — no component with continuous idle cost (ruled out a single always-on VM, AWS ElastiCache, AWS Bedrock, self-hosted GPU inference).
2. **AWS specifically** — the most commonly recognized cloud on a resume, and Lambda + EventBridge Scheduler's "Always Free" tiers (1M requests + 400K GB-seconds/month, 14M invocations/month respectively) are permanent, not a trial.
3. **Future-proof for NFL/NHL without restructuring** — the infra layer must let a new league be "append a config entry," not "redesign the stack."
4. **Simple, deliberate, "textbook"** — decoupled stateless API + scheduled batch, not a monolith; avoid overengineering (no K8s, no VPC, no custom APM).

Three concrete blockers were investigated and resolved:

- **NBA's data source (`nba_api`/stats.nba.com) is IP-blocked from datacenter IPs** — confirmed via a disabled GitHub Actions workflow that hung for 120 minutes on every scheduled run. Resolved: live-tested ESPN's hidden API (`site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard` + `/summary?event={id}`) and confirmed it returns full per-player box scores (verified against a real completed game — see `docs/superpowers/specs/2026-07-28-espn-api-research-findings.md`). This same host is already proven not blocked, since `injury_check.py` hits it successfully today via a live GitHub Actions cron. `nightly.py` will be migrated onto this data source, unblocking NBA for Lambda.
- **SportQuery's SSE streaming won't survive standard API Gateway→Lambda integration** (which buffers full responses). Resolved: isolate that one route to a Lambda Function URL with `RESPONSE_STREAM` invoke mode; everything else uses simple buffered API Gateway.
- **The LLM hosting question** (Bedrock vs. self-host vs. stay on Groq) — Bedrock has zero free tier (pay-per-token from call one), self-hosting requires continuous GPU cost, and Lambda itself cannot run GPU inference at all (Firecracker has no GPU/PCIe passthrough, by design, permanently). Resolved: stay on Groq (already free, already integrated), just switch the model to `gemma2-9b-it`, which is free on Groq's permanent no-credit-card tier and gets better free-tier limits than most other models there. Groq's LPU inference is also the fastest inference available for this class of model, so "highest performance" and "genuinely free" point the same direction here — no trade-off.

## Recommended Approach

A single AWS CDK (TypeScript) app, greenfield (`infra/`, sibling to `server/`/`client/`/`analytics/`), split into three stacks:

- **SharedStack** — Secrets Manager entries, an SNS topic for pipeline-failure alarms, GitHub OIDC IAM role (no long-lived AWS keys in GH Actions).
- **ApiStack** — the two user-facing Lambdas: a buffered Express API behind API Gateway (HTTP API), and a dedicated SportQuery streaming Lambda behind a Function URL.
- **PipelineStack** — every EventBridge-triggered batch job, driven entirely by one typed list (`infra/jobs.config.ts`) that CDK loops over to instantiate an EventBridge Rule + Lambda pair per entry. This list is the mechanism that makes NFL/NHL "future-proof" — onboarding a league means appending job entries once the parallel Python modules exist, not writing new CDK.

No VPC anywhere — Supabase (HTTPS/Supavisor-pooled Postgres), Upstash Redis (REST), Groq (HTTPS), Kalshi (HTTPS), and ESPN's API are all public HTTPS endpoints. This also avoids a NAT Gateway's ~$32/month fixed cost, which would otherwise be the single biggest violation of "no idle cost" hiding in an apparently-serverless design.

### Stack/construct layout

```
infra/
  bin/stattrak.ts              # CDK app entrypoint — instantiates the 3 stacks
  lib/
    shared-stack.ts            # Secrets Manager, SNS alarm topic, GitHub OIDC role
    api-stack.ts               # HTTP API + buffered Lambda + SportQuery streaming Function URL
    pipeline-stack.ts          # loops over jobs.config.ts -> EventBridge Rule + Lambda per job
  jobs.config.ts               # typed job list — "add a league" = append rows here
  Dockerfile.python            # one shared image for every Python pipeline Lambda
  lambda_handlers/
    python_job_handler.py      # generic dispatcher: imports JOB_TARGET module, calls its existing main()
```

### `jobs.config.ts` shape

Each entry becomes one EventBridge Rule + one Lambda:

```typescript
export interface JobDefinition {
  id: string;                 // e.g. "nba-nightly" — drives construct IDs, log groups
  league: 'nba' | 'mlb';      // add 'nfl' | 'nhl' when those pipelines exist
  kind: 'python-container' | 'node-zip';
  target: string;             // e.g. "analytics.batch.nightly" or "runSync.main"
  handlerArgs?: string[];
  schedule: events.Schedule;
  memoryMiB: number;
  timeout: cdk.Duration;
  secrets: Array<'supabase' | 'kalshi' | 'upstash'>;   // drives least-privilege IAM too
}
```

`PipelineStack` iterates `JOBS`, creating a `DockerImageFunction` (Python) or `NodejsFunction` (Node trends-compute) per entry, wiring its EventBridge schedule, granting only the secrets it lists, and attaching a `metricErrors()`-based CloudWatch Alarm → SNS. Today's MLB pipeline (already proven via 3 live GitHub Actions workflows) maps to `mlb-nightly`/`mlb-selfheal`/`mlb-reconcile`/`mlb-performance-report`/`mlb-injury-check`; NBA maps to `nba-nightly`/`nba-slate-sync`/`nba-trends`/`nba-picks`/`nba-reconcile`/`nba-injury-check`, mirroring `scheduler.ts`'s 6 jobs today.

### Lambda breakdown

| Lambda | Runtime/package | Trigger | Notes |
|---|---|---|---|
| `stattrak-api` | Node 20, `serverless-http` wrapping the existing Express app | API Gateway HTTP API | Requires extracting `app.ts` from `server.ts` so importing it doesn't call `.listen()`/`startScheduler()` |
| `stattrak-sportquery-stream` | Node 20, dedicated streaming handler (not `serverless-http` — incompatible with `awslambda.streamifyResponse`) | Function URL, `invokeMode: RESPONSE_STREAM` | Refactor `postMessage`'s SSE-framing into a writer-callback function so both Express (local dev) and the Lambda streaming handler can drive it |
| One `DockerImageFunction` per Python job in `jobs.config.ts` | Python 3.11 container, one shared `Dockerfile.python` | EventBridge Rule | Differentiated only by `JOB_TARGET`/`JOB_ARGS` env vars, not separate images |
| `nba-trends-compute` / `mlb-trends-compute` | Node 20, `NodejsFunction` (esbuild, no Docker) | EventBridge Rule | Wraps existing `runSync.ts` / `computeMLBTrends.ts`; needs an exported handler/main instead of top-level script execution |

No Bedrock IAM permissions anywhere — confirmed by design. The only LLM call is Groq's HTTPS API via `groq-sdk`; the SportQuery Lambda needs only a `stattrak/groq` secret and normal internet egress.

### Container image strategy (Python)

Base: `public.ecr.aws/lambda/python:3.11` (AWS's official Lambda Python base — matches the managed runtime, avoids manual runtime-interface-client plumbing). One shared `Dockerfile.python` installs `analytics/requirements.txt` and copies `analytics/` plus a single generic handler shim (`python_job_handler.py`) that reads `JOB_TARGET`/`JOB_ARGS` from env vars, `importlib.import_module`s the target, sets `sys.argv`, and calls its existing `main()` — every Python script's `argparse` `main()` runs completely unmodified, since `nightly.py`, `mlb_nightly.py`, `injury_check.py`, `generate.py`, `generate_mlb.py`, etc. already expose this exact shape. The Kalshi PEM is fetched from Secrets Manager and written to `/tmp/kalshi_key.pem` once per cold start (never baked into the image), with `KALSHI_PRIVATE_KEY_PATH` pointed at that path.

### Secrets Manager entries (all in SharedStack)

| Secret | Contents | Consumers |
|---|---|---|
| `stattrak/supabase` | url, service role key, Supavisor pooled DB URL | api, sportquery-stream, all pipeline jobs |
| `stattrak/kalshi` | API key | nba-picks, mlb-nightly, mlb-selfheal |
| `stattrak/kalshi-pem` | PEM string | same three |
| `stattrak/upstash` | REST URL + token | api, sportquery-stream |
| `stattrak/groq` | API key | sportquery-stream only |

Each Lambda gets `secretsmanager:GetSecretValue` scoped only to the ARNs it needs — driven by the `secrets` array already in each job definition, so IAM stays as data-driven as the scheduling.

### CI/CD

Two new GitHub Actions workflows (existing 8 pipeline cron workflows get their `schedule:` triggers disabled, not deleted — kept as a manual `workflow_dispatch` rollback path during cutover):

- **`deploy-infra.yml`** — on push to `main` touching `server/`/`analytics/`/`infra/`: test the server, then `cdk deploy --all` using GitHub OIDC → IAM role (`aws-actions/configure-aws-credentials` with `role-to-assume`), not static AWS keys in GH secrets.
- **`deploy-frontend.yml`** — on push to `main` touching `client/`: `tsc && vite build` with `VITE_API_BASE_URL` injected, then publish `client/dist` to Cloudflare Pages via `cloudflare/pages-action`.

### Observability

Deliberately minimal: default per-Lambda CloudWatch Logs (retention capped at 14 days to avoid unbounded storage cost) is enough day-to-day. One CloudWatch Alarm per pipeline Lambda (`metricErrors() >= 1` over 1 hour) → a single SNS topic → email — a silent pipeline failure (bad data, no picks generated) is worse than a silent API blip. The two user-facing API Lambdas deliberately do not get alarms in v1 (avoids noisy false positives from things like a client aborting mid-SSE-stream). No X-Ray, no custom dashboards, no APM — would read as overengineering at this scale.

## Required Code Changes (not purely infra)

- **`server/src/app.ts` (new)** — extract the helmet/cors/route-mounting wiring out of `server.ts` into an exported `app`, so the Lambda handler can import it without triggering `.listen()`/`startScheduler()`. `server.ts` remains the local-dev entrypoint only.
- **`server/src/lambda.ts` (new)** — `export const handler = serverlessHttp(app)`.
- **SportQuery streaming refactor** — pull `postMessage`'s SSE event-framing into a writer-callback function so both the local Express route and the Lambda streaming handler can drive the same logic.
- **`server/src/services/sportqueryDB.ts`** — point `SPORTQUERY_DB_URL` at Supabase's Supavisor pooled connection string (port 6543, transaction mode) instead of a direct connection — required regardless of Lambda concurrency, since concurrent invocations would otherwise each open their own 5-connection pool against a direct-connection limit.
- **`analytics/batch/nightly.py`** — replace `nba_api` box-score/schedule calls with ESPN's scoreboard/summary endpoints (pattern verified live).
- **`server/src/config/groq.ts`** — change `SPORTQUERY_MODEL` from `'llama-3.3-70b-versatile'` to `'gemma2-9b-it'`; spot-check a handful of `sportquery-examples.ts`'s few-shot prompts for continued strict-JSON compliance before relying on it.
- **`client/src/services/api.ts` and `sportqueryApi.ts`** — externalize the two hardcoded `http://localhost:3000/...` constants to `import.meta.env.VITE_API_BASE_URL` (and a second var for the SportQuery stream host once it's on its own Function URL origin); update `api.test.ts`'s hardcoded-URL assertion.
- **`server/src/middleware/sportqueryRateLimit.ts`** — swap `express-rate-limit`'s in-memory store for `@upstash/ratelimit`, and widen coverage to all of `/api`, not just SportQuery (the in-memory store silently under-enforces across concurrent Lambda instances).
- **Trends scripts (`runSync.ts`, `computeMLBTrends.ts`)** — wrap top-level script execution in an exported handler/main so `NodejsFunction` has an entry point to target.

## Migration Sequencing

1. **SharedStack only** — bootstrap CDK, provision Secrets Manager resources (values entered manually, not in source/state), SNS topic, GitHub OIDC role. Nothing user-facing changes yet.
2. **MLB pipeline first** — lowest risk, since MLB's data source is already proven not IP-blocked and already runs successfully via GitHub Actions. Deploy PipelineStack with only `mlb-*` jobs; run old (GH Actions) and new (EventBridge) in parallel a few days, diff output, then disable the old schedule.
3. **NBA `nightly.py` → ESPN, then deploy** — sequenced after MLB proves the Lambda/container mechanics work, so a data-source migration and an infra migration aren't debugged simultaneously. API-Sports (`API_SPORTS_KEY` already present, unused) stays documented as a fallback if ESPN ever throttles.
4. **ApiStack** — extract `app.ts`, deploy behind API Gateway with CORS still open, smoke-test every route directly against the Gateway URL before touching the frontend. Also land the Upstash rate-limiter swap here, before real traffic arrives.
5. **Frontend** — externalize the two BASE constants, stand up Cloudflare Pages + its deploy workflow, then tighten CORS from wide-open to the real Pages origin.
6. **SportQuery last** — swap the Groq model and validate output quality first (in the existing local/Express setup, so a model regression isn't conflated with the streaming migration), then implement the streaming Function URL and cut the frontend over to it.

## Verification

Since this is an infrastructure migration with no functional/business-logic change to the product itself, verification is about confirming each migrated piece behaves identically to its current local/GH-Actions counterpart before cutting traffic over:

- **Per pipeline job**: after deploying each EventBridge/Lambda job, manually invoke it (`aws lambda invoke`) and diff its Supabase writes (`daily_conditions`, `pick_results`, etc.) against a same-day run of the existing local/GH-Actions version, for at least one real day of data before disabling the old path.
- **ESPN data migration specifically**: compare `nightly.py`'s ESPN-sourced box scores against `nba_api`'s last known-good output for a handful of historical games, checking player-level stat parity (points/rebounds/assists/minutes) before trusting it for live slates.
- **API Lambda**: curl/Postman every existing route (`/api/nba/*`, `/api/mlb/*`, `/api/performance/*`, `/api/sportquery/session`) directly against the API Gateway URL and confirm response shape matches today's local server before pointing the frontend at it.
- **SportQuery streaming**: confirm the Function URL actually delivers incremental SSE chunks (not one buffered blob) to a raw `curl -N` or the real frontend hook, and that the `gemma2-9b-it` swap still produces valid single-JSON-object envelopes across the few-shot example set.
- **Frontend**: build with `VITE_API_BASE_URL` pointed at the deployed API Gateway URL, run through the app's golden paths (trend finder, player detail, picks, SportQuery chat) in a browser before calling the Cloudflare Pages deploy live.
- **CI/CD**: confirm `deploy-infra.yml`'s OIDC role assumption succeeds and `cdk deploy --all` runs clean on a throwaway branch before relying on it for main.

## Progress (branch: `infra/aws-migration`)

### Done and verified (`npx tsc --noEmit` + test suites pass)

- `server/src/app.ts` (new) — Express app extracted out of `server.ts`; `server.ts` now only does `.listen()` + `startScheduler()`.
- `server/src/lambda.ts` (new) — `serverless-http` API Gateway entry point.
- `server/src/lambda-handlers/sportqueryStream.ts` (new) — Function URL `RESPONSE_STREAM` entry point, using `awslambda.streamifyResponse`.
- `server/src/lambda-handlers/nbaTrends.ts` / `mlbTrends.ts` (new) — thin EventBridge Lambda entry points wrapping `computeTrends()` / `computeMLBTrends()`.
- `server/src/controllers/sportquery.ts` — SSE framing extracted into `runSportQueryTurn(sessionId, message, send)`; both the Express route and the streaming Lambda handler call it with their own `send` implementation.
- `server/src/middleware/rateLimit.ts` (new, replaces deleted `sportqueryRateLimit.ts`) — `@upstash/ratelimit` + `@upstash/redis`, no-ops (logs a warning) when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` aren't set, so local dev is unaffected. Applied to all of `/api` in `app.ts`, plus the existing per-route SportQuery limits.
- `server/src/config/groq.ts` — `SPORTQUERY_MODEL` → `gemma2-9b-it`. **Not yet spot-checked** against `sportquery-examples.ts`'s few-shot prompts for strict-JSON compliance — do this before relying on it in production.
- `server/src/services/sportqueryDB.ts` — pool `max` drops to 1 when `AWS_LAMBDA_FUNCTION_NAME` is set (Supavisor already pools; local dev keeps `max: 5`).
- `server/src/scripts/runSync.ts` — wrapped in an exported `main()`, still runs standalone via `require.main === module`.
- `client/src/services/api.ts` / `sportqueryApi.ts` — `BASE` now reads `VITE_API_BASE_URL` / `VITE_SPORTQUERY_BASE_URL` with the old `localhost:3000` value as fallback. `api.test.ts` needed no changes (env vars are unset in tests, so the fallback fires).
- `analytics/batch/nightly.py` + new `analytics/data/espn.py` — `get_slate`, `_fetch_and_insert_box_scores`, and `backfill_completed_games` now use ESPN's `scoreboard`/`summary` endpoints instead of `nba_api`. Team identity resolves by abbreviation, player identity by exact name match scoped to team — the same approach `injury_check.py` already runs in production against this same ESPN host. Stat label parsing (`PTS`/`REB`/`AST`/`3PT`/`PF`/`MIN`) matches the confirmed field list in `docs/superpowers/specs/2026-07-28-espn-api-research-findings.md`.

### Known gap surfaced during this work

`analytics/data/enrich_games.py` populates `player_game_conditions` (`usg_pct`, `pace`, `touches`) via `nba_api`'s `PlayerTrackV3` and was **not** migrated — it isn't referenced by any current GitHub Actions workflow, so it isn't actively blocking the scheduled pipeline today, but it will need attention before this is a complete NBA-on-Lambda story. Per the ESPN research doc: `usg_pct`/`pace` are derivable via formula from ESPN's raw per-game numbers, but `touches`/`front_court_touches`/`paint_touches`/`time_of_possession`/`avg_speed` have **no ESPN equivalent at all** (proprietary Second Spectrum tracking data) — if those five fields are a hard requirement, this one call may need to stay on `nba_api` indefinitely, at a lower/riskier frequency than the main pipeline.

### Not started

- `infra/` CDK app itself (`bin/stattrak.ts`, the three stacks, `jobs.config.ts`, `Dockerfile.python`, `python_job_handler.py`).
- `deploy-infra.yml` / `deploy-frontend.yml` GitHub Actions workflows.
- Anything requiring real credentials: `cdk bootstrap`/`cdk deploy`, populating actual Secrets Manager values, GitHub OIDC role creation (needs the real GitHub org/repo slug), Cloudflare Pages project setup, DNS.

### Verification gap

None of the ESPN-facing code (`analytics/data/espn.py`, the rewritten `nightly.py` functions) has been run end-to-end — this sandbox has no Supabase credentials, no Python pipeline deps installed, and no outbound network access to `site.api.espn.com` (proxy policy blocks it). The stat-label parsing was cross-checked against the research doc's confirmed field list, but treat it as unverified until it's actually run against live ESPN responses and a real Supabase instance (see the Verification section above).

### Also uncommitted in the working tree, deliberately left alone

`client/src/components/MLBPlayer/MLBPlayerView.tsx`, `server/src/controllers/picksController.ts`, and `.claude/settings.local.json` had pre-existing local modifications when this work started. They're unrelated to this migration and were not touched or included in this branch.
