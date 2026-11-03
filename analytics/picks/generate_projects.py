"""
analytics/picks/generate_projects.py

"Projects" picks for the NBA and NFL league pages. The book is treated as accurate;
context decides which priced sides we believe in.

  player props: every Kalshi rung, both sides, priced within prop_context.BAND
      (the price you would pay: ask for YES, 1 - bid for NO). model_prob is the
      context hit model (engine/prop_context.py). A side is "believed" when recent
      form supports it (z20_s >= BELIEF_Z). Each game keeps its top GAME_PROPS; the
      league features the best LEAGUE_PROPS, one per game and player, walking
      FALLBACK tiers so the card always fills: the veto (model_prob < price) is only
      relaxed when the stricter tier can't supply three.
  winners: every game gets a predicted winner at the de-vigged ESPN moneyline, with
      the Elo rating (engine/win_model.py) as an agree/disagree check. One is
      featured, preferring ML_BAND with Elo agreeing.

modifiers.featured marks the card picks; modifiers.game_rank orders a game's props.

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
from analytics.engine.prop_context import BAND, BELIEF_Z, HitModel, context, sided
from analytics.engine.prop_model import History, SPEC, _paged
from analytics.engine.win_model import WinModel, devig
from analytics.kalshi.client import KalshiClient

ML_BAND = (0.60, 0.70)  # featured winner: favorites that are priced to hit, not locks
MAX_SPREAD = 0.05       # a wider quote is not a price
MIN_VOLUME_PROP = 10.0
MIN_VOLUME_ML = 50.0
LEAGUE_PROPS = 3        # featured on the league card
GAME_PROPS = 3          # kept per game for the game view
# Featured-prop tiers, strictest first. A later tier only fills slots the earlier
# ones left empty: "belief" drops the veto, "any" drops the form requirement too.
FALLBACK = ("belief_no_veto", "belief", "any")

CFG = {
    "nba": {"sport": "basketball", "game_col": "espn_id", "player_col": "espn_id", "days": 1,
            "aliases": {},
            "out": {"out", "doubtful", "questionable", "day-to-day", "suspension"},
            "min_line": {"pts": 9.5, "reb": 2.5, "ast": 1.5, "fg3m": 0.5}},
    "nfl": {"sport": "football", "game_col": "ext_id", "player_col": "ext_id", "days": 7,
            "aliases": {"JAX": "JAC", "WSH": "WAS", "LAR": "LA"},
            "out": {"out", "doubtful", "questionable", "injured reserve", "suspension", "pup"},
            "min_line": {"payds": 100.5, "patd": 0.5, "ruyds": 9.5, "recyds": 9.5, "rec": 0.5},
            "refeature": True},
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


def price_sides(league: str, stat: str, ctx: dict, q: dict, hm: HitModel) -> list[dict]:
    """Both sides of one Kalshi rung that are priced within BAND, scored by the hit model."""
    bid, ask, vol = q.get("yes_bid"), q.get("yes_ask"), q.get("volume") or 0.0
    if not bid or not ask or ask - bid > MAX_SPREAD or vol < MIN_VOLUME_PROP:
        return []
    out = []
    for side, price in (("over", ask), ("under", 1 - bid)):
        price = round(price, 4)
        if not BAND[0] <= price <= BAND[1]:
            continue
        f = sided(league, ctx, stat, side, price)
        p = round(hm.prob(f), 4)
        out.append({"side": side, "model_prob": p, "implied_prob": price, "edge": round(p - price, 4),
                    "z20_s": round(f["z20_s"], 3), "belief": f["z20_s"] >= BELIEF_Z})
    return out


def _rank(c: dict) -> tuple:
    return (c["belief"], c["model_prob"])


def _tier_ok(c: dict, tier: str) -> bool:
    if tier == "belief_no_veto":
        return c["belief"] and c["edge"] >= 0
    if tier == "belief":
        return c["belief"]
    return True


def select_featured(cands: list[dict], n: int = LEAGUE_PROPS, tiers: tuple = FALLBACK) -> list[dict]:
    """Best n across the league, one per player, strictest tier first. One per game too,
    unless the slate has too few games (e.g. a lone Thursday NFL game) to fill n."""
    chosen: list[dict] = []
    games: set[int] = set()
    players: set[int] = set()
    ordered = sorted(cands, key=_rank, reverse=True)
    for one_per_game in (True, False):
        for tier in tiers:
            for c in ordered:
                if len(chosen) == n:
                    return chosen
                if (c["player"]["id"] in players or not _tier_ok(c, tier)
                        or (one_per_game and c["game"]["id"] in games)):
                    continue
                c["tier"] = tier
                chosen.append(c)
                games.add(c["game"]["id"])
                players.add(c["player"]["id"])
    return chosen


def top_per_game(cands: list[dict], k: int = GAME_PROPS) -> list[dict]:
    """Each game's top k, one per player, ranked like the league card."""
    by_game: dict[int, list[dict]] = {}
    for c in sorted(cands, key=_rank, reverse=True):
        lst = by_game.setdefault(c["game"]["id"], [])
        if len(lst) < k and all(x["player"]["id"] != c["player"]["id"] for x in lst):
            c["game_rank"] = len(lst) + 1
            lst.append(c)
    return [c for lst in by_game.values() for c in lst]


def select_winner(winners: list[dict]) -> Optional[dict]:
    """In ML_BAND with Elo agreeing, then in ML_BAND, then the surest below the band's top."""
    tiers = (lambda w: ML_BAND[0] <= w["model_prob"] <= ML_BAND[1] and w["elo_agrees"],
             lambda w: ML_BAND[0] <= w["model_prob"] <= ML_BAND[1],
             lambda w: w["model_prob"] < ML_BAND[0])
    for ok in tiers:
        pool = [w for w in winners if ok(w)]
        if pool:
            return max(pool, key=lambda w: w["model_prob"])
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
    hm = HitModel(league)
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
            ctx = context(hist, pl["id"], stat, e["line"], game["game_date"], opp, game["season"])
            if not ctx:
                continue
            n_rungs += 1
            # One candidate per player-stat-date (the lock key): the best-ranked side and rung.
            key = (pl["id"], stat, game["game_date"])
            for c in price_sides(league, stat, ctx, e, hm):
                row = {**c, "line": e["line"], "player": pl, "game": game, "stat": stat,
                       "ticker": e["ticker"], "ctx": ctx, "team_abbr": team_abbr}
                if key not in best or _rank(row) > _rank(best[key]):
                    best[key] = row
    if unmatched_players:
        print(f"  {len(unmatched_players)} Kalshi name(s) unmatched or ambiguous, e.g. {sorted(unmatched_players)[:6]}")
    cands = list(best.values())
    featured = select_featured(cands)
    kept = {id(c): c for c in top_per_game(cands)}
    for c in featured:
        kept[id(c)] = c
    print(f"  Priced {n_rungs} prop rungs; {len(cands)} player-stat candidates in band "
          f"({sum(c['belief'] for c in cands)} with form support); keeping {len(kept)}, featuring "
          f"{len(featured)} ({', '.join(c['tier'] for c in featured) or 'none'})")
    featured_ids = {id(c) for c in featured}
    for c in kept.values():
        x = c["ctx"]
        picks.append({
            "league_id": lid, "game_date": c["game"]["game_date"], "game_id": c["game"]["id"],
            "prop_type": "player", "entity_id": c["player"]["id"], "stat": c["stat"], "pick_type": "project",
            "recommended_line": c["line"], "hit_rate": c["model_prob"], "model_prob": c["model_prob"],
            "raw_prob": c["model_prob"], "sample_size": x["n"], "confidence_score": round(c["model_prob"] * 100, 2),
            "implied_prob": c["implied_prob"], "edge": c["edge"], "market_ticker": c["ticker"],
            "price_source": "kalshi",
            "modifiers": {"side": c["side"], "team_abbr": c["team_abbr"], "featured": id(c) in featured_ids,
                          "tier": c.get("tier"), "game_rank": c.get("game_rank"), "belief": c["belief"],
                          "z20_s": c["z20_s"], "avg20": x["avg20"], "avg5": x["avg5"], "last": x["last"],
                          "hit10": round(x["hit10"] if c["side"] == "over" else 1 - x["hit10"], 2),
                          "opp_factor": round(1 + x["opp"], 3), "b2b": bool(x["b2b"])},
        })

    # Winners: every game, at the book's price; Elo is the agree/disagree check.
    wm = WinModel(league)
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
    winners = []
    for gid, game in ((g["id"], g) for g in slate.values()):
        ext = game.get(cfg["game_col"])
        odds = fetch_espn_odds((cfg["sport"], league, str(ext))) if ext else None
        mkt = devig(odds.get("home_ml"), odds.get("away_ml")) if odds else None
        if mkt is None:
            print(f"  game {gid}: no ESPN moneyline, no winner (no anchor)")
            continue
        elo_h, _ = wm.home_prob(game["home_team_id"], game["away_team_id"], game["game_date"], mkt)
        home_fav = mkt >= 0.5
        team_id = game["home_team_id"] if home_fav else game["away_team_id"]
        p, elo_p = (mkt, elo_h) if home_fav else (1 - mkt, 1 - elo_h)
        q = next((s["e"] for s in sides.get(gid, []) if s["team_id"] == team_id), None)
        ask = q.get("yes_ask") if q else None
        quoted = bool(q and ask and q.get("yes_bid") and ask - q["yes_bid"] <= MAX_SPREAD
                      and (q.get("volume") or 0) >= MIN_VOLUME_ML)
        winners.append({"game": game, "team_id": team_id, "model_prob": round(p, 4), "elo_prob": round(elo_p, 4),
                        "elo_agrees": elo_p >= 0.5, "price": round(ask, 4) if quoted else None,
                        "ticker": q["ticker"] if q else None, "provider": odds.get("provider")})
    top = select_winner(winners)
    for w in winners:
        price = w["price"] if w["price"] is not None else w["model_prob"]
        picks.append({
            "league_id": lid, "game_date": w["game"]["game_date"], "game_id": w["game"]["id"], "prop_type": "winner",
            "entity_id": w["game"]["id"], "stat": "winner", "pick_type": "project", "recommended_line": None,
            "hit_rate": w["model_prob"], "model_prob": w["model_prob"], "raw_prob": w["elo_prob"],
            "sample_size": wm.c["n_train"], "confidence_score": round(w["model_prob"] * 100, 2),
            "implied_prob": price, "edge": round(w["model_prob"] - price, 4), "market_ticker": w["ticker"],
            "price_source": "kalshi" if w["price"] is not None else "espn",
            "modifiers": {"side": "win", "team_abbr": id_abbr[w["team_id"]], "team_id": w["team_id"],
                          "book_prob": w["model_prob"], "book": w["provider"], "elo_prob": w["elo_prob"],
                          "elo_agrees": w["elo_agrees"], "featured": w is top},
        })
    print(f"  Winners for {len(winners)} game(s); featured: "
          + (f"{id_abbr[top['team_id']]} {top['model_prob']:.3f}" if top else "none") + f"; total rows {len(picks)}")

    for p in sorted(picks, key=lambda x: (not x["modifiers"].get("featured"), -x["model_prob"]))[:15]:
        m = p["modifiers"]
        print(f"   {'*' if m.get('featured') else ' '} {p['game_date']} {p['prop_type']:6} {p['stat']:7} "
              f"id={p['entity_id']:<7} {m.get('side'):5} {str(p['recommended_line']):6} "
              f"p={p['model_prob']:.3f} px={p['implied_prob']:.3f} z20_s={m.get('z20_s', '')} {p['market_ticker']}")
    if dry_run:
        print("  --dry-run: nothing stored")
        return picks
    _store_lines(lid, lines)
    _store_picks(lid, picks, cfg.get("refeature", False), frozenset(g["id"] for g in slate.values()), now)
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


_REFRESH_COLS = ("recommended_line", "hit_rate", "model_prob", "raw_prob", "sample_size", "confidence_score",
                 "implied_prob", "edge", "market_ticker", "price_source", "modifiers")


def _key(r: dict) -> tuple:
    return (r["game_date"], r["entity_id"], r["stat"])


def _store_picks(lid: int, picks: list[dict], refeature: bool = False,
                 slate_ids: frozenset = frozenset(), now: Optional[datetime] = None) -> None:
    """Additive lock: (game_date, entity, stat, 'project') is frozen once stored.

    refeature (NFL): props list days early and injury news lands later in the week, so
    each run's featured set replaces the earlier one on games that haven't started.
    A row that was ever shown keeps the price it was shown at (it is graded at that
    price); a replaced one gets modifiers.replaced_at. Rows never shown are refreshed
    to the latest price and context, since nothing was published at the old one."""
    if not picks:
        print("  pick_results: nothing new")
        return
    dates = sorted({p["game_date"] for p in picks})
    existing = (supabase.table("pick_results")
                .select("id,game_id,game_date,entity_id,stat,prop_type,modifiers,actual_result")
                .eq("league_id", lid).eq("pick_type", "project").in_("game_date", dates).execute().data or [])
    by_key = {_key(r): r for r in existing}
    new = [p for p in picks if _key(p) not in by_key]
    if refeature:
        _refeature(picks, existing, by_key, slate_ids, (now or datetime.now(timezone.utc)).isoformat())
        for i in range(0, len(new), 500):
            supabase.table("pick_results").insert(new[i:i + 500]).execute()
        print(f"  pick_results: added {len(new)}")
        return
    # Featured picks are locked too: a later run may not crowd out ones already shown.
    caps = {"player": LEAGUE_PROPS, "winner": 1}
    n_feat: dict[tuple[str, str], int] = {}
    for r in existing:
        if (r.get("modifiers") or {}).get("featured"):
            k = (r["game_date"], r["prop_type"])
            n_feat[k] = n_feat.get(k, 0) + 1
    for p in new:
        if p["modifiers"].get("featured"):
            k = (p["game_date"], p["prop_type"])
            if n_feat.get(k, 0) >= caps[p["prop_type"]]:
                p["modifiers"] = {**p["modifiers"], "featured": False}
            else:
                n_feat[k] = n_feat.get(k, 0) + 1
    for i in range(0, len(new), 500):
        supabase.table("pick_results").insert(new[i:i + 500]).execute()
    print(f"  pick_results: added {len(new)} ({len(picks) - len(new)} already locked)")


def _refeature(picks: list[dict], existing: list[dict], by_key: dict, slate_ids: frozenset, stamp: str) -> None:
    chosen = {_key(p) for p in picks if p["modifiers"].get("featured")}
    priced = {_key(p) for p in picks}
    n_refresh = n_feat = n_unfeat = 0

    def set_featured(r: dict, want: bool) -> None:
        nonlocal n_feat, n_unfeat
        m = r.get("modifiers") or {}
        if want == bool(m.get("featured")):
            return
        m = {**m, "featured": want, **({} if want else {"replaced_at": stamp})}
        supabase.table("pick_results").update({"modifiers": m}).eq("id", r["id"]).execute()
        n_feat, n_unfeat = n_feat + want, n_unfeat + (not want)

    for p in picks:
        r = by_key.get(_key(p))
        if r is None or r.get("actual_result") is not None:
            continue
        m = r.get("modifiers") or {}
        if m.get("featured") or m.get("replaced_at"):
            set_featured(r, _key(p) in chosen)      # shown: price frozen, only the flag moves
        else:
            supabase.table("pick_results").update({c: p[c] for c in _REFRESH_COLS}).eq("id", r["id"]).execute()
            n_refresh += 1
            n_feat += bool(p["modifiers"].get("featured"))
    # Featured rows this run no longer prices at all (player ruled out, market pulled).
    for r in existing:
        if (r.get("game_id") in slate_ids and _key(r) not in priced and r.get("actual_result") is None
                and (r.get("modifiers") or {}).get("featured")):
            set_featured(r, False)
    print(f"  re-feature: {n_feat} featured, {n_unfeat} replaced, {n_refresh} unshown rows refreshed")


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
