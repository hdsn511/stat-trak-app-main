# StatTrak

Sports statistics and trends analysis app for identifying betting-relevant player and game prop performance trends. NBA data infrastructure is complete; NFL/NHL are placeholder pages, MLB is in active development.

## Stack

- **`client/`** — React 18 + TypeScript + Vite frontend
- **`server/`** — Express 5 + TypeScript backend
- **`analytics/`** — Python data pipeline (nba_api, Kalshi) → Supabase (PostgreSQL)

## Getting started

See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for full setup, environment variables, and day-to-day pipeline operation.

```bash
npm install
npm run dev:both      # frontend (:5173) + backend (:3000)
```

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture, commands, file map, frontend/backend conventions
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — install/run/operate the pipeline
- [`analytics/README.md`](analytics/README.md) — analytics engine internals
- [`CHANGELOG.md`](CHANGELOG.md) — schema and pipeline change history
