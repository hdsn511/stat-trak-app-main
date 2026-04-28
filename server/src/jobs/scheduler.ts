import * as cron from 'node-cron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// __dirname is server/src/jobs (tsx/ts-node) or server/dist/jobs (compiled).
// Both sit three levels below the repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LOG_DIR  = path.resolve(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'cron.log');

// Default to the repo's venv Python when PYTHON_PATH isn't set. The scheduler
// shells out to `python -m analytics.<module>`, which requires the venv's
// dependencies (nba_api, supabase, pandas). Using system `python` silently
// fails on module-not-found.
const VENV_PYTHON = process.platform === 'win32'
  ? path.resolve(REPO_ROOT, 'venv', 'Scripts', 'python.exe')
  : path.resolve(REPO_ROOT, 'venv', 'bin', 'python');
const PYTHON = process.env.PYTHON_PATH
  || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python');

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string): void {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore write failures */ }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dateOffsetStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function runPython(moduleArgs: string[], label: string): Promise<void> {
  return new Promise((resolve) => {
    log(`[cron:start] ${label}`);
    const child = spawn(PYTHON, ['-m', ...moduleArgs], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    child.stdout.on('data', (d: Buffer) =>
      log(`[${label}] ${d.toString().trimEnd()}`));
    child.stderr.on('data', (d: Buffer) =>
      log(`[${label}:err] ${d.toString().trimEnd()}`));
    child.on('close', (code: number | null) =>
      log(`[cron:done] ${label} (exit ${code ?? '?'})`));
    child.on('error', (err: Error) => {
      log(`[cron:spawn-error] ${label}: ${err.message}`);
      resolve();
    });
    child.on('close', () => resolve());
  });
}

function runNode(scriptArgs: string[], label: string): Promise<void> {
  return new Promise((resolve) => {
    log(`[cron:start] ${label}`);
    const child = spawn('node', ['--env-file=.env', '--require', 'tsx/cjs', ...scriptArgs], {
      cwd: path.resolve(REPO_ROOT, 'server'),
      env: { ...process.env },
    });
    child.stdout.on('data', (d: Buffer) =>
      log(`[${label}] ${d.toString().trimEnd()}`));
    child.stderr.on('data', (d: Buffer) =>
      log(`[${label}:err] ${d.toString().trimEnd()}`));
    child.on('close', (code: number | null) =>
      log(`[cron:done] ${label} (exit ${code ?? '?'})`));
    child.on('error', (err: Error) => {
      log(`[cron:spawn-error] ${label}: ${err.message}`);
      resolve();
    });
    child.on('close', () => resolve());
  });
}

export function startScheduler(): void {
  ensureLogDir();
  log('[cron] Scheduler starting — registering jobs...');

  // 2:00am — compute daily_conditions for today
  cron.schedule('0 2 * * *', async () => {
    try {
      await runPython(['analytics.batch.nightly', '--date', todayStr()], 'nightly');
    } catch (err) {
      log(`[cron:error] nightly: ${err}`);
    }
  });

  // 2:30am — sync upcoming week's slate. Kalshi markets are listed ~7 days
  // ahead of each game, but `games` rows are needed for entity_id join on
  // daily_lines + for backtest history. Serially run nightly for each of
  // the next 7 days to fetch/insert future slates via ScoreboardV2.
  cron.schedule('30 2 * * *', async () => {
    for (let offset = 1; offset <= 7; offset++) {
      const dateStr = dateOffsetStr(offset);
      try {
        await runPython(
          ['analytics.batch.nightly', '--date', dateStr],
          `slate_day+${offset}`,
        );
      } catch (err) {
        log(`[cron:error] slate day+${offset}: ${err}`);
      }
    }
  });

  // 2:45am — recompute NBA trends (z-scores + rolling averages)
  cron.schedule('45 2 * * *', async () => {
    try {
      await runNode(['src/scripts/runSync.ts'], 'computeTrends');
    } catch (err) {
      log(`[cron:error] computeTrends: ${err}`);
    }
  });

  // 3:00am — generate picks (Kalshi lines + backtest + score)
  cron.schedule('0 3 * * *', async () => {
    try {
      await runPython(['analytics.picks.generate', '--date', todayStr()], 'picks');
    } catch (err) {
      log(`[cron:error] picks: ${err}`);
    }
  });

  // 12:00pm — reconcile yesterday's picks (fill actual_result/did_hit)
  cron.schedule('0 12 * * *', async () => {
    try {
      await runPython(
        ['analytics.batch.nightly', '--date', yesterdayStr()],
        'reconcile'
      );
    } catch (err) {
      log(`[cron:error] reconcile: ${err}`);
    }
  });

  // Hourly 10am–11pm — injury validation + pick invalidation
  cron.schedule('0 10-23 * * *', async () => {
    try {
      await runPython(
        ['analytics.batch.injury_check', '--date', todayStr()],
        'injury_check'
      );
    } catch (err) {
      log(`[cron:error] injury_check: ${err}`);
    }
  });

  log(`[cron] Registered 6 jobs. PYTHON=${PYTHON}. REPO_ROOT=${REPO_ROOT}.`);
}
