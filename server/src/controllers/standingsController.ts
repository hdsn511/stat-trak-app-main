import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league, seasonStartFor } from '../config/leagues';

// Season standings, from one of two sources.
//
// The analytics pipeline writes a `team_standings` table with conference,
// division and OT-aware points, but only for the leagues it has processed
// (NFL and NHL today). For anything else the table is derived from `games`
// here, which yields the same W/L/PCT shape minus the conference split. The
// response reports which source it used so the UI never implies a division
// ranking it does not have.

type StandingsSource = 'table' | 'derived';

interface Standing {
  team_id: number;
  abbreviation: string;
  name: string;
  w: number;
  l: number;
  t: number;
  pct: number;
  /** Most recent 10 results, newest first. */
  last10: { w: number; l: number; t: number };
  /**
   * Overtime/shootout losses. Hockey records read W-L-OTL, and an OT loss is
   * not a tie — it still scores a point. Zero for leagues without them.
   */
  otl: number;
  /** Signed run of identical results, e.g. 3 for W3, -2 for L2. */
  streak: number;
  /** Null when the source has no conference/division data. */
  conference: string | null;
  division: string | null;
}

/**
 * The analytics table stores a streak as text ("W3", "L1"); the derived path
 * produces a signed integer. The API exposes the signed integer, so the text
 * form is normalized here rather than leaking two representations.
 */
function parseStreak(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return 0;
  const m = /^([WL])(\d+)$/i.exec(raw.trim());
  if (!m) return 0;
  const n = parseInt(m[2]!, 10);
  return m[1]!.toUpperCase() === 'W' ? n : -n;
}

function pct(w: number, l: number, t: number): number {
  const games = w + l + t;
  if (games === 0) return 0;
  // A tie counts as half a win, the standard convention where ties exist.
  return +((w + t / 2) / games).toFixed(3);
}

// PostgREST caps a response at 1000 rows. A full season is 1200+ games for
// the NBA and 2400+ for MLB, so an unpaged query silently drops most of the
// schedule and every record comes out wrong.
const PAGE = 1000;

async function fetchSeasonGames(leagueId: number, gameType: string, seasonStart: string) {
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('games')
      .select('game_date, home_team_id, away_team_id, home_score, away_score')
      .eq('league_id', leagueId)
      .eq('game_type', gameType)
      .gte('game_date', seasonStart)
      .not('home_score', 'is', null)
      .order('game_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return all;
  }
}

/**
 * Standings straight from the analytics table. Returns null when the pipeline
 * has not processed this league, so the caller falls back to deriving them.
 */
async function fromStandingsTable(leagueId: number): Promise<Standing[] | null> {
  const { data, error } = await supabaseAdmin
    .from('team_standings')
    .select(
      'team_id, conference, division, wins, losses, ties, ot_losses, win_pct, l10_wins, ' +
      'l10_losses, streak, season, teams!inner(abbreviation, name)'
    )
    .eq('league_id', leagueId)
    .order('season', { ascending: false })
    .order('win_pct', { ascending: false });

  // A missing table or an unprocessed league both mean "derive it instead".
  if (error || !data || data.length === 0) return null;

  // The table can hold more than one season; keep only the newest.
  const latestSeason = Math.max(...data.map((r: any) => r.season));

  return data
    .filter((r: any) => r.season === latestSeason)
    .map((r: any) => ({
      team_id: r.team_id,
      abbreviation: r.teams?.abbreviation ?? '',
      name: r.teams?.name ?? '',
      w: r.wins ?? 0,
      l: r.losses ?? 0,
      t: r.ties ?? 0,
      otl: r.ot_losses ?? 0,
      pct: r.win_pct != null ? +Number(r.win_pct).toFixed(3) : 0,
      last10: { w: r.l10_wins ?? 0, l: r.l10_losses ?? 0, t: 0 },
      streak: parseStreak(r.streak),
      conference: r.conference ?? null,
      division: r.division ?? null,
    }));
}

export async function getStandings(_req: Request, res: Response) {
  try {
    const lg = league(res);
    const seasonStart = seasonStartFor(lg);

    const precomputed = await fromStandingsTable(lg.leagueId);
    if (precomputed) {
      res.json({
        success: true,
        data: {
          league: lg.slug,
          source: 'table' as StandingsSource,
          season_start: seasonStart,
          standings: precomputed,
        },
      });
      return;
    }

    // Regular season only — playoff results do not belong in a standings table.
    const [{ data: teams, error: teamErr }, games] = await Promise.all([
      supabaseAdmin
        .from('teams')
        .select('id, abbreviation, name, conference, division')
        .eq('league_id', lg.leagueId),
      fetchSeasonGames(lg.leagueId, lg.regularSeasonType, seasonStart),
    ]);

    if (teamErr) throw teamErr;

    const table = new Map<number, Standing>();
    for (const t of teams ?? []) {
      table.set((t as any).id, {
        team_id: (t as any).id,
        abbreviation: (t as any).abbreviation,
        name: (t as any).name,
        w: 0,
        l: 0,
        t: 0,
        pct: 0,
        // Derived standings read scores only, which cannot distinguish an
        // overtime loss from a regulation one.
        otl: 0,
        last10: { w: 0, l: 0, t: 0 },
        streak: 0,
        // teams.conference/division is seeded independently of the
        // win/loss computation below (seed_conferences.py), so a league on
        // the derived path can still carry a real conference split even
        // without the analytics pipeline's OT-aware standings table.
        conference: (t as any).conference ?? null,
        division: (t as any).division ?? null,
      });
    }

    // Results per team in chronological order, for last-10 and streak.
    const history = new Map<number, ('W' | 'L' | 'T')[]>();
    const push = (teamId: number, r: 'W' | 'L' | 'T') => {
      const row = table.get(teamId);
      if (!row) return;
      if (r === 'W') row.w++;
      else if (r === 'L') row.l++;
      else row.t++;
      const h = history.get(teamId) ?? [];
      h.push(r);
      history.set(teamId, h);
    };

    for (const g of games) {
      if (g.home_score == null || g.away_score == null) continue;
      if (g.home_score > g.away_score) {
        push(g.home_team_id, 'W');
        push(g.away_team_id, 'L');
      } else if (g.away_score > g.home_score) {
        push(g.away_team_id, 'W');
        push(g.home_team_id, 'L');
      } else {
        push(g.home_team_id, 'T');
        push(g.away_team_id, 'T');
      }
    }

    for (const row of table.values()) {
      const h = history.get(row.team_id) ?? [];
      row.pct = pct(row.w, row.l, row.t);

      for (const r of h.slice(-10)) {
        if (r === 'W') row.last10.w++;
        else if (r === 'L') row.last10.l++;
        else row.last10.t++;
      }

      const latest = h[h.length - 1];
      if (latest && latest !== 'T') {
        let run = 0;
        for (let i = h.length - 1; i >= 0 && h[i] === latest; i--) run++;
        row.streak = latest === 'W' ? run : -run;
      }
    }

    // Teams with no completed games sort last rather than tying at .000 with
    // a genuinely winless team.
    const standings = [...table.values()].sort((a, b) => {
      const aPlayed = a.w + a.l + a.t > 0;
      const bPlayed = b.w + b.l + b.t > 0;
      if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;
      return b.pct - a.pct || b.w - a.w;
    });

    res.json({
      success: true,
      data: {
        league: lg.slug,
        source: 'derived' as StandingsSource,
        season_start: seasonStart,
        standings,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
