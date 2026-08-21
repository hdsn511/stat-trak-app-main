# Deployment

How StatTrak goes live: the SPA on Cloudflare Pages, the Express API on AWS
Lambda behind a Function URL, rate limiting and caching in Upstash Redis, and
Supabase unchanged as the database.

Everything in the repo is deploy-ready. What remains is account setup — the
steps below — after which a push to `main` deploys the whole stack.

---

## 1. Architecture

```
browser
   │
   ▼
Cloudflare Pages  (stattraksports.pages.dev)
   ├── static SPA assets
   └── Pages Function  /api/*  ──── injects x-stattrak-proxy-secret ────┐
                                                                        ▼
                                                          AWS Lambda (arm64)
                                                          Function URL, LWA layer
                                                          └── Express app
                                                                        │
                                        ┌───────────────────────────────┼──────────────┐
                                        ▼                               ▼              ▼
                                  Upstash Redis                    Supabase       Groq
                                (ratelimit + cache)          PostgREST + pooler
```

The SPA calls **same-origin** `/api/...`. That single choice removes CORS
entirely, keeps the Function URL out of the browser, and lets Cloudflare's edge
cache absorb GETs before they cost a Lambda invocation.

Scheduled data pipelines are **not** part of this deployment. They stay on
GitHub Actions, where they already run.

---

## 2. What you need to create

| # | Account | Free tier | Cost |
|---|---------|-----------|------|
| 1 | AWS | Lambda + Function URLs | ~$0–3/mo |
| 2 | Cloudflare | Pages, incl. `*.pages.dev` | $0 |
| 3 | Upstash | Redis, 500K commands/mo | $0 |
| 4 | Supabase | already in use | unchanged |

Estimated total: **~$1–10/month**, mostly CloudWatch logs. A NAT gateway
(~$32/mo) and API Gateway are both avoided by design.

### 2.1 Domain

`stattraksports.pages.dev` is **free** and needs no DNS work — the only
requirement is that the Pages project be named `stattraksports`, which the
deploy workflow already assumes.

A custom domain such as `stattraksports.com` is **not free**: the DNS hosting
and the Pages attachment cost nothing, but the registration itself is roughly
$10–12/year at any registrar. If you buy one later, attaching it is a console
action plus one workflow change — nothing in the code hardcodes the hostname.

---

## 3. Setup

### 3.1 AWS — OIDC role

GitHub Actions authenticates by assuming a role, so no long-lived AWS keys are
ever stored in the repo.

1. IAM → Identity providers → **Add provider** → OpenID Connect
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. IAM → Roles → **Create role** → Web identity → the provider above
   - Restrict the trust policy to this repo, so no other repository can assume it:

   ```json
   {
     "Effect": "Allow",
     "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
     "Action": "sts:AssumeRoleWithWebIdentity",
     "Condition": {
       "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
       "StringLike": { "token.actions.githubusercontent.com:sub": "repo:hdsn511/stat-trak-app-main:*" }
     }
   }
   ```

3. Attach permissions for CloudFormation, Lambda, IAM (role creation for the
   function), S3 (SAM's artifact bucket), and CloudWatch Logs. `PowerUserAccess`
   plus `IAMFullAccess` works to get started; tighten it afterwards.
4. Copy the role ARN → GitHub secret `AWS_ROLE_ARN`.

Region is `us-east-1`, set in `.github/workflows/deploy-api.yml`.

### 3.2 Upstash Redis

1. Create a database — region **us-east-1**, to sit next to the Lambda.
2. Copy the **REST** URL and token (not the `redis://` URL — the code uses the
   HTTP API, which is what lets the Lambda stay out of a VPC).
3. → secrets `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

Leaving these unset is safe: the app falls back to in-memory rate limiting and
disables caching. It will run, but limits stop being shared across containers.

### 3.3 Supabase — pooler URL

Dashboard → Project Settings → Database → Connection string → **Transaction
pooler**:

```
postgres://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Port **6543**, not 5432. Direct connections from a scaling Lambda exhaust
Postgres. → secret `SPORTQUERY_DB_URL`.

### 3.4 Shared secret

```bash
openssl rand -hex 32
```

The same value goes in two places: GitHub secret `API_SHARED_SECRET`, and the
Cloudflare Pages environment variable of the same name. If they disagree, every
API call returns 403.

### 3.5 Cloudflare Pages

1. Workers & Pages → **Create** → Pages → Connect to Git → this repo.
2. Project name: **`stattraksports`** (this is what makes the URL
   `stattraksports.pages.dev`, and the deploy workflow passes it by name).
3. Build settings — these only apply to Cloudflare's own Git builds; the
   workflow in this repo builds and uploads instead:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Root directory: `client`
4. Settings → Environment variables → Production:
   - `API_ORIGIN` — the Lambda Function URL, available after the first API
     deploy (step 4.1) prints it.
   - `API_SHARED_SECRET` — the value from 3.4.
5. Account ID (Workers & Pages sidebar) → secret `CLOUDFLARE_ACCOUNT_ID`.
6. My Profile → API Tokens → Create → template **Edit Cloudflare Workers**, or a
   custom token with `Account · Cloudflare Pages · Edit` → secret
   `CLOUDFLARE_API_TOKEN`.

---

## 4. Secrets checklist

GitHub → Settings → Secrets and variables → Actions:

| Secret | Source |
|---|---|
| `AWS_ROLE_ARN` | 3.1 |
| `SUPABASE_URL` | existing `server/.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | existing `server/.env` |
| `SPORTQUERY_DB_URL` | 3.3 — pooler, port 6543 |
| `GROQ_API_KEY` | existing `server/.env` |
| `UPSTASH_REDIS_REST_URL` | 3.2 |
| `UPSTASH_REDIS_REST_TOKEN` | 3.2 |
| `API_SHARED_SECRET` | 3.4 |
| `CLOUDFLARE_API_TOKEN` | 3.5 |
| `CLOUDFLARE_ACCOUNT_ID` | 3.5 |

Optional repository **variable** (not a secret): `ALLOWED_ORIGINS`. Normally
left empty — the SPA is same-origin, so no cross-origin access is required.

Cloudflare Pages environment variables: `API_ORIGIN`, `API_SHARED_SECRET`.

---

## 5. First deploy

Order matters once: the Pages proxy needs the Function URL, which does not exist
until the API deploys.

1. **API.** Actions → *Deploy API* → Run workflow. It typechecks, tests,
   bundles, deploys, and smoke-tests `/health`. Copy the Function URL it prints.
2. **Cloudflare.** Set `API_ORIGIN` to that URL (3.5, step 4).
3. **Client.** Actions → *Deploy Client* → Run workflow.
4. Open `https://stattraksports.pages.dev`.

Afterwards both workflows run automatically on pushes to `main` that touch their
respective paths.

---

## 6. Verifying it actually works

Passing workflows mean the code deployed, not that the system is correct. These
are the things only a live environment can confirm:

```bash
# 1. The Function URL rejects anyone without the shared secret.
curl -i https://<function-url>/api/nba/trends/top          # expect 403
curl -i -H 'x-stattrak-proxy-secret: <secret>' \
        https://<function-url>/api/nba/trends/top          # expect 200

# 2. The site serves the same data through the proxy.
curl -i https://stattraksports.pages.dev/api/nba/trends/top  # expect 200

# 3. Cache headers survive the proxy.
curl -sI https://stattraksports.pages.dev/api/nba/trends/top | grep -i 'cache-control\|cf-cache-status'

# 4. Session endpoints are never publicly cached.
curl -sI https://stattraksports.pages.dev/api/sportquery/sessions | grep -i cache-control
#    expect: no-store

# 5. Deep links resolve (SPA fallback).
curl -sI https://stattraksports.pages.dev/player/nba/241 | head -1   # expect 200
```

Then, in the browser:

- **SportQuery streams.** Ask a question and confirm the answer arrives token by
  token rather than in one lump. Buffering here means `AWS_LWA_INVOKE_MODE` and
  the Function URL's `InvokeMode` disagree.
- **Rate limiting is shared.** Send >30 SportQuery messages in a minute and
  confirm a 429. Under Lambda fan-out this only holds if Upstash is wired up.
- **Cold start.** Time the first request after ~15 minutes idle. If it hurts,
  the lever is provisioned concurrency — which costs money continuously, so
  measure before reaching for it.

### Watch after launch

- **Upstash usage graph.** Crossing ~50% of 500K commands/month is the signal to
  revisit TTLs, not an emergency.
- **CloudWatch cost.** Log retention is 14 days by default
  (`LogRetentionDays` in the template).
- **Cloudflare Pages Functions:** 100K requests/day on the free plan. Edge
  caching is what keeps most GETs from reaching the function at all.

---

## 7. Rollback

```bash
# Redeploy a known-good commit
git revert <bad-commit> && git push

# Or roll the stack back directly
aws cloudformation cancel-update-stack --stack-name stattrak-api --region us-east-1
```

Cloudflare Pages keeps every previous deployment; the dashboard's **Rollback**
on an earlier build is instant and needs no rebuild.

---

## 8. Local development is unchanged

```bash
npm run dev:both   # client :5173, API :3000
```

Vite proxies `/api` to `localhost:3000`, mirroring what the Pages Function does
in production, so the same relative paths work in both. With no
`API_SHARED_SECRET` set locally the proxy gate disables itself, and with no
Upstash credentials rate limiting falls back to the in-memory store.
