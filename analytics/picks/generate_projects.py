"""
analytics/picks/generate_projects.py

"Projects" picks for the NBA and NFL league pages: player props and moneylines at
moderate probability, priced against executable Kalshi quotes.

  player prop: model_prob <= PROP_MAX_PROB, edge >= PROP_MIN_EDGE
  moneyline:   model_prob <  ML_MAX_PROB,  edge >= ML_MIN_EDGE
  edge = model_prob - the price you would pay (ask for YES, 1 - bid for NO)

model_prob is calibrated, never a raw hit rate. See engine/prop_model.py and
engine/win_model.py for the evidence behind each.

Rows are pick_results with pick_type='project' and follow the same additive-lock
contract as MLB: frozen at first creation, later runs only add. Games that have
started are never priced. Nothing is ever deleted: if a player is later ruled out,
the row gets modifiers.void and the API hides it.

CLI:
    python -m analytics.picks.generate_projects --league nfl
    python -m analytics.picks.generate_projects --league nba --dry-run
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from analytics.batch.odds_ingest import fetch as fetch_espn_odds
from analytics.data.espn.client import get_injuries
from analytics.db.connection import supabase
from analytics.engine.prop_model import History, SPEC, _paged, calibrated_over
from analytics.engine.win_model import WinModel, devig
from analytics.kalshi.client import KalshiClient

PROP_MAX_PROB = 0.60    # inclusive
ML_MAX_PROB = 0.70      # strict
PROP_MIN_EDGE = 0.03
ML_MIN_EDGE = 0.02      # roughly Kalshi's taker fee near even money
MAX_SPREAD = 0.05       # a wider quote is not a price
MIN_VOLUME_PROP = 10.0
MIN_VOLUME_ML = 50.0
# Calibration was fit at book main lines, so it is only validated near even money.
# A wider band let stale-role players through: the market had a new starter at 64% to
# clear a line, the model only knew his old role, and that read as a 10-point edge.
MID_RANGE = (0.40, 0.60)

CFG = {
    "nba": {"sport": "basketball", "game_col": "espn_id", "player_col": "espn_id", "days": 1,
            "aliases": {},
            "out": {"out", "doubtful", "questionable", "day-to-day", "suspension"},
            "min_line": {"pts": 9.5, "reb": 2.5, "ast": 1.5, "fg3m": 0.5}},
    "nfl": {"sport": "football", "game_col": "ext_id", "player_col": "ext_id", "days": 7,
            "aliases": {"JAX": "JAC", "WSH": "WAS", "LAR": "LA"},
            "out": {"out", "doubtful", "questionable", "injured reserve", "suspension", "pup"},
            "min_line": {"payds": 100.5, "patd": 0.5, "ruyds": 9.5, "recyds": 9.5, "rec": 0.5}},
}
_MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def norm_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.'\-]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_event(ticker: str) -> Optional[tuple[str, str]]:
    """'KXNFLREC-26NOV01BALBUF-BUFDMOORE2-5' -> ('2026-11-01', 'BALBUF')."""
    parts = ticker.split("-")
    if len(parts) < 2:
        return None
    m = re.match(r"^(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$", parts[1])
    if not m or m.group(2) not in _MONTHS:
        return None
    return f"20{m.group(1)}-{_MONTHS[m.group(2)]:02d}-{m.group(3)}", m.group(4)


def _started(game: dict, now: datetime) -> bool:
    gt = game.get("game_time")
    if not gt or game.get("status") != 0:
        return True     # no kickoff time means we can't prove it hasn't started
    return datetime.fromisoformat(gt.replace("Z", "+00:00")) <= now


def _load_slate(league: str, now: datetime) -> tuple[dict, dict, dict]:
    """(event key -> game, team id -> abbr, kalshi abbr -> team id) for unstarted games."""
    cfg, lid = CFG[league], SPEC[league]["league_id"]
    today = now.astimezone(ZoneInfo("America/New_York")).date()
    end = today + timedelta(days=cfg["days"])
    teams = supabase.table("teams").select("id,abbreviation").eq("league_id", lid).execute().data or []
    id_abbr = {t["id"]: t["abbreviation"].upper() for t in teams}
    kal = {tid: cfg["aliases"].get(a, a) for tid, a in id_abbr.items()}
    games = (supabase.table("games")
             .select("id,game_date,game_time,status,home_team_id,away_team_id,season,ext_id,espn_id")
             .eq("league_id", lid).gte("game_date", today.isoformat()).lte("game_date", end.isoformat())
             .execute().data or [])
    slate = {}
    for g in games:
        if _started(g, now):
            continue
        slate[(g["game_date"], kal[g["away_team_id"]] + kal[g["home_team_id"]])] = g
    return slate, id_abbr, {a: tid for tid, a in kal.items()}


def _injured(league: str) -> set[str]:
    """ESPN athlete ids listed with a status that makes a pick unsafe. Questionable is
    included: the market prices that news and this model can't see it."""
    out = set()
    for team in get_injuries(CFG[league]["sport"], league):
        for inj in team.get("injuries", []):
            status = (inj.get("status") or "").strip().lower()
            ath = inj.get("athlete") or {}
            ref = ((ath.get("links") or [{}])[0].get("href") or "")
            m = re.search(r"/id/(\d+)", ref)
            aid = str(ath.get("id") or (m.group(1) if m else "") or inj.get("id") or "")
            if aid and status in CFG[league]["out"]:
                out.add(aid)
    return out


def price_prop(league: str, stat: str, raw: float, q: dict) -> Optional[dict]:
    """Best side of one Kalshi rung, or None if unpriceable or nothing clears the gates."""
    bid, ask, vol = q.get("yes_bid"), q.get("yes_ask"), q.get("volume") or 0.0
    if not bid or not ask or ask - bid > MAX_SPREAD or vol < MIN_VOLUME_PROP:
        return None
    mid = (bid + ask) / 2
    if not MID_RANGE[0] <= mid <= MID_RANGE[1]:
        return None
    p_over = calibrated_over(league, stat, raw, mid)
    sides = [("over", p_over, ask), ("under", 1 - p_over, 1 - bid)]
    best = None
    for side, p, price in sides:
        p, price = round(p, 4), round(price, 4)
        edge = round(p - price, 4)
        if p <= PROP_MAX_PROB and edge >= PROP_MIN_EDGE and (best is None or edge > best["edge"]):
            best = {"side": side, "model_prob": p, "implied_prob": price, "edge": edge}
    return best


def price_moneyline(p: float, q: dict) -> Optional[dict]:
    bid, ask, vol = q.get("yes_bid"), q.get("yes_ask"), q.get("volume") or 0.0
    if not bid or not ask or ask - bid > MAX_SPREAD or vol < MIN_VOLUME_ML:
        return None
    p, ask = round(p, 4), round(ask, 4)
    edge = round(p - ask, 4)
    if p < ML_MAX_PROB and edge >= ML_MIN_EDGE:
        return {"model_prob": p, "implied_prob": ask, "edge": edge}
    return None


def generate(league: str, dry_run: bool = False) -> list[dict]:
    cfg, lid = CFG[league], SPEC[league]["league_id"]
    now = datetime.now(timezone.utc)
    slate, id_abbr, kal_team = _load_slate(league, now)
    print(f"[projects:{league}] {len(slate)} unstarted game(s) in window")
    if not slate:
        print("  No slate. Nothing to do.")
        return []

    kalshi = KalshiClient(sport=league)
    if kalshi.mock:
        # Mock mode returns synthetic prices, which must never become picks.
        print("  ERROR: Kalshi credentials unavailable. Refusing to price against mock data.")
        return []
    markets = kalshi.get_nba_markets(list(kalshi.player_prop_series) + ["KXNFLGAME" if league == "nfl" else "KXNBAGAME"])
    props = kalshi.parse_player_props(markets)
    gprops = kalshi.parse_game_props(markets)
    print(f"  Kalshi: {len(markets)} markets, {len(props)} player-stat combos, {len(gprops)} game events")

    players = _paged("players", f"id,name,team,is_active,{cfg['player_col']}", "id", league_id=lid)
    by_name: dict[str, list[dict]] = {}
    for p in players:
        by_name.setdefault(norm_name(p["name"]), []).append(p)
    injured = _injured(league)
    hist = History(league)
    print(f"  {len(injured)} injured athletes, {len(hist.df)} history rows")

    picks: list[dict] = []
    lines: list[dict] = []
    unmatched_players: set[str] = set()
    best: dict[tuple[int, str, str], dict] = {}
    n_rungs = 0
    for (name, stat), entries in props.items():
        if stat not in SPEC[league]["stats"]:
            continue    # no calibration for this stat (e.g. NBA steals/blocks)
        for e in entries:
            ev = parse_event(e["ticker"])
            game = slate.get(ev) if ev else None
            if not game:
                continue
            candidates = by_name.get(norm_name(name), [])
            parts = e["ticker"].split("-")
            code = parts[2] if len(parts) > 2 else ""
            team_id = next((tid for a, tid in kal_team.items() if code.startswith(a)
                            and tid in (game["home_team_id"], game["away_team_id"])), None)
            team_abbr = id_abbr.get(team_id, "")
            on_team = [c for c in candidates if (c.get("team") or "").upper() == team_abbr]
            cand = on_team or [c for c in candidates if c.get("is_active")]
            if len(cand) != 1 or team_id is None:
                unmatched_players.add(name)
                continue    # ambiguous identity: skip rather than risk the wrong player
            pl = cand[0]
            lines.append({"league_id": lid, "game_date": game["game_date"], "prop_type": "player",
                          "entity_id": pl["id"], "stat": stat, "line": e["line"],
                          "kalshi_price": e["price"], "implied_prob": e["implied_prob"],
                          "market_ticker": e["ticker"], "is_first_half": False, "team_id": team_id})
            if str(pl.get(cfg["player_col"]) or "") in injured or e["line"] < cfg["min_line"].get(stat, 0):
                continue
            opp = game["away_team_id"] if team_id == game["home_team_id"] else game["home_team_id"]
            est = hist.raw_over_prob(pl["id"], stat, e["line"], game["game_date"], opp, game["season"])
            if not est:
                continue
            n_rungs += 1
            pr = price_prop(league, stat, est["raw"], e)
            if not pr:
                continue
            key = (pl["id"], stat, game["game_date"])
            row = {**pr, "line": e["line"], "raw": est["raw"], "n": est["n"], "player": pl, "game": game,
                   "stat": stat, "ticker": e["ticker"], "opp_factor": est["opp_factor"], "mean": est["mean"],
                   "team_abbr": team_abbr}
            if key not in best or row["edge"] > best[key]["edge"]:
                best[key] = row
    if unmatched_players:
        print(f"  {len(unmatched_players)} Kalshi name(s) unmatched or ambiguous, e.g. {sorted(unmatched_players)[:6]}")
    print(f"  Priced {n_rungs} prop rungs; {len(best)} player-stat picks clear the gates")
    for r in best.values():
        picks.append({
            "league_id": lid, "game_date": r["game"]["game_date"], "game_id": r["game"]["id"],
            "prop_type": "player", "entity_id": r["player"]["id"], "stat": r["stat"], "pick_type": "project",
            "recommended_line": r["line"], "hit_rate": r["model_prob"], "model_prob": r["model_prob"],
            "raw_prob": round(r["raw"] if r["side"] == "over" else 1 - r["raw"], 4),
            "sample_size": r["n"], "confidence_score": round(r["model_prob"] * 100, 2),
            "implied_prob": r["implied_prob"], "edge": r["edge"], "market_ticker": r["ticker"],
            "price_source": "kalshi",
            "modifiers": {"side": r["side"], "team_abbr": r["team_abbr"], "opp_factor": r["opp_factor"],
                          "proj_mean": r["mean"]},
        })

    # Moneylines
    wm = WinModel(league)
    n_ml = 0
    sides: dict[int, list[dict]] = {}
    for (ek, ptype), entries in gprops.items():
        if ptype != "winner":
            continue
        for e in entries:
            ev = parse_event(e["ticker"])
            game = slate.get(ev) if ev else None
            team_id = kal_team.get(e.get("team_abbr") or "")
            if not game or team_id not in (game["home_team_id"], game["away_team_id"]):
                continue
            lines.append({"league_id": lid, "game_date": game["game_date"], "prop_type": "winner",
                          "entity_id": game["id"], "stat": "winner", "line": None,
                          "kalshi_price": e["price"], "implied_prob": e["implied_prob"],
                          "market_ticker": e["ticker"], "is_first_half": False, "team_id": team_id})
            sides.setdefault(game["id"], []).append({"e": e, "team_id": team_id, "game": game})
    for gid, ss in sides.items():
        game = ss[0]["game"]
        ext = game.get(cfg["game_col"])
        odds = fetch_espn_odds((cfg["sport"], league, str(ext))) if ext else None
        mkt = devig(odds.get("home_ml"), odds.get("away_ml")) if odds else None
        if mkt is None:
            print(f"  game {gid}: no ESPN moneyline, skipped (no anchor, no pick)")
            continue
        raw_h, p_h = wm.home_prob(game["home_team_id"], game["away_team_id"], game["game_date"], mkt)
        n_ml += 1
        cands = []
        for s in ss:
            is_home = s["team_id"] == game["home_team_id"]
            pr = price_moneyline(p_h if is_home else 1 - p_h, s["e"])
            q = s["e"]
            print(f"  ML {q['ticker']}: p={(p_h if is_home else 1 - p_h):.3f} bid={q.get('yes_bid')} "
                  f"ask={q.get('yes_ask')} vol={q.get('volume')} {'PASS' if pr else 'no'}")
            if pr:
                cands.append({**pr, **s, "raw": raw_h if is_home else 1 - raw_h,
                              "book": mkt if is_home else 1 - mkt})
        if cands:
            c = max(cands, key=lambda x: x["edge"])
            picks.append({
                "league_id": lid, "game_date": game["game_date"], "game_id": gid, "prop_type": "winner",
                "entity_id": gid, "stat": "winner", "pick_type": "project", "recommended_line": None,
                "hit_rate": c["model_prob"], "model_prob": c["model_prob"], "raw_prob": round(c["raw"], 4),
                "sample_size": wm.c["n_train"], "confidence_score": round(c["model_prob"] * 100, 2),
                "implied_prob": c["implied_prob"], "edge": c["edge"], "market_ticker": c["e"]["ticker"],
                "price_source": "kalshi",
                "modifiers": {"side": "win", "team_abbr": id_abbr[c["team_id"]], "team_id": c["team_id"],
                              "book_prob": round(c["book"], 4), "book": odds.get("provider")},
            })
    print(f"  Priced {n_ml} moneyline game(s); total picks {len(picks)}")

    for p in sorted(picks, key=lambda x: -x["edge"])[:15]:
        print(f"   {p['game_date']} {p['prop_type']:6} {p['stat']:7} id={p['entity_id']:<7} "
              f"{p['modifiers'].get('side'):5} {str(p['recommended_line']):6} "
              f"p={p['model_prob']:.3f} px={p['implied_prob']:.3f} edge={p['edge']:+.3f} {p['market_ticker']}")
    if dry_run:
        print("  --dry-run: nothing stored")
        return picks
    _store_lines(lid, lines)
    _store_picks(lid, picks)
    _void_injured(league, lid, players, injured, now)
    return picks


def _store_lines(lid: int, rows: list[dict]) -> None:
    """Additive: first-seen price per (date, ticker)."""
    if not rows:
        return
    dates = sorted({r["game_date"] for r in rows})
    seen = set()
    for d in dates:
        page = 0
        while True:
            b = (supabase.table("daily_lines").select("market_ticker").eq("league_id", lid).eq("game_date", d)
                 .order("id").range(page, page + 999).execute().data or [])
            seen |= {(d, r["market_ticker"]) for r in b}
            if len(b) < 1000:
                break
            page += 1000
    new, batch_seen = [], set()
    for r in rows:
        k = (r["game_date"], r["market_ticker"])
        if k not in seen and k not in batch_seen:
            batch_seen.add(k)
            new.append(r)
    for i in range(0, len(new), 500):
        supabase.table("daily_lines").insert(new[i:i + 500]).execute()
    print(f"  daily_lines: added {len(new)} ({len(rows) - len(new)} already present)")


def _store_picks(lid: int, picks: list[dict]) -> None:
    """Additive lock: (game_date, entity, stat, 'project') is frozen once stored."""
    if not picks:
        print("  pick_results: nothing new")
        return
    dates = sorted({p["game_date"] for p in picks})
    existing = (supabase.table("pick_results").select("game_date,entity_id,stat").eq("league_id", lid)
                .eq("pick_type", "project").in_("game_date", dates).execute().data or [])
    seen = {(r["game_date"], r["entity_id"], r["stat"]) for r in existing}
    new = [p for p in picks if (p["game_date"], p["entity_id"], p["stat"]) not in seen]
    for i in range(0, len(new), 500):
        supabase.table("pick_results").insert(new[i:i + 500]).execute()
    print(f"  pick_results: added {len(new)} ({len(picks) - len(new)} already locked)")


def _void_injured(league: str, lid: int, players: list[dict], injured: set[str], now: datetime) -> None:
    """Flag, never delete, locked ungraded picks whose player has since been ruled out."""
    today = now.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    rows = (supabase.table("pick_results").select("id,entity_id,modifiers").eq("league_id", lid)
            .eq("pick_type", "project").eq("prop_type", "player").gte("game_date", today)
            .is_("actual_result", "null").execute().data or [])
    ids = {p["id"]: str(p.get(CFG[league]["player_col"]) or "") for p in players}
    n = 0
    for r in rows:
        if ids.get(r["entity_id"]) in injured and not (r.get("modifiers") or {}).get("void"):
            supabase.table("pick_results").update({"modifiers": {**(r.get("modifiers") or {}), "void": "injury"}}).eq("id", r["id"]).execute()
            n += 1
    if n:
        print(f"  voided {n} locked pick(s): player since ruled out")


def main() -> int:
    ap = argparse.ArgumentParser(description="NBA/NFL Projects pick generator")
    ap.add_argument("--league", choices=sorted(CFG), required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    generate(args.league, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
