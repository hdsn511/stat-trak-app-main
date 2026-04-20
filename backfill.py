#!/usr/bin/env python3
"""
StatTrak full data backfill orchestrator.

Runs all pipeline steps in order. Progress is saved to backfill_state.json
so restarting the script picks up where it left off.

Usage:
    python backfill.py               # run all steps (or resume from last failure)
    python backfill.py --reset       # clear saved state and start from scratch
    python backfill.py --status      # show which steps are done / pending
    python backfill.py --from <id>   # restart from a specific step ID

Step IDs (in order):
    nba_init        Fetch leagues, teams, players, games, and all player stats
    positions       Backfill player positions from team rosters
    enrich_games    BoxScoreAdvancedV2 -> player_game_conditions / team_game_stats
    opp_defense     Compute opponent-position-defense rankings
    nightly         Compute daily_conditions for today's slate
    generate_picks  Score + store today's picks
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

REPO_ROOT   = Path(__file__).parent.resolve()
STATE_FILE  = REPO_ROOT / "backfill_state.json"
LOG_FILE    = REPO_ROOT / "backfill.log"

MAX_STEP_RETRIES  = 3       # attempts per step before pausing for manual restart
RETRY_BACKOFF     = [30, 60, 120]   # seconds to wait before retry 1, 2, 3

TODAY = date.today().strftime("%Y-%m-%d")
PY    = sys.executable


# ── Step definitions ──────────────────────────────────────────────────────────

STEPS: list[dict] = [
    {
        "id":   "nba_init",
        "name": "NBA init (leagues / teams / players / games / player stats)",
        "cmd":  [PY, "server/scripts/nba_init.py"],
    },
    {
        "id":   "positions",
        "name": "Backfill player positions (CommonTeamRoster)",
        "cmd":  [PY, "-m", "analytics.data.enrich_games", "--positions"],
    },
    {
        "id":   "enrich_games",
        "name": "Enrich games -> player_game_conditions / team_game_stats",
        "cmd":  [PY, "-m", "analytics.data.enrich_games", "--resume", "--yes"],
    },
    {
        "id":   "basic_stats_fill",
        "name": "Fill gaps in nba_player_stats (BoxScoreTraditionalV2)",
        "cmd":  [PY, "-m", "analytics.data.enrich_games", "--basic-stats", "--resume", "--yes"],
    },
    {
        "id":   "opp_defense",
        "name": "Opponent-position-defense rankings",
        "cmd":  [PY, "-m", "analytics.data.enrich_games", "--opp-defense"],
    },
    {
        "id":   "nightly",
        "name": f"Nightly batch → daily_conditions ({TODAY})",
        "cmd":  [PY, "-m", "analytics.batch.nightly", "--date", TODAY],
    },
    {
        "id":   "generate_picks",
        "name": f"Generate picks ({TODAY})",
        "cmd":  [PY, "-m", "analytics.picks.generate", "--date", TODAY, "--mock"],
    },
]

STEP_IDS = [s["id"] for s in STEPS]


# ── State helpers ─────────────────────────────────────────────────────────────

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"completed": []}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def mark_done(state: dict, step_id: str) -> None:
    if step_id not in state["completed"]:
        state["completed"].append(step_id)
    state.pop("paused_at", None)
    save_state(state)


def mark_paused(state: dict, step_id: str) -> None:
    state["paused_at"] = step_id
    save_state(state)


# ── Logging ───────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    ts   = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        # Windows cp1252 terminal can't render chars like → U+2192
        print(line.encode("ascii", errors="replace").decode("ascii"), flush=True)
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ── Step runner ───────────────────────────────────────────────────────────────

def run_step(step: dict) -> bool:
    """
    Run a single step, streaming its output. Returns True on success.
    Retries up to MAX_STEP_RETRIES times with backoff before giving up.
    """
    for attempt in range(1, MAX_STEP_RETRIES + 1):
        if attempt > 1:
            wait = RETRY_BACKOFF[min(attempt - 2, len(RETRY_BACKOFF) - 1)]
            _log(f"  Retrying in {wait}s ... (attempt {attempt}/{MAX_STEP_RETRIES})")
            time.sleep(wait)

        _log(f"  Running: {' '.join(step['cmd'])}")

        try:
            # Force UTF-8 in the child process so emoji in scripts (nba_init.py etc.)
            # don't crash on Windows cp1252 terminals.
            child_env = {
                **os.environ,
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
            }

            # Stream output live — each line goes to stdout AND the log file
            proc = subprocess.Popen(
                step["cmd"],
                cwd=str(REPO_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=child_env,
            )

            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.rstrip("\n")
                # Encode safely for the terminal (replace unencodable chars)
                try:
                    print(line, flush=True)
                except UnicodeEncodeError:
                    print(line.encode("ascii", errors="replace").decode("ascii"), flush=True)
                try:
                    with LOG_FILE.open("a", encoding="utf-8") as f:
                        f.write(line + "\n")
                except Exception:
                    pass

            proc.wait()

            if proc.returncode == 0:
                return True

            _log(f"  Step exited with code {proc.returncode}.")

        except KeyboardInterrupt:
            _log("  Interrupted by user (Ctrl+C).")
            raise
        except Exception as exc:
            _log(f"  Unexpected error launching step: {exc}")

    return False


# ── Orchestrator ─────────────────────────────────────────────────────────────

def run_pipeline(start_from: str | None = None) -> None:
    state = load_state()
    completed = set(state.get("completed", []))

    # Determine starting position
    if start_from:
        if start_from not in STEP_IDS:
            print(f"ERROR: unknown step id '{start_from}'. Valid IDs: {', '.join(STEP_IDS)}")
            sys.exit(1)
        start_idx = STEP_IDS.index(start_from)
        _log(f"Forcing start from step: {start_from}")
    else:
        start_idx = 0

    pending = [
        s for s in STEPS[start_idx:]
        if s["id"] not in completed
    ]

    if not pending:
        _log("All steps already completed. Run with --reset to start fresh.")
        return

    total = len(STEPS)
    _log("=" * 68)
    _log("StatTrak Backfill Orchestrator")
    _log(f"Steps completed : {len(completed)}/{total}")
    _log(f"Steps remaining : {len(pending)}")
    _log(f"Log file        : {LOG_FILE}")
    _log(f"State file      : {STATE_FILE}")
    _log("=" * 68)

    for step in pending:
        idx = STEP_IDS.index(step["id"]) + 1
        _log("")
        _log(f"[{idx}/{total}] {step['name']}")
        _log("-" * 68)

        try:
            success = run_step(step)
        except KeyboardInterrupt:
            _log("")
            _log("Interrupted. Progress saved — restart script to continue.")
            mark_paused(state, step["id"])
            sys.exit(130)

        if success:
            mark_done(state, step["id"])
            _log(f"  [OK] Step '{step['id']}' complete.")
        else:
            _log("")
            _log(f"  [FAIL] Step '{step['id']}' failed after {MAX_STEP_RETRIES} attempts.")
            _log("  Progress saved. Restart script to retry from this step.")
            _log(f"  Or run:  python backfill.py --from {step['id']}")
            mark_paused(state, step["id"])
            sys.exit(1)

    _log("")
    _log("=" * 68)
    _log("All steps complete! Pipeline finished.")
    _log("=" * 68)


# ── CLI ───────────────────────────────────────────────────────────────────────

def show_status() -> None:
    state = load_state()
    completed = set(state.get("completed", []))
    paused_at = state.get("paused_at")

    print("\nStatTrak Backfill Status")
    print("-" * 40)
    for step in STEPS:
        sid = step["id"]
        if sid in completed:
            marker = "[done]  "
        elif sid == paused_at:
            marker = "[PAUSED]"
        else:
            marker = "[      ]"
        print(f"  {marker}  {sid}")
    print()
    if paused_at:
        print(f"Paused at: {paused_at}")
        print(f"Run 'python backfill.py' to resume.")
    elif completed == set(STEP_IDS):
        print("All steps done.")
    else:
        print("Run 'python backfill.py' to start / continue.")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="StatTrak full data backfill orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Clear saved state and restart all steps from scratch",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show which steps are done / pending and exit",
    )
    parser.add_argument(
        "--from",
        dest="from_step",
        metavar="STEP_ID",
        help="Start (or restart) from a specific step ID",
    )

    args = parser.parse_args()

    if args.status:
        show_status()
        return

    if args.reset:
        if STATE_FILE.exists():
            STATE_FILE.unlink()
            print("State cleared. Starting from scratch.")
        else:
            print("No state file found — already at scratch.")

    run_pipeline(start_from=args.from_step)


if __name__ == "__main__":
    main()
