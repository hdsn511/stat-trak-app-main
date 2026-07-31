import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabaseAdmin';
import { league as resolveLeague } from '../config/leagues';

// opponent_position_defense is NBA-shaped: one row per (team, position group,
// snapshot) with a per-stat allowed average and league rank. Other leagues have
// no equivalent table yet, so the endpoint returns null for them and the client
// suppresses only the matchup-signal badge.
export const DEFENSE_COLUMNS: Record<string, { allowed: string; rank: string }> = {
  pts:  { allowed: 'pts_allowed_pg',  rank: 'league_rank' },
  reb:  { allowed: 'reb_allowed_pg',  rank: 'reb_rank' },
  ast:  { allowed: 'ast_allowed_pg',  rank: 'ast_rank' },
  fg3m: { allowed: 'fg3m_allowed_pg', rank: 'fg3m_rank' },
};

type DefenseRow = Record<string, any>;

/** Newest snapshot for the requested position group, or any group when null. */
export function pickDefenseRow(
  rows: DefenseRow[],
  positionGroup: string | null
): DefenseRow | null {
  const scoped = positionGroup ? rows.filter((r) => r.position_group === positionGroup) : rows;
  if (scoped.length === 0) return null;
  return scoped.reduce((newest, r) =>
    String(r.snapshot_date) > String(newest.snapshot_date) ? r : newest
  );
}

export function shapeDefense(row: DefenseRow | null, stat: string) {
  const cols = DEFENSE_COLUMNS[stat];
  if (!row || !cols) return null;
  const allowed = row[cols.allowed];
  if (allowed == null) return null;
  return {
    allowedPerGame: allowed,
    leagueRank: row[cols.rank] ?? null,
    positionGroup: row.position_group ?? null,
    stat,
    asOf: row.snapshot_date,
  };
}

// Short in-process cache — this is a season aggregate that changes at most daily.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; rows: DefenseRow[] }>();

export async function getTeamDefense(req: Request<{ id: string }>, res: Response) {
  try {
    const lg = resolveLeague(res);
    const stat = String(req.query.stat ?? 'pts');
    const positionGroup = req.query.position ? String(req.query.position) : null;
    const teamId = parseInt(req.params.id, 10);

    if (!Number.isFinite(teamId)) {
      return res.status(400).json({ success: false, error: 'invalid team id' });
    }
    // Only NBA has a defense table, and only these stats are stored.
    if (lg.slug !== 'nba' || !DEFENSE_COLUMNS[stat]) {
      return res.json({ success: true, data: null });
    }

    const key = `${lg.slug}:${teamId}`;
    const hit = cache.get(key);
    let rows: DefenseRow[];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      rows = hit.rows;
    } else {
      const { data, error } = await supabaseAdmin
        .from('opponent_position_defense')
        .select(
          'position_group, snapshot_date, pts_allowed_pg, reb_allowed_pg, ast_allowed_pg, ' +
            'fg3m_allowed_pg, league_rank, reb_rank, ast_rank, fg3m_rank'
        )
        .eq('team_id', teamId);
      if (error) throw error;
      rows = data || [];
      cache.set(key, { at: Date.now(), rows });
    }

    res.json({ success: true, data: shapeDefense(pickDefenseRow(rows, positionGroup), stat) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
