#!/usr/bin/env bash
#
# Run the full Nightly MLB Pipeline locally (mirrors
# .github/workflows/mlb-nightly-pipeline.yml).
#
# Usage:
#   ./run-mlb-local.sh            # run for today
#   ./run-mlb-local.sh --force    # full rebuild of today's slate (passed to picks)
#
# Requires: python3.11 + node/npm, server/.env populated, server/kalshi_key.pem.
# Creates/uses a local .venv-local (the repo's checked-in venv/ is a Windows venv
# and is unusable on macOS/Linux).
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
VENV="$ROOT/.venv-local"
PY="$VENV/bin/python"
export PYTHONUNBUFFERED=1

# Pick a Python 3.11 if available, else fall back to python3.
PYBIN="$(command -v python3.11 || command -v python3)"

# Bootstrap the venv on first run (or if it's broken).
if [ ! -x "$PY" ]; then
  echo "===== Bootstrapping .venv-local with $PYBIN ====="
  rm -rf "$VENV"
  "$PYBIN" -m venv "$VENV"
  "$PY" -m pip install -q --upgrade pip
  "$PY" -m pip install -q -r analytics/requirements.txt
fi

# Ensure server deps exist for the trends step.
if [ ! -d "$ROOT/server/node_modules" ]; then
  echo "===== Installing server npm deps ====="
  npm ci --prefix server
fi

echo "===== STEP 1/5: Refresh MLB rosters ====="
"$PY" -m analytics.batch.mlb_init

echo "===== STEP 2/5: MLB nightly batch (reconcile, box scores, slate, conditions) ====="
# Retry once: the Supabase read for daily_conditions occasionally times out;
# the step is idempotent so a second pass completes it cleanly.
"$PY" -m analytics.batch.mlb_nightly --today || \
  "$PY" -m analytics.batch.mlb_nightly --today

echo "===== STEP 3/5: MLB enrich (park factors, pitcher snapshots) ====="
"$PY" -m analytics.batch.mlb_enrich

echo "===== STEP 4/5: Compute MLB trends ====="
( cd server && npm run sync-data-mlb )

echo "===== STEP 5/5: Generate MLB picks ====="
"$PY" -m analytics.picks.generate_mlb --today "$@"

echo "===== Done ====="
