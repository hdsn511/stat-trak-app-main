"""
analytics/batch/odds_ingest.py

Stores one pre-game consensus line per game from ESPN's core odds API:
    https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{id}/competitions/{id}/odds

Free and keyless. 2023 games list 11-13 books; 2024+ usually one (ESPN BET /
DraftKings). "Live Odds" entries are in-game lines and are ignored.

CLI:
    python -m analytics.batch.odds_ingest --league nba --season 2025
    python -m analytics.batch.odds_ingest --league nfl            # every season
"""

from __future__ import annotations

import argparse
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

from analytics.db.connection import BATCH_SIZE, supabase

CORE = "https://sports.core.api.espn.com/v2/sports"
CFG = {  # code -> (league_id, sport path, games column holding the ESPN event id)
    "nba": (1, "basketball", "espn_id"),
    "nfl": (3, "football", "ext_id"),
    "nhl": (4, "hockey", "ext_id"),
}
PREFERRED = ["DraftKings", "ESPN BET", "Caesars Sportsbook"]


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _home_spread(item: dict):
    """(close, open) spread from the home team's perspective; negative = favored."""
    h = item.get("homeTeamOdds") or {}
    def pick(block):
        return _num(((block or {}).get("pointSpread") or {}).get("american"))
    close = pick(h.get("close")) if h.get("close") else None
    if close is None:
        close = pick(h.get("current"))
    if close is None and item.get("spread") is not None:
        mag = abs(float(item["spread"]))
        close = -mag if h.get("favorite") else mag
    return close, pick(h.get("open"))


def parse_odds(items: list[dict]):
    books = []
    for it in items:
        name = (it.get("provider") or {}).get("name", "")
        if "live" in name.lower():
            continue
        close, opn = _home_spread(it)
        if close is None:
            continue
        books.append({"name": name, "spread": close, "open": opn,
                      "total": _num(it.get("overUnder")),
                      "home_ml": (it.get("homeTeamOdds") or {}).get("moneyLine"),
                      "away_ml": (it.get("awayTeamOdds") or {}).get("moneyLine")})
    if not books:
        return None
    books.sort(key=lambda b: next((i for i, p in enumerate(PREFERRED) if b["name"].startswith(p)), 99))
    b = books[0]
    return {"provider": b["name"], "n_books": len(books), "spread_home": b["spread"],
            "open_spread_home": b["open"], "total": b["total"],
            "home_ml": b["home_ml"], "away_ml": b["away_ml"],
            "median_spread_home": statistics.median(x["spread"] for x in books)}


def fetch(args):
    sport, code, ext = args
    try:
        r = requests.get(f"{CORE}/{sport}/leagues/{code}/events/{ext}/competitions/{ext}/odds",
                         timeout=20)
        if not r.ok:
            return None
        return parse_odds(r.json().get("items", []))
    except (requests.RequestException, ValueError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", choices=sorted(CFG), required=True)
    ap.add_argument("--season", type=int)
    args = ap.parse_args()
    lid, sport, col = CFG[args.league]
    games, page = [], 0
    while True:
        q = supabase.table("games").select(f"id,{col}").eq("league_id", lid).eq("status", 2).order("id")
        if args.season:
            q = q.eq("season", args.season)
        b = q.range(page * 1000, page * 1000 + 999).execute().data or []
        games += b
        if len(b) < 1000:
            break
        page += 1
    have, page = set(), 0
    while True:
        b = (supabase.table("game_odds").select("game_id").eq("league_id", lid).order("game_id")
             .range(page * 1000, page * 1000 + 999).execute().data or [])
        have |= {r["game_id"] for r in b}
        if len(b) < 1000:
            break
        page += 1
    todo = [g for g in games if g.get(col) and g["id"] not in have]
    print(f"[odds:{args.league}] {len(todo)} game(s) to fetch ({len(games)-len(todo)} done/no id)")
    rows, miss = [], 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for i, (g, res) in enumerate(zip(todo, ex.map(fetch, [(sport, args.league, str(g[col])) for g in todo])), 1):
            if res:
                rows.append({"game_id": g["id"], "league_id": lid, **res})
            else:
                miss += 1
            if len(rows) >= BATCH_SIZE:
                supabase.table("game_odds").upsert(rows, on_conflict="game_id").execute()
                rows = []
            if i % 250 == 0:
                print(f"  {i}/{len(todo)} fetched, {miss} without odds")
    if rows:
        supabase.table("game_odds").upsert(rows, on_conflict="game_id").execute()
    print(f"[odds:{args.league}] done, {miss} game(s) without usable odds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
