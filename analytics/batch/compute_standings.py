"""
analytics/batch/compute_standings.py

Derives team_standings from the games table for the ESPN-backed leagues.

Standings are computed, never fetched: ESPN's standings resource reflects
current state only, so it cannot produce a historical or end-of-season table
and goes stale the moment a season ends. `games` already holds every final
score plus the OT/SO marker from backfill_game_ot, which is everything the
standings need.

Per-league rules:
  NHL — a loss past regulation is worth a point. W / L(regulation only) / OTL,
        points = 2W + OTL, and win_pct is the points percentage points/(2*GP),
        which is what the league actually ranks on.
  NFL — ties are real (one in 2025). W / L / T, pct = (W + 0.5T) / GP. An
        overtime loss is an ordinary loss, so ot_losses stays 0.

Playoff games are excluded — a standings table is a regular-season object.
games.game_type is 'other' for every ESPN-ingested row, so the cutoff comes
from REGULAR_SEASON_END below. The result is validated against the league's
known games-per-team and a mismatch is reported loudly rather than written.

Usage:
    python -m analytics.batch.compute_standings
    python -m analytics.batch.compute_standings --league nhl --season 2025
    python -m analytics.batch.compute_standings --dry-run
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass

from analytics.db.connection import NFL_LEAGUE_ID, NHL_LEAGUE_ID, supabase

PAGE = 1000


@dataclass(frozen=True)
class StandingsSpec:
    code: str
    league_id: int
    games_per_team: int          # regular-season games, for validation
    # Last date of the regular season, per season int. Playoffs start the day
    # after. Add an entry each season; a missing one aborts rather than
    # silently folding the playoffs into the table.
    regular_season_end: dict[int, str]
    points_for_ot_loss: bool     # NHL: OT/SO losses score a point


SPECS: dict[str, StandingsSpec] = {
    "nfl": StandingsSpec(
        code="nfl",
        league_id=NFL_LEAGUE_ID,
        games_per_team=17,
        regular_season_end={2025: "2026-01-05"},
        points_for_ot_loss=False,
    ),
    "nhl": StandingsSpec(
        code="nhl",
        league_id=NHL_LEAGUE_ID,
        games_per_team=82,
        regular_season_end={2025: "2026-04-16"},
        points_for_ot_loss=True,
    ),
}


@dataclass
class Record:
    """One team's running record. `log` is chronological for L10 and streak."""
    wins: int = 0
    losses: int = 0
    ties: int = 0
    ot_losses: int = 0
    points_for: int = 0
    points_against: int = 0

    def __post_init__(self) -> None:
        self.log: list[str] = []      # 'W' | 'L' | 'T', oldest first

    @property
    def games_played(self) -> int:
        return self.wins + self.losses + self.ties + self.ot_losses


def _load_games(spec: StandingsSpec, season: int, end_date: str) -> list[dict]:
    rows: list[dict] = []
    page = 0
    while True:
        batch = (supabase.table("games")
                 .select("id,game_date,home_team_id,away_team_id,"
                         "home_score,away_score,ot")
                 .eq("league_id", spec.league_id).eq("season", season)
                 .lte("game_date", end_date)
                 .not_.is_("home_score", "null")
                 # id breaks game_date ties: range() paging over a partial
                 # order silently drops and repeats rows across pages.
                 .order("game_date").order("id")
                 .range(page * PAGE, page * PAGE + PAGE - 1).execute()).data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        page += 1


def _streak(log: list[str]) -> str | None:
    """'W6' / 'L2' from the tail of a chronological result log."""
    if not log:
        return None
    last = log[-1]
    n = 0
    for r in reversed(log):
        if r != last:
            break
        n += 1
    return f"{last}{n}"


def build(spec: StandingsSpec, season: int) -> list[dict] | None:
    """Compute standings rows, or None if the input failed validation."""
    end_date = spec.regular_season_end.get(season)
    if not end_date:
        print(f"  ERROR [{spec.code}] no regular_season_end for season "
              f"{season}; add one to SPECS before computing. Aborting.")
        return None

    teams = (supabase.table("teams")
             .select("id,abbreviation,conference,division")
             .eq("league_id", spec.league_id).execute()).data or []
    if not teams:
        print(f"  ERROR [{spec.code}] no teams found. Aborting.")
        return None

    games = _load_games(spec, season, end_date)
    if not games:
        print(f"  ERROR [{spec.code}] no final games on/before {end_date} "
              f"for season {season}. Aborting.")
        return None

    recs: dict[int, Record] = {t["id"]: Record() for t in teams}

    for g in games:
        h, a = g["home_team_id"], g["away_team_id"]
        hs, as_ = g["home_score"], g["away_score"]
        if h not in recs or a not in recs:
            print(f"  WARNING [{spec.code}] game {g['id']} references an "
                  f"unknown team; skipped.")
            continue
        recs[h].points_for += hs
        recs[h].points_against += as_
        recs[a].points_for += as_
        recs[a].points_against += hs

        if hs == as_:                       # NFL tie
            for t in (h, a):
                recs[t].ties += 1
                recs[t].log.append("T")
            continue

        winner, loser = (h, a) if hs > as_ else (a, h)
        recs[winner].wins += 1
        recs[winner].log.append("W")
        if g.get("ot") and spec.points_for_ot_loss:
            recs[loser].ot_losses += 1
        else:
            recs[loser].losses += 1
        recs[loser].log.append("L")

    # Validate before writing — a wrong cutoff shows up here, not in the UI.
    bad = {t["abbreviation"]: recs[t["id"]].games_played for t in teams
           if recs[t["id"]].games_played != spec.games_per_team}
    if bad:
        print(f"  ERROR [{spec.code}] expected {spec.games_per_team} games per "
              f"team through {end_date}; got {bad}. Aborting — check "
              f"regular_season_end.")
        return None

    rows: list[dict] = []
    for t in teams:
        r = recs[t["id"]]
        gp = r.games_played
        pts = (2 * r.wins + r.ot_losses) if spec.points_for_ot_loss else r.wins
        pct = (pts / (2 * gp)) if spec.points_for_ot_loss \
            else ((r.wins + 0.5 * r.ties) / gp)
        last10 = r.log[-10:]
        rows.append({
            "league_id": spec.league_id,
            "season": season,
            "team_id": t["id"],
            "conference": t.get("conference"),
            "division": t.get("division"),
            "games_played": gp,
            "wins": r.wins,
            "losses": r.losses,
            "ties": r.ties,
            "ot_losses": r.ot_losses,
            "points": pts,
            "win_pct": round(pct, 4),
            "points_for": r.points_for,
            "points_against": r.points_against,
            "l10_wins": last10.count("W"),
            "l10_losses": len(last10) - last10.count("W"),
            "streak": _streak(r.log),
        })

    # Ranks: points for a points league, win pct otherwise. Ties break on total
    # wins first (the NHL ranks on wins before any other tiebreak) and then on
    # point differential, so the order is deterministic run to run.
    key = (lambda x: (-x["points"], -x["win_pct"], -x["wins"],
                      -(x["points_for"] - x["points_against"])))
    for scope in ("league_rank", "conf_rank", "div_rank"):
        field = {"conf_rank": "conference", "div_rank": "division"}.get(scope)
        groups: dict[object, list[dict]] = {}
        for row in rows:
            groups.setdefault(row[field] if field else None, []).append(row)
        for group in groups.values():
            for i, row in enumerate(sorted(group, key=key), 1):
                row[scope] = i
    return rows


def compute(code: str, season: int, dry_run: bool = False) -> int:
    spec = SPECS[code]
    rows = build(spec, season)
    if rows is None:
        return 0

    print(f"[{code}] season {season}: {len(rows)} team row(s)")
    if dry_run:
        top = sorted(rows, key=lambda r: (r["conference"] or "", r["conf_rank"]))
        for r in top[:8]:
            rec = (f"{r['wins']}-{r['losses']}-{r['ot_losses']}"
                   if spec.points_for_ot_loss
                   else f"{r['wins']}-{r['losses']}-{r['ties']}")
            print(f"    {r['conference']} #{r['conf_rank']:<2} team={r['team_id']:<4} "
                  f"{rec}  pts={r['points']:<3} pct={r['win_pct']:.3f} "
                  f"L10={r['l10_wins']}-{r['l10_losses']} {r['streak']}")
        return 0

    supabase.table("team_standings").upsert(
        rows, on_conflict="league_id,season,team_id").execute()
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute team_standings from games")
    parser.add_argument("--league", choices=sorted(SPECS), action="append",
                        help="Limit to one league (repeatable). Default: all.")
    parser.add_argument("--season", type=int, default=2025)
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute and print without writing")
    args = parser.parse_args()

    total = 0
    for code in (args.league or sorted(SPECS)):
        total += compute(code, args.season, dry_run=args.dry_run)
    print(f"\nDone — {total} standings row(s) written"
          f"{' (dry-run: none written)' if args.dry_run else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
