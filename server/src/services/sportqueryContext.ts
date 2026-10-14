import { supabaseAdmin } from '../config/supabaseAdmin'

/**
 * SportQuery writes its own SELECT, so a player row often arrives with
 * `player_id` and a name but no team or sport — the client then shows a dash
 * for the team and cannot tell which league's player page to open. This looks
 * the players up once and fills the gaps; it never overwrites a column the
 * query returned.
 */

const TEAM_KEYS = ['team', 'team_abbr', 'abbreviation', 'team_abbreviation']
const MAX_IDS = 200

type Row = Record<string, unknown>

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** The player id a row refers to, or null when it is not a player row. */
export function playerIdOf(row: Row): number | null {
  const direct = num(row.player_id)
  if (direct !== null) return direct
  // entity_id is a player id only on player-prop rows (it is a game id on
  // game props), so require the discriminator.
  if (row.prop_type === 'player') return num(row.entity_id)
  return null
}

export interface PlayerContext {
  team: string | null
  league: string | null
}

/** Pure merge step, split out so it is testable without the database. */
export function mergePlayerContext(rows: Row[], ctx: Map<number, PlayerContext>): Row[] {
  return rows.map((row) => {
    const id = playerIdOf(row)
    const c = id !== null ? ctx.get(id) : undefined
    if (!c) return row

    const out: Row = { ...row }
    const hasTeam = TEAM_KEYS.some((k) => out[k] != null && out[k] !== '')
    if (!hasTeam && c.team) out.team = c.team
    if (out.league == null && c.league) out.league = c.league
    return out
  })
}

export async function attachPlayerContext(rows: Row[]): Promise<Row[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows

  const ids = [...new Set(rows.map(playerIdOf).filter((v): v is number => v !== null))].slice(
    0,
    MAX_IDS
  )
  if (ids.length === 0) return rows

  const { data, error } = await supabaseAdmin.from('players').select('id, team, league').in('id', ids)
  if (error || !data) return rows // enrichment is best-effort; the rows still render

  const ctx = new Map<number, PlayerContext>()
  for (const p of data as { id: number; team: string | null; league: string | null }[]) {
    ctx.set(p.id, { team: p.team, league: p.league })
  }
  return mergePlayerContext(rows, ctx)
}
