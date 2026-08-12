import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { LEAGUES, LeagueSlug } from '../config/leagues';

// Cross-league entity search. Unlike the rest of the API this endpoint is
// league-agnostic on purpose: the nav search box spans every sport, so it
// resolves the league per result rather than from the mount path.

const LEAGUE_BY_ID = new Map<number, LeagueSlug>(
  (Object.keys(LEAGUES) as LeagueSlug[]).map((slug) => [LEAGUES[slug].leagueId, slug])
);

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

export interface PlayerHit {
  kind: 'player';
  id: number;
  name: string;
  team: string | null;
  position: string | null;
  league: LeagueSlug;
}

export interface TeamHit {
  kind: 'team';
  id: number;
  name: string;
  abbreviation: string | null;
  city: string | null;
  league: LeagueSlug;
}

/**
 * Neutralize LIKE wildcards so a user typing "%" doesn't match the whole table.
 * The value is still passed as a bound parameter by supabase-js, so this is
 * about result sanity rather than injection.
 */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Rank by how early and how cleanly the query matches: a prefix of the whole
 * name beats a prefix of a later word, which beats a bare substring. Ties break
 * on the shorter name, which is almost always the more prominent entity.
 */
function relevance(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)) return 1;
  return 2;
}

function byRelevance<T extends { name: string }>(rows: T[], q: string): T[] {
  return [...rows].sort((a, b) => {
    const d = relevance(a.name, q) - relevance(b.name, q);
    return d !== 0 ? d : a.name.length - b.name.length;
  });
}

/** Dedupe rows that matched on more than one column (name + city, say). */
function uniqueById<T extends { id: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function searchEntities(
  req: Request<Record<string, never>, unknown, unknown, { q?: string; limit?: string; league?: string }>,
  res: Response
) {
  try {
    const raw = (req.query.q ?? '').trim();
    if (raw.length < 2) {
      return res.json({ success: true, data: { players: [], teams: [] } });
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit ?? '', 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const pattern = `%${escapeLike(raw)}%`;
    const q = raw.toLowerCase();

    // Optional single-league narrowing, used by the league pages.
    const scoped = (req.query.league ?? '').trim().toLowerCase() as LeagueSlug;
    const leagueFilter = scoped in LEAGUES ? LEAGUES[scoped] : null;

    // Teams match on any of three columns. These are separate queries rather
    // than a PostgREST `.or()` because that filter string is parsed server-side
    // and a comma or paren in the query would break out of the expression.
    const teamQuery = (column: 'name' | 'abbreviation' | 'city') => {
      let builder = supabaseAdmin
        .from('teams')
        .select('id, name, abbreviation, city, league_id')
        .ilike(column, pattern)
        .limit(limit);
      if (leagueFilter) builder = builder.eq('league_id', leagueFilter.leagueId);
      return builder;
    };

    let playerQuery = supabaseAdmin
      .from('players')
      .select('id, name, team, position, league_id')
      .ilike('name', pattern)
      .eq('is_active', true)
      // Over-fetch so the relevance sort has candidates to choose from; a bare
      // `limit` here would hand back an arbitrary alphabetical slice.
      .limit(limit * 5);
    if (leagueFilter) playerQuery = playerQuery.eq('league_id', leagueFilter.leagueId);

    const [playerRes, byName, byAbbr, byCity] = await Promise.all([
      playerQuery,
      teamQuery('name'),
      teamQuery('abbreviation'),
      teamQuery('city'),
    ]);

    if (playerRes.error) throw playerRes.error;
    for (const r of [byName, byAbbr, byCity]) {
      if (r.error) throw r.error;
    }

    const players: PlayerHit[] = byRelevance(playerRes.data ?? [], q)
      .flatMap((p: any) => {
        const league = LEAGUE_BY_ID.get(p.league_id);
        if (!league) return [];
        return [{
          kind: 'player' as const,
          id: p.id,
          name: p.name,
          team: p.team ?? null,
          position: p.position ?? null,
          league,
        }];
      })
      .slice(0, limit);

    const teamRows = uniqueById([
      ...(byName.data ?? []),
      ...(byAbbr.data ?? []),
      ...(byCity.data ?? []),
    ] as any[]);

    const teams: TeamHit[] = byRelevance(teamRows, q)
      .flatMap((t: any) => {
        const league = LEAGUE_BY_ID.get(t.league_id);
        if (!league) return [];
        return [{
          kind: 'team' as const,
          id: t.id,
          name: t.name,
          abbreviation: t.abbreviation ?? null,
          city: t.city ?? null,
          league,
        }];
      })
      .slice(0, limit);

    res.json({ success: true, data: { players, teams } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
