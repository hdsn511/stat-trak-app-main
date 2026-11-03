"""
analytics/batch/compute_team_defense.py

Builds the opponent "allowed to position" signals from player box scores:
  team_position_allowed  per game: what each defense gave up to QB/RB/WR/TE
  team_defense_rolling   latest season-to-date snapshot per defense: allowed/game,
                         last-5 form, delta vs league average, z-score, rank
                         (rank 1 = allows the most = softest matchup)

NFL only for now. Full-game values are stored — a backtest showed they predict
next-game output at least as well as garbage-time-excluded values; blowouts are
identified by joining game_garbage_time.

CLI:
    python -m analytics.batch.compute_team_defense --league nfl --season 2025
    python -m analytics.batch.compute_team_defense --league nfl          # all seasons
"""

from __future__ import annotations

import argparse
import sys

import numpy as np
import pandas as pd

from analytics.db.connection import BATCH_SIZE, NFL_LEAGUE_ID, supabase

MIN_GAMES = 4

# position group -> {stat_key: nfl_player_stats column}
NFL_STATS = {
    "QB": {"pass_yds": "passing_yards", "pass_att": "attempts", "pass_comp": "completions",
           "pass_td": "passing_tds", "int": "interceptions", "sacked": "sacks_taken",
           "rush_yds": "rushing_yards"},
    "RB": {"rush_yds": "rushing_yards", "carries": "carries", "rush_td": "rushing_tds",
           "rec_yds": "receiving_yards", "rec": "receptions", "tgt": "targets"},
    "WR": {"rec_yds": "receiving_yards", "rec": "receptions", "tgt": "targets",
           "rec_td": "receiving_tds"},
    "TE": {"rec_yds": "receiving_yards", "rec": "receptions", "tgt": "targets",
           "rec_td": "receiving_tds"},
}
GROUP_OF = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}


def _paged(table: str, cols: str, order: str = "id", **eq) -> pd.DataFrame:
    out, page = [], 0
    while True:
        q = supabase.table(table).select(cols).order(order)
        for k, v in eq.items():
            q = q.eq(k, v)
        b = q.range(page * 1000, page * 1000 + 999).execute().data or []
        out += b
        if len(b) < 1000:
            return pd.DataFrame(out)
        page += 1


def build_game_rows(season: int | None) -> pd.DataFrame:
    games = _paged("games", "id,season,game_date,home_team_id,away_team_id",
                   league_id=NFL_LEAGUE_ID, status=2)
    if season:
        games = games[games.season == season]
    games = games.rename(columns={"id": "game_id"})
    cols = sorted({c for m in NFL_STATS.values() for c in m.values()})
    st = _paged("nfl_player_stats", "game_id,player_id,team_id," + ",".join(cols), order="game_id")
    pl = _paged("players", "id,position", league_id=NFL_LEAGUE_ID).rename(columns={"id": "player_id"})
    st = st.merge(pl, on="player_id").merge(games, on="game_id")
    st["grp"] = st.position.map(GROUP_OF)
    st = st[st.grp.notna()].copy()
    st["opp_team_id"] = st.team_id          # the offense
    st["team_id"] = np.where(st.opp_team_id == st.home_team_id, st.away_team_id, st.home_team_id)
    recs = []
    for grp, m in NFL_STATS.items():
        d = st[st.grp == grp]
        agg = d.groupby(["game_id", "team_id", "opp_team_id", "season", "game_date"])
        n = agg.player_id.nunique()
        for key, col in m.items():
            v = agg[col].sum(min_count=1).dropna().reset_index(name="value")
            v["position_group"], v["stat_key"] = grp, key
            v["n_players"] = v.set_index(["game_id", "team_id", "opp_team_id", "season", "game_date"]).index.map(n).values
            recs.append(v)
    out = pd.concat(recs, ignore_index=True)
    out["league_id"] = NFL_LEAGUE_ID
    return out


def build_rolling(rows: pd.DataFrame) -> pd.DataFrame:
    out = []
    for (season, grp, key), d in rows.groupby(["season", "position_group", "stat_key"]):
        d = d.sort_values("game_date")
        per_team = d.groupby("team_id")
        agg = per_team.value.agg(["mean", "count"])
        agg["l5"] = per_team.value.apply(lambda s: s.tail(5).mean())
        agg["as_of"] = per_team.game_date.max()
        agg = agg[agg["count"] >= MIN_GAMES]
        if len(agg) < 4:
            continue
        lg = agg["mean"].mean()
        sd = agg["mean"].std(ddof=0) or np.nan
        agg["delta"] = agg["mean"] - lg
        agg["z"] = agg["delta"] / sd
        agg["rank"] = agg["mean"].rank(ascending=False, method="min")
        for team, r in agg.iterrows():
            out.append({"league_id": NFL_LEAGUE_ID, "team_id": int(team), "season": int(season),
                        "position_group": grp, "stat_key": key, "as_of_date": str(r.as_of),
                        "n_games": int(r["count"]), "allowed_pg": float(r["mean"]),
                        "allowed_l5": float(r.l5), "league_avg_pg": float(lg),
                        "delta": float(r.delta),
                        "z_score": None if pd.isna(r.z) else float(r.z),
                        "league_rank": int(r["rank"])})
    return pd.DataFrame(out)


def _upsert(table: str, df: pd.DataFrame, conflict: str) -> None:
    recs = df.replace({np.nan: None}).to_dict("records")
    for i in range(0, len(recs), BATCH_SIZE):
        supabase.table(table).upsert(recs[i:i + BATCH_SIZE], on_conflict=conflict).execute()


def main() -> int:
    ap = argparse.ArgumentParser(description="Compute opponent allowed-to-position")
    ap.add_argument("--league", choices=["nfl"], required=True)
    ap.add_argument("--season", type=int)
    args = ap.parse_args()
    rows = build_game_rows(args.season)
    print(f"[defense:nfl] {len(rows)} game x position x stat rows")
    rows["game_date"] = rows.game_date.astype(str)
    rows["season"] = rows.season.astype(int)
    keep = ["game_id", "team_id", "league_id", "opp_team_id", "season", "game_date",
            "position_group", "stat_key", "value", "n_players"]
    _upsert("team_position_allowed", rows[keep], "game_id,team_id,position_group,stat_key")
    roll = build_rolling(rows)
    _upsert("team_defense_rolling", roll, "league_id,team_id,season,position_group,stat_key")
    print(f"[defense:nfl] {len(roll)} rolling snapshot rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
