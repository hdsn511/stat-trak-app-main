"""
analytics/batch/compute_trends.py

Computes rolling-window trend z-scores for the ESPN-backed leagues and writes
them to nfl_trends / nhl_trends.

Port of server/src/jobs/computeNBATrends.ts, kept deliberately faithful so all
four leagues rank on the same number: for each player and stat, take the
season mean and standard deviation, then score each rolling window against it.

    z = (rolling_avg - season_avg) / season_std     capped at +/- Z_CAP

The stat ids are NOT free to choose — they are the contract in
server/src/config/leagues.ts `statConfig`, which the league-agnostic
controllers already reference:

    NFL  payds=0 patd=1 ruyds=2 rutd=3 recyds=4 rec=5 rectd=6 tkl=7
    NHL  g=0 a=1 p=2 sog=3 blk=4 hits=5

Quality gates exist because a z-score over a tiny sample is noise, not a
trend. A player needs MIN_SEASON_GAMES appearances, the stat needs a non-zero
season spread above `min_std`, and the rolling average has to clear
`min_rolling` — otherwise a backup with two catches in a row outranks a WR1.

NULL stat columns are real zeros: the ingest only writes a row for a player
who appeared, and ESPN omits a stat group the player did not register in
(a running back has NULL passing_yards). Absent rows are absent games and are
never zero-filled.

Usage:
    python -m analytics.batch.compute_trends
    python -m analytics.batch.compute_trends --league nhl --season 2025
    python -m analytics.batch.compute_trends --dry-run
"""
from __future__ import annotations

import argparse
import statistics
import sys
from dataclasses import dataclass, field

from analytics.db.connection import NFL_LEAGUE_ID, NHL_LEAGUE_ID, supabase

PAGE = 1000
WINDOWS = (3, 5, 10)
Z_CAP = 4.0


@dataclass(frozen=True)
class StatSpec:
    key: str          # leagues.ts statConfig key, for logging
    stat_id: int      # leagues.ts statConfig statId — the wire contract
    column: str       # column in the league's stats table
    min_std: float    # season spread floor
    min_rolling: float  # rolling-average floor


@dataclass(frozen=True)
class TrendSpec:
    code: str
    league_id: int
    stats_table: str
    trends_table: str
    min_season_games: int
    stats: tuple[StatSpec, ...]
    # Rows failing this are appearances that should not count as games played
    # (an NHL goalie has no skater stats). None = every row is an appearance.
    row_filter: tuple[str, str] | None = field(default=None)


NFL = TrendSpec(
    code="nfl",
    league_id=NFL_LEAGUE_ID,
    stats_table="nfl_player_stats",
    trends_table="nfl_trends",
    # A 17-game season: 8 appearances is half of it and still leaves a
    # meaningful season baseline to compare a 3- or 5-game window against.
    min_season_games=8,
    stats=(
        StatSpec("payds",  0, "passing_yards",   25.0, 150.0),
        StatSpec("patd",   1, "passing_tds",      0.5,   0.75),
        StatSpec("ruyds",  2, "rushing_yards",   15.0,  30.0),
        StatSpec("rutd",   3, "rushing_tds",      0.4,   0.3),
        StatSpec("recyds", 4, "receiving_yards", 15.0,  30.0),
        StatSpec("rec",    5, "receptions",       1.0,   2.5),
        StatSpec("rectd",  6, "receiving_tds",    0.4,   0.3),
        StatSpec("tkl",    7, "tackles_total",    1.5,   3.0),
    ),
)

NHL = TrendSpec(
    code="nhl",
    league_id=NHL_LEAGUE_ID,
    stats_table="nhl_player_stats",
    trends_table="nhl_trends",
    min_season_games=20,
    stats=(
        StatSpec("g",    0, "goals",          0.4, 0.3),
        StatSpec("a",    1, "assists",        0.5, 0.4),
        StatSpec("p",    2, "points",         0.7, 0.7),
        StatSpec("sog",  3, "shots_on_goal",  1.0, 2.0),
        StatSpec("blk",  4, "blocks",         0.8, 1.0),
        StatSpec("hits", 5, "hits",           1.0, 1.5),
    ),
    # Every tracked NHL stat is a skater stat; goalies would be all-zero rows.
    row_filter=("position_type", "skater"),
)

SPECS: dict[str, TrendSpec] = {"nfl": NFL, "nhl": NHL}


def _season_bounds(league_id: int, season: int) -> tuple[str, str] | None:
    lo = (supabase.table("games").select("game_date")
          .eq("league_id", league_id).eq("season", season)
          .order("game_date").limit(1).execute()).data or []
    hi = (supabase.table("games").select("game_date")
          .eq("league_id", league_id).eq("season", season)
          .order("game_date", desc=True).limit(1).execute()).data or []
    if not lo or not hi:
        return None
    return lo[0]["game_date"], hi[0]["game_date"]


def _load_stats(spec: TrendSpec, start: str, end: str) -> list[dict]:
    """All player-game rows in the season window, newest first."""
    cols = ",".join(["player_id", "game_date"] + [s.column for s in spec.stats])
    if spec.row_filter:
        cols += f",{spec.row_filter[0]}"
    rows: list[dict] = []
    page = 0
    while True:
        q = (supabase.table(spec.stats_table).select(cols)
             .gte("game_date", start).lte("game_date", end))
        if spec.row_filter:
            q = q.eq(*spec.row_filter)
        # game_date alone is not a total order — a single slate is hundreds of
        # rows and range() paging over ties drops and repeats them. game_id
        # breaks the tie while keeping the newest-first order the windows need.
        batch = (q.order("game_date", desc=True).order("game_id", desc=True)
                 .order("player_id")
                 .range(page * PAGE, page * PAGE + PAGE - 1).execute()).data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        page += 1


def _z_rows(games: list[dict], stat: StatSpec,
            min_season_games: int) -> list[dict]:
    """Trend rows for one player and one stat. Empty when a gate rejects it."""
    values = [(g.get(stat.column) or 0) for g in games]
    if len(values) < min_season_games:
        return []

    season_avg = statistics.fmean(values)
    season_std = statistics.pstdev(values, mu=season_avg)
    if season_std == 0 or season_std < stat.min_std:
        return []

    out: list[dict] = []
    for w in WINDOWS:
        if len(games) < w:
            continue
        rolling_avg = statistics.fmean(values[:w])
        if rolling_avg < stat.min_rolling:
            continue
        z = (rolling_avg - season_avg) / season_std
        out.append({
            "stat": stat.stat_id,
            "window_size": w,
            "trend_val": round(max(min(z, Z_CAP), -Z_CAP), 4),
            "rolling_avg": round(rolling_avg, 4),
            "season_avg": round(season_avg, 4),
            "season_std": round(season_std, 4),
        })
    return out


def compute(code: str, season: int, dry_run: bool = False) -> int:
    spec = SPECS[code]
    bounds = _season_bounds(spec.league_id, season)
    if not bounds:
        print(f"  ERROR [{code}] no games for season {season}; aborting.")
        return 0
    start, end = bounds

    rows = _load_stats(spec, start, end)
    if not rows:
        print(f"  ERROR [{code}] no stat rows in {start}..{end}; aborting.")
        return 0

    by_player: dict[int, list[dict]] = {}
    for r in rows:
        by_player.setdefault(r["player_id"], []).append(r)

    print(f"[{code}] season {season} ({start}..{end}): {len(rows)} stat rows, "
          f"{len(by_player)} player(s)")

    trend_rows: list[dict] = []
    per_stat: dict[str, int] = {}
    qualified = 0
    for player_id, games in by_player.items():
        if len(games) < spec.min_season_games:
            continue
        qualified += 1
        for stat in spec.stats:
            for row in _z_rows(games, stat, spec.min_season_games):
                per_stat[stat.key] = per_stat.get(stat.key, 0) + 1
                trend_rows.append({"player_id": player_id, **row})

    print(f"  {qualified} player(s) cleared {spec.min_season_games}+ games; "
          f"{len(trend_rows)} trend row(s)")
    print(f"  per stat: {per_stat}")
    if not trend_rows:
        print(f"  WARNING [{code}] no trend rows produced — check the gates.")
        return 0
    if dry_run:
        return 0

    # Full replace: a stale row for a player who cooled off is worse than none.
    supabase.table(spec.trends_table).delete().neq("player_id", 0).execute()
    for i in range(0, len(trend_rows), 500):
        (supabase.table(spec.trends_table)
         .upsert(trend_rows[i:i + 500],
                 on_conflict="player_id,stat,window_size").execute())
    return len(trend_rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute NFL/NHL trend z-scores")
    parser.add_argument("--league", choices=sorted(SPECS), action="append",
                        help="Limit to one league (repeatable). Default: all.")
    parser.add_argument("--season", type=int, default=2025)
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute and report without writing")
    args = parser.parse_args()

    total = 0
    for code in (args.league or sorted(SPECS)):
        total += compute(code, args.season, dry_run=args.dry_run)
    print(f"\nDone — {total} trend row(s) written"
          f"{' (dry-run: none written)' if args.dry_run else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
