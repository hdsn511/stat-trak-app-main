"""
analytics/batch/espn_props_ingest.py

Stores historical main-market player prop lines from ESPN's core odds API into
espn_prop_lines. These are the backtest truth for the prop model: a sportsbook
line is close to a coin flip, so "does the model beat 50% at the book's own
line?" is the honest measure of prop edge. Kalshi has no price history.

Only "Total X" main markets are kept; "Live Odds" providers are in-game lines and
are ignored. Idempotent: games already stored are skipped.

CLI:
    python -m analytics.batch.espn_props_ingest --league nfl --season 2025
    python -m analytics.batch.espn_props_ingest --league nba --season 2025 --every 3
"""
from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import requests

from analytics.db.connection import BATCH_SIZE, supabase

CORE = "https://sports.core.api.espn.com/v2/sports"

# code -> (league_id, sport path, games column with ESPN event id, players column with ESPN id)
CFG = {
    "nba": (1, "basketball", "espn_id", "espn_id"),
    "nfl": (3, "football", "ext_id", "ext_id"),
}
PROP_TYPES = {
    "nba": {"Total Points": "pts", "Total Rebounds": "reb", "Total Assists": "ast",
            "Total 3-Point Field Goals": "fg3m"},
    "nfl": {"Total Passing Yards": "payds", "Total Rushing Yards": "ruyds",
            "Total Receiving Yards": "recyds", "Total Receptions": "rec",
            "Total Passing Touchdowns": "patd"},
}


def _paged(table: str, cols: str, order: str, **eq) -> list[dict]:
    out, page = [], 0
    while True:
        q = supabase.table(table).select(cols).order(order)
        for k, v in eq.items():
            q = q.eq(k, v)
        b = q.range(page * 1000, page * 1000 + 999).execute().data or []
        out += b
        if len(b) < 1000:
            return out
        page += 1


def _athlete_id(item: dict) -> Optional[str]:
    ref = (item.get("athlete") or {}).get("$ref", "")
    if "/athletes/" not in ref:
        return None
    return ref.split("/athletes/")[1].split("?")[0]


def _american(block: Optional[dict]) -> Optional[float]:
    try:
        return float(str((block or {}).get("american")).replace("+", ""))
    except (TypeError, ValueError):
        return None


def _implied(american: float) -> float:
    return 100 / (american + 100) if american > 0 else -american / (-american + 100)


def parse_prop_items(items: list[dict], code: str) -> list[dict]:
    """The MAIN line per (athlete, stat). ESPN mixes alt ladders into the same market
    type: ESPN BET lists 10-18 rows per receiver, mostly unpriced rungs. A main line
    is the one offered on both sides, so a line needs two rows at the same target,
    or priced over and under. Among several, keep the most balanced. Taking the first
    row instead picks arbitrary rungs and makes any model look like it beats the book."""
    types = PROP_TYPES[code]
    groups: dict[tuple[str, str], dict[float, list[dict]]] = {}
    for it in items:
        name = ((it.get("type") or {}).get("name") or "").replace(" (incl. overtime)", "")
        stat = types.get(name)
        ath = _athlete_id(it)
        if not stat or not ath:
            continue
        cur = ((it.get("current") or {}).get("target") or {}).get("value")
        if cur is None:
            continue    # unpriced rung with only an opening target
        groups.setdefault((ath, stat), {}).setdefault(float(cur), []).append(it)
    out = []
    for (ath, stat), by_line in groups.items():
        best, best_gap = None, 9.0
        for line, rows in by_line.items():
            over = next((_american((r.get("current") or {}).get("over")) for r in rows
                         if _american((r.get("current") or {}).get("over")) is not None), None)
            under = next((_american((r.get("current") or {}).get("under")) for r in rows
                          if _american((r.get("current") or {}).get("under")) is not None), None)
            if over is not None and under is not None:
                gap = abs(_implied(over) - _implied(under))
            elif len(rows) >= 2:
                gap = 1.0       # two-sided by row count, price unknown
            else:
                continue
            if gap < best_gap:
                best, best_gap = (line, rows, over), gap
        if not best:
            continue
        line, rows, over = best
        opn = ((rows[0].get("open") or {}).get("target") or {}).get("value")
        out.append({"ath": ath, "stat": stat, "line": line,
                    "open_line": float(opn) if opn is not None else None,
                    "over_odds": int(over) if over is not None else None})
    return out


def fetch_props(sport: str, code: str, ev: str) -> tuple[Optional[str], list[dict]]:
    """(provider name, parsed rows) for the first pre-game provider listing props."""
    try:
        r = requests.get(f"{CORE}/{sport}/leagues/{code}/events/{ev}/competitions/{ev}/odds", timeout=20)
        if not r.ok:
            return None, []
        for it in r.json().get("items", []):
            name = (it.get("provider") or {}).get("name", "")
            ref = (it.get("propBets") or {}).get("$ref")
            if not ref or "live" in name.lower():
                continue
            items, page = [], 1
            while True:
                q = requests.get(ref.replace("http:", "https:") + f"&limit=1000&page={page}", timeout=30)
                if not q.ok:
                    break
                d = q.json()
                items += d.get("items", [])
                if page >= d.get("pageCount", 1):
                    break
                page += 1
            rows = parse_prop_items(items, code)
            if rows:
                return name, rows
    except (requests.RequestException, ValueError):
        pass
    return None, []


def _upsert(rows: list[dict]) -> None:
    """Idempotent, so a transient Supabase timeout can safely retry."""
    for attempt in range(4):
        try:
            supabase.table("espn_prop_lines").upsert(rows, on_conflict="game_id,player_id,stat").execute()
            return
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", choices=sorted(CFG), required=True)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--every", type=int, default=1, help="only every Nth game (sampling)")
    ap.add_argument("--refresh", action="store_true", help="refetch games already stored")
    args = ap.parse_args()
    lid, sport, gcol, pcol = CFG[args.league]
    games = _paged("games", f"id,{gcol},game_type", "id", league_id=lid, season=args.season, status=2)
    games = [g for g in games if g.get(gcol) and g.get("game_type") != "preseason"][:: args.every]
    have = set() if args.refresh else {r["game_id"] for r in _paged("espn_prop_lines", "game_id", "game_id", league_id=lid, is_main=True)}
    todo = [g for g in games if g["id"] not in have]
    players = {str(p[pcol]): p["id"] for p in _paged("players", f"id,{pcol}", "id", league_id=lid) if p.get(pcol)}
    print(f"[props:{args.league} {args.season}] {len(todo)} game(s) to fetch")
    total = miss = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = ex.map(lambda g: fetch_props(sport, args.league, str(g[gcol])), todo)
        for i, (g, (prov, rows)) in enumerate(zip(todo, res), 1):
            recs = [{"game_id": g["id"], "league_id": lid, "player_id": players[r["ath"]],
                     "stat": r["stat"], "line": r["line"], "open_line": r["open_line"],
                     "over_odds": r["over_odds"], "provider": prov, "is_main": True}
                    for r in rows if r["ath"] in players]
            if not recs:
                miss += 1
            for j in range(0, len(recs), BATCH_SIZE):
                _upsert(recs[j:j + BATCH_SIZE])
            total += len(recs)
            if i % 50 == 0:
                print(f"  {i}/{len(todo)} games, {total} lines, {miss} without props", flush=True)
    print(f"[props:{args.league} {args.season}] done: {total} lines, {miss} game(s) without props")
    return 0


if __name__ == "__main__":
    sys.exit(main())
