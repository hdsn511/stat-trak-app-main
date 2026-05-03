"""
Kalshi prediction market client for NBA player and game props.

Authentication: RSA-PSS signed headers (not Bearer token).
Each request signs: {timestamp_ms}{METHOD}{path_without_query}

Usage:
    python -m analytics.kalshi.client --test    # mock mode
    python -m analytics.kalshi.client --live    # real API
"""
import argparse
import base64
import json
import re
import time
from pathlib import Path
from typing import Optional

import requests
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from analytics.db.connection import KALSHI_API_KEY, KALSHI_BASE_URL, KALSHI_PRIVATE_KEY_PATH

# ── Constants ──────────────────────────────────────────────────────────────────

# Seconds between requests to stay within 20 reads/sec Basic tier limit
RATE_LIMIT_DELAY = 0.06

# Targeted NBA series tickers for player/game props (avoids querying 200+ series)
PLAYER_PROP_SERIES = [
    "KXNBAPTS",        # points props
    "KXNBAREB",        # rebounds props
    "KXNBAAST",        # assists props
    "KXNBASTL",        # steals props
    "KXNBABLK",        # blocks props
    "KXNBAPLAYOFFPTS", # playoff player points
]

GAME_PROP_SERIES = [
    "KXNBAGAME",       # game lines / winners
    "KXNBASPREAD",     # spread markets
    "KXNBAPLAYOFF",    # playoff game markets
    "KXNBAMATCHUP",    # per-game matchup markets
    # KXNBATEAMTOTAL excluded: these are single-team score markets, not combined totals.
    # Our backtest computes home_score + away_score, so team total lines (97–120) would
    # always hit with 100% rate against a combined score of 200+. Misleading output.
    # KXNBA1HTOTAL, KXNBA2HTOTAL excluded for the same reason (half-score markets).
]

TARGET_NBA_SERIES = PLAYER_PROP_SERIES + GAME_PROP_SERIES

# Number of retry attempts for transient HTTP errors
MAX_RETRIES = 3

# Maximum markets to request per page
PAGE_LIMIT = 1000

# Backoff multiplier (seconds) between retries: attempt * RETRY_BACKOFF
RETRY_BACKOFF = 1.0

# Maps title keywords -> internal stat key
# Order matters: check longer/more-specific phrases first
STAT_KEYWORDS = {
    "three-point":  "fg3m",
    "3-pointer":    "fg3m",
    "3 pointer":    "fg3m",
    "three point":  "fg3m",
    "threes":       "fg3m",
    "3pts":         "fg3m",
    "3pm":          "fg3m",
    "rebound":      "reb",
    "assist":       "ast",
    "steal":        "stl",
    "block":        "blk",
    "point":        "pts",
    "score":        "pts",
}

# Keywords that indicate a first-half market
FIRST_HALF_KEYWORDS = ("first half", "1st half", "1h ", " 1h")

# Headers sent to Kalshi on every request
HEADER_ACCESS_KEY       = "KALSHI-ACCESS-KEY"
HEADER_ACCESS_TIMESTAMP = "KALSHI-ACCESS-TIMESTAMP"
HEADER_ACCESS_SIGNATURE = "KALSHI-ACCESS-SIGNATURE"

# Prefix words stripped from extracted player names
NAME_PREFIXES = {"will", "can", "does", "did"}

# Regex to extract team abbreviation from team-bearing Kalshi game-prop tickers.
# Matches: KX<STAT>-<DD><MMM><YY><TEAM1><TEAM2>-<TEAMABBR><LINE?>
# e.g. KXNBASPREAD-26APR23NYKATL-ATL17 → 'ATL'
#      KXNBAGAME-26APR21HOULAL-HOU     → 'HOU'
# Does NOT match 1H/2H totals (no team abbr before optional digits in suffix).
_GAME_TICKER_TEAM_RE = re.compile(r'^KX[A-Z]+-\d{2}[A-Z]{3}\d{2}[A-Z]{6}-([A-Z]{3})\d*$')


def _extract_team_abbr(ticker: str) -> Optional[str]:
    """Extract team abbreviation from a team-bearing Kalshi game-prop ticker.
    Returns None for 1H/2H game-level totals and non-Kalshi/mock tickers."""
    m = _GAME_TICKER_TEAM_RE.match(ticker)
    return m.group(1) if m else None


# ── Client ─────────────────────────────────────────────────────────────────────

class KalshiClient:
    """
    Thin Kalshi REST client scoped to NBA markets.

    Parameters
    ----------
    api_key  : Kalshi API key ID string. Defaults to env var KALSHI_API_KEY.
    key_path : Path to PEM private key file. Defaults to env var KALSHI_PRIVATE_KEY_PATH.
    mock     : If True, all network calls are skipped and synthetic data is returned.
               Automatically enabled if the key file is not found.
    """

    def __init__(self, api_key: str = "", key_path: str = "", mock: bool = False):
        self.api_key  = api_key  or KALSHI_API_KEY
        self.key_path = key_path or KALSHI_PRIVATE_KEY_PATH
        self.mock     = mock
        self._private_key = None

        if not self.mock:
            self._private_key = self._load_private_key(self.key_path)
            if self._private_key is None:
                print(f"[KalshiClient] Key file not found at '{self.key_path}' -- falling back to mock mode")
                self.mock = True

    # ── Auth ───────────────────────────────────────────────────────────────────

    def _load_private_key(self, path: str):
        """Load RSA private key from PEM file. Returns None if file is missing."""
        if not path:
            return None
        p = Path(path)
        if not p.exists():
            return None
        try:
            with p.open("rb") as fh:
                return serialization.load_pem_private_key(
                    fh.read(), password=None, backend=default_backend()
                )
        except Exception as exc:
            print(f"[KalshiClient] Failed to load private key: {exc}")
            return None

    def _sign_request(self, timestamp: str, method: str, path: str) -> str:
        """
        Return base64-encoded RSA-PSS SHA256 signature of
        '{timestamp}{METHOD}{path_without_query}'.
        """
        path_no_query = path.split("?")[0]
        message = f"{timestamp}{method.upper()}{path_no_query}".encode("utf-8")
        signature = self._private_key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")

    def _build_headers(self, method: str, path: str) -> dict:
        """Build the three required Kalshi authentication headers."""
        timestamp = str(int(time.time() * 1000))
        return {
            HEADER_ACCESS_KEY:       self.api_key,
            HEADER_ACCESS_TIMESTAMP: timestamp,
            HEADER_ACCESS_SIGNATURE: self._sign_request(timestamp, method, path),
            "Content-Type":          "application/json",
        }

    # ── HTTP ───────────────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, params: dict | None = None) -> dict | None:
        """
        Execute an authenticated request against the Kalshi API.

        Retries up to MAX_RETRIES times on 429 / 5xx responses with linear
        back-off.  Returns the parsed JSON dict, or None on failure.
        """
        if self.mock:
            return None  # callers check mock flag before calling _request

        url = f"{KALSHI_BASE_URL}{path}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                headers = self._build_headers(method, path)
                response = requests.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    timeout=15,
                )

                if response.status_code == 200:
                    time.sleep(RATE_LIMIT_DELAY)
                    return response.json()

                if response.status_code == 429 or response.status_code >= 500:
                    wait = attempt * RETRY_BACKOFF
                    print(
                        f"[KalshiClient] HTTP {response.status_code} on attempt "
                        f"{attempt}/{MAX_RETRIES} -- retrying in {wait}s"
                    )
                    time.sleep(wait)
                    continue

                # 4xx (not 429) -- not retryable
                print(
                    f"[KalshiClient] HTTP {response.status_code}: "
                    f"{response.text[:200]}"
                )
                return None

            except requests.RequestException as exc:
                wait = attempt * RETRY_BACKOFF
                print(f"[KalshiClient] Request error (attempt {attempt}): {exc} -- retrying in {wait}s")
                time.sleep(wait)

        print(f"[KalshiClient] All {MAX_RETRIES} attempts failed for {method} {path}")
        return None

    # ── Discovery ──────────────────────────────────────────────────────────────

    def discover_nba_series(self) -> list[str]:
        """
        Return a targeted list of NBA prop series tickers.

        Queries /series to confirm which tickers exist, then intersects with
        TARGET_NBA_SERIES.  Falls back to TARGET_NBA_SERIES directly if the
        endpoint fails.
        """
        if self.mock:
            return list(TARGET_NBA_SERIES)

        data = self._request("GET", "/series")
        if data:
            existing = {s["ticker"] for s in (data.get("series") or [])}
            confirmed = [t for t in TARGET_NBA_SERIES if t in existing]
            if confirmed:
                print(f"[KalshiClient] Confirmed {len(confirmed)} prop series: {confirmed}")
                return confirmed
            print(f"[KalshiClient] /series did not confirm any target tickers — using full target list")

        return list(TARGET_NBA_SERIES)

    # ── Market Fetching ────────────────────────────────────────────────────────

    def get_nba_markets(self, series_tickers: list[str] | None = None) -> list[dict]:
        """
        Pull all open NBA markets from targeted prop series, paginating via cursor.

        Parameters
        ----------
        series_tickers : series tickers to query. Defaults to TARGET_NBA_SERIES.

        Returns a flat list of raw market dicts as returned by the Kalshi API.
        """
        if self.mock:
            return self._mock_nba_markets()

        if series_tickers is None:
            series_tickers = self.discover_nba_series()

        all_markets: list[dict] = []

        for ticker in series_tickers:
            cursor = None
            page = 0

            while True:
                params: dict = {
                    "series_ticker": ticker,
                    "status":        "open",
                    "limit":         PAGE_LIMIT,
                }
                if cursor:
                    params["cursor"] = cursor

                data = self._request("GET", "/markets", params=params)
                if not data:
                    break

                markets = data.get("markets") or []
                all_markets.extend(markets)
                page += 1

                cursor = data.get("cursor")
                if not cursor or not markets:
                    break

                print(f"[KalshiClient] {ticker} page {page}: {len(markets)} markets, cursor={cursor[:12]}...")

            if markets:
                print(f"[KalshiClient] {ticker}: {len([m for m in all_markets])} total so far")

        print(f"[KalshiClient] Fetched {len(all_markets)} total open markets")
        return all_markets

    # ── Parsing: Player Props ──────────────────────────────────────────────────

    def _extract_player_name(self, title: str) -> str | None:
        """
        Heuristic player name extraction from a market title.

        Handles two formats:
          1. "First Last: 25+ points"  (Kalshi actual format — name before colon)
          2. "Will First Last over/score/record ..."  (legacy descriptive format)

        Returns the cleaned name string, or None if no name can be found.
        """
        # Primary: "PlayerName: ..." — name is everything before the first colon
        colon_m = re.match(
            r'^([A-Z][a-zA-Z\'\.\-]+(?:\s+[A-Z]?[a-zA-Z\'\.\-]+){1,3})\s*:',
            title,
        )
        if colon_m:
            name = colon_m.group(1).strip()
            if 2 < len(name) < 50:
                return name

        # Fallback: "Will X over/under/score/have/record/make ..."
        title_lower = title.lower()
        markers = (r"\bover\b", r"\bunder\b", r"\bscores?\b", r"\bhave\b",
                   r"\brecords?\b", r"\bmakes?\b")
        for marker in markers:
            m = re.search(marker, title_lower)
            if m:
                candidate = title[: m.start()].strip()
                candidate = re.sub(r"(?i)^will\s+", "", candidate).strip()
                candidate = re.sub(r"'s\s*$", "", candidate).strip()
                if 2 < len(candidate) < 50:
                    return candidate

        return None

    def _detect_stat(self, title: str) -> str | None:
        """
        Map a market title to an internal stat key using STAT_KEYWORDS.

        Returns None if no keyword matches.
        """
        title_lower = title.lower()
        for keyword, stat in STAT_KEYWORDS.items():
            if keyword in title_lower:
                return stat
        return None

    def _is_first_half(self, title: str) -> bool:
        """Return True if the title indicates a first-half market."""
        title_lower = title.lower()
        return any(kw in title_lower for kw in FIRST_HALF_KEYWORDS)

    def _extract_line(self, market: dict) -> float | None:
        """
        Extract the numeric threshold line from a market dict.

        Tries `floor_strike`, then falls back to parsing the subtitle/title.
        """
        # Preferred: floor_strike is the "over" line value
        floor_strike = market.get("floor_strike")
        if floor_strike is not None:
            try:
                return float(floor_strike)
            except (TypeError, ValueError):
                pass

        # Fallback: look for a number like "25.5" in the title
        title = market.get("title", "") or market.get("subtitle", "")
        m = re.search(r"\b(\d+(?:\.\d+)?)\b", title)
        if m:
            return float(m.group(1))

        return None

    def _parse_price(self, market: dict) -> float | None:
        """
        Extract implied probability (0.0 – 1.0) from a market.

        Kalshi v2 stores prices in *_dollars fields (e.g. "yes_ask_dollars").
        Uses bid/ask midpoint when both are positive, otherwise the ask alone.
        Falls back to last_price_dollars, then legacy field names.
        """
        yes_ask = market.get("yes_ask_dollars")
        yes_bid = market.get("yes_bid_dollars")

        if yes_ask is not None:
            try:
                ask_f = float(yes_ask)
                if ask_f > 0:
                    if yes_bid is not None:
                        bid_f = float(yes_bid)
                        # Only use midpoint when spread is tight (≤0.30).
                        # Wide spreads (e.g. ask=0.99, bid=0.01) indicate a
                        # stale/placeholder bid — midpoint would be misleading.
                        if bid_f > 0 and (ask_f - bid_f) <= 0.30:
                            return (ask_f + bid_f) / 2
                    return ask_f
            except (TypeError, ValueError):
                pass

        last = market.get("last_price_dollars")
        if last is not None:
            try:
                val = float(last)
                if val > 0:
                    return val
            except (TypeError, ValueError):
                pass

        for key in ("yes_price", "last_price", "yes_ask"):
            val = market.get(key)
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    pass

        return None

    @staticmethod
    def _series_prefix(ticker: str) -> str:
        """Extract series prefix from a ticker like 'KXNBAPTS-26APR22PHXOKC-...'."""
        return ticker.split("-")[0] if "-" in ticker else ticker

    def parse_player_props(self, markets: list[dict]) -> dict:
        """
        Parse raw markets into structured player prop lines.

        Only considers markets from PLAYER_PROP_SERIES tickers to avoid
        team/game markets being misclassified as player props.

        Picks v2: first-half markets are dropped at parse time. They never
        had a valid backtest (the historical samples are full-game) and the
        old half-game approximation introduced more noise than signal.

        Returns
        -------
        dict keyed by (player_name_lower, stat) ->
            list of {line, price, implied_prob, ticker}
        """
        result: dict[tuple[str, str], list[dict]] = {}
        player_series_set = set(PLAYER_PROP_SERIES)
        skipped_first_half = 0

        for market in markets:
            ticker = market.get("ticker", "")
            if self._series_prefix(ticker) not in player_series_set:
                continue

            title = market.get("title", "")
            if not title:
                continue

            # Drop first-half markets up front — they don't make it into the pipeline.
            if self._is_first_half(title):
                skipped_first_half += 1
                continue

            stat = self._detect_stat(title)
            if not stat:
                continue

            player_name = self._extract_player_name(title)
            if not player_name:
                continue

            line = self._extract_line(market)
            price = self._parse_price(market)
            if line is None or price is None:
                continue

            key = (player_name.lower(), stat)
            entry = {
                "line":         line,
                "price":        price,
                "implied_prob": price,
                "ticker":       ticker,
                "title":        title,
            }
            result.setdefault(key, []).append(entry)

        if skipped_first_half:
            print(f"[kalshi] skipped {skipped_first_half} first-half player markets")

        # Deduplicate by line: for each (player, stat, line) group keep the
        # entry with the highest implied_prob. Kalshi may return multiple markets
        # for the same player/stat with the same floor_strike — range bracket
        # markets ("scores exactly 20-24") alongside cumulative over markets
        # ("scores 20+"). The cumulative over market always has the highest YES
        # price for lines below the player's expected value, which is the
        # implied probability we want for "over X" prop evaluation.
        deduped: dict[tuple[str, str], list[dict]] = {}
        for key, entries in result.items():
            best_by_line: dict[float, dict] = {}
            for e in entries:
                ln = e["line"]
                if ln not in best_by_line or e["implied_prob"] > best_by_line[ln]["implied_prob"]:
                    best_by_line[ln] = e
            deduped[key] = list(best_by_line.values())

        return deduped

    # ── Parsing: Game Props ────────────────────────────────────────────────────

    def _detect_game_prop_type(self, title: str, ticker: str = "") -> str | None:
        """
        Return 'total', 'spread', or 'winner' based on ticker series or title keywords.
        """
        series = self._series_prefix(ticker)

        if series in ("KXNBATEAMTOTAL", "KXNBA1HTOTAL", "KXNBA2HTOTAL"):
            return "total"
        if series == "KXNBASPREAD":
            return "spread"
        if series in ("KXNBAGAME", "KXNBAPLAYOFF", "KXNBAMATCHUP"):
            return "winner"

        # Fallback: keyword scan for markets not in a known game series
        title_lower = title.lower()
        total_kws  = ("total points", "combined points", "combined score",
                      "total score", "over/under", "o/u", "score", "team total")
        spread_kws = ("spread", "margin", "cover", "point differential",
                      "win by", "wins by")
        winner_kws = ("winner", "wins the game", "wins game")

        for kw in total_kws:
            if kw in title_lower:
                return "total"
        for kw in spread_kws:
            if kw in title_lower:
                return "spread"
        for kw in winner_kws:
            if kw in title_lower:
                return "winner"
        return None

    def _extract_event_key(self, market: dict) -> str:
        """Return a normalised event key (event_ticker or series_ticker fallback)."""
        return (
            market.get("event_ticker")
            or market.get("series_ticker")
            or market.get("ticker", "unknown")
        )

    def parse_game_props(self, markets: list[dict]) -> dict:
        """
        Parse raw markets into structured game prop lines.

        Only considers markets from GAME_PROP_SERIES tickers.

        Returns
        -------
        dict keyed by (event_key, prop_type) ->
            list of {line, price, implied_prob, ticker, is_first_half}
        """
        result: dict[tuple[str, str], list[dict]] = {}
        game_series_set = set(GAME_PROP_SERIES)

        for market in markets:
            ticker = market.get("ticker", "")
            if self._series_prefix(ticker) not in game_series_set:
                continue

            title = market.get("title", "")
            prop_type = self._detect_game_prop_type(title, ticker)
            if not prop_type:
                continue

            line  = self._extract_line(market)
            price = self._parse_price(market)
            if line is None or price is None:
                continue

            event_key = self._extract_event_key(market)
            key = (event_key, prop_type)
            team_abbr = _extract_team_abbr(ticker)
            entry = {
                "line":          line,
                "price":         price,
                "implied_prob":  price,
                "ticker":        ticker,
                "title":         title,
                "team_abbr":     team_abbr,
            }
            result.setdefault(key, []).append(entry)

        return result

    # ── Mock Data ──────────────────────────────────────────────────────────────

    def _mock_nba_markets(self) -> list[dict]:
        """
        Return ~24 synthetic NBA market dicts for unit-testing without API access.

        Covers 6 representative players x 4 stats, each with 1-2 alt lines.
        Includes a few game-total and spread markets.
        """
        players = [
            ("LeBron James",    {"pts": (25.5, 26.5), "reb": (7.5,),  "ast": (7.5, 8.5), "fg3m": (1.5,)}),
            ("Stephen Curry",   {"pts": (27.5, 28.5), "reb": (4.5,),  "ast": (5.5,),     "fg3m": (4.5, 5.5)}),
            ("Nikola Jokic",    {"pts": (24.5,),       "reb": (12.5, 13.5), "ast": (9.5,), "fg3m": (0.5,)}),
            ("Jayson Tatum",    {"pts": (26.5, 27.5), "reb": (8.5,),  "ast": (4.5,),     "fg3m": (2.5,)}),
            ("Anthony Edwards", {"pts": (24.5,),       "reb": (5.5,),  "ast": (4.5,),     "fg3m": (3.5, 4.5)}),
            ("Luka Doncic",     {"pts": (30.5, 31.5), "reb": (9.5,),  "ast": (8.5,),     "fg3m": (2.5,)}),
        ]

        stat_title_map = {
            "pts":  "score over {line} points",
            "reb":  "record over {line} rebounds",
            "ast":  "have over {line} assists",
            "fg3m": "make over {line} three-point shots",
        }

        import random
        random.seed(42)

        markets: list[dict] = []
        ticker_seq = 1

        for player_name, stat_lines in players:
            for stat, lines in stat_lines.items():
                for i, line in enumerate(lines):
                    price = round(random.uniform(0.35, 0.72), 4)
                    title = f"Will {player_name} {stat_title_map[stat].format(line=line)}?"
                    markets.append({
                        "ticker":       f"NBA-MOCK-{ticker_seq:04d}",
                        "event_ticker": f"NBA-MOCK-EVT-{ticker_seq // 4:03d}",
                        "series_ticker": "NBA",
                        "title":        title,
                        "subtitle":     f"{player_name} - {stat.upper()} over {line}",
                        "floor_strike": str(line),
                        "yes_price":    str(price),
                        "last_price":   str(price),
                        "status":       "open",
                    })
                    ticker_seq += 1

        # Add a 1H variant for one player
        markets.append({
            "ticker":       f"NBA-MOCK-{ticker_seq:04d}",
            "event_ticker": "NBA-MOCK-EVT-001",
            "series_ticker": "NBA",
            "title":        "Will LeBron James score over 13.5 points in the first half?",
            "floor_strike": "13.5",
            "yes_price":    "0.5200",
            "last_price":   "0.5200",
            "status":       "open",
        })
        ticker_seq += 1

        # Add game total / spread markets — use real series prefixes so parse_game_props
        # doesn't filter them out (it checks series prefix against GAME_PROP_SERIES).
        mock_games = [
            {
                "event_key": "LAL-GSW",
                "ticker":    "KXNBAGAME-27APR26LALGSW-TOT",
                "title":     "Will the total points exceed 227.5?",
                "strike":    "227.5",
                "price":     "0.5100",
            },
            {
                "event_key": "LAL-GSW",
                "ticker":    "KXNBASPREAD-27APR26LALGSW-LAL",
                "title":     "Will the Lakers cover the -3.5 spread?",
                "strike":    "3.5",
                "price":     "0.4800",
            },
            {
                "event_key": "BOS-MIL",
                "ticker":    "KXNBAGAME-27APR26BOSMIL-TOT",
                "title":     "Will the combined score exceed 220.5?",
                "strike":    "220.5",
                "price":     "0.5300",
            },
            {
                "event_key": "LAL-GSW",
                "ticker":    "KXNBAGAME-27APR26LALGSW-WIN",
                "title":     "Will the Lakers win the game?",
                "strike":    "0.5",
                "price":     "0.4900",
            },
        ]
        for mg in mock_games:
            markets.append({
                "ticker":        mg["ticker"],
                "event_ticker":  mg["event_key"],
                "series_ticker": mg["ticker"].split("-")[0],
                "title":         mg["title"],
                "floor_strike":  mg["strike"],
                "yes_price":     mg["price"],
                "last_price":    mg["price"],
                "status":        "open",
            })
            ticker_seq += 1

        return markets

    def _mock_player_lines(self, player_name: str, stat: str) -> list[dict]:
        """
        Return mock alt-line entries for a specific (player, stat) pair.

        Useful for targeted unit tests without spinning up the full mock market set.
        """
        import random
        random.seed(hash((player_name.lower(), stat)) & 0xFFFFFFFF)

        base_lines = {"pts": 22.5, "reb": 7.5, "ast": 5.5, "fg3m": 2.5}
        base = base_lines.get(stat, 15.5)

        lines = []
        for offset in (0, 1, 2):
            line  = base + offset
            price = round(random.uniform(0.30, 0.75), 4)
            lines.append({
                "line":          line,
                "price":         price,
                "implied_prob":  price,
                "ticker":        f"NBA-MOCK-{player_name[:3].upper()}-{stat.upper()}-{int(line)}",
                "title":         f"Will {player_name} score over {line} {stat}?",
            })
        return lines


# ── CLI ────────────────────────────────────────────────────────────────────────

def _run_test(live: bool = False) -> None:
    """Run a quick smoke test and print summary output."""
    mode = "LIVE" if live else "MOCK"
    print(f"\n=== KalshiClient {mode} Test ===\n")

    client = KalshiClient(mock=not live)

    # 1. Series discovery
    series = client.discover_nba_series()
    print(f"NBA series tickers: {series}")

    # 2. Fetch markets
    markets = client.get_nba_markets()
    print(f"Total markets fetched: {len(markets)}")

    if live and not markets:
        print("\n[DIAGNOSTIC] Fetching first page of ALL open markets (no NBA filter) ...")
        raw = client._request("GET", "/markets", params={"status": "open", "limit": 5})
        if raw:
            sample = raw.get("markets") or []
            print(f"  Sample open markets (first 5): {[m.get('ticker') for m in sample]}")
        else:
            print("  /markets returned None -- possible auth failure")

    # 3. Parse player props
    player_props = client.parse_player_props(markets)
    print(f"\nUnique player/stat combos: {len(player_props)}")
    for (player, stat), lines in sorted(player_props.items()):
        # First-half markets are dropped at parse — no fh_tag needed.
        print(f"  {player:<25} {stat:<6} -> {len(lines)} line(s)")
        for entry in lines[:2]:  # show at most 2 alt lines
            print(
                f"    line={entry['line']:<6}  prob={entry['implied_prob']:.4f}"
                f"  ticker={entry['ticker']}"
            )

    # 4. Parse game props
    game_props = client.parse_game_props(markets)
    print(f"\nUnique game prop combos: {len(game_props)}")
    for (event_key, prop_type), lines in sorted(game_props.items()):
        print(f"  {event_key:<20} {prop_type:<8} -> {len(lines)} line(s)")
        for entry in lines[:1]:
            print(
                f"    line={entry['line']:<7}  prob={entry['implied_prob']:.4f}"
                f"  ticker={entry['ticker']}"
            )

    # 5. Mock player lines helper
    if not live:
        sample = client._mock_player_lines("Jayson Tatum", "pts")
        print(f"\n_mock_player_lines('Jayson Tatum', 'pts'): {len(sample)} entries")
        for s in sample:
            print(f"  {s}")

    print("\n=== Test complete ===\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KalshiClient smoke test")
    group  = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--test", action="store_true", help="Run in mock mode (no API calls)")
    group.add_argument("--live", action="store_true", help="Run against real Kalshi API")
    args = parser.parse_args()

    _run_test(live=args.live)
