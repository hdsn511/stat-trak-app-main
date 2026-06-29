import { supabaseAdmin } from '../config/supabaseAdmin'

// Find the nearest game_date with rows (upcoming first, else most recent past).
// `leagueId` filters tables that carry a league_id column (pick_results,
// daily_lines); pass undefined for tables without one (the conditions tables,
// which are already per-sport).
async function findNearest(table: string, today: string, leagueId?: number): Promise<string> {
  const applyLeague = (q: any) => (leagueId != null ? q.eq('league_id', leagueId) : q)

  const { data: upcoming } = await applyLeague(
    supabaseAdmin.from(table).select('game_date').gte('game_date', today)
  )
    .order('game_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (upcoming?.game_date) return upcoming.game_date

  const { data: past } = await applyLeague(
    supabaseAdmin.from(table).select('game_date').lt('game_date', today)
  )
    .order('game_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return past?.game_date ?? today
}

export const findNearestPickDate = (today: string, leagueId?: number) =>
  findNearest('pick_results', today, leagueId)
export const findNearestLinesDate = (today: string, leagueId?: number) =>
  findNearest('daily_lines', today, leagueId)
// conditions tables are per-sport (daily_conditions | mlb_daily_conditions) and
// have no league_id column — caller passes the table name.
export const findNearestConditionsDate = (today: string, table = 'daily_conditions') =>
  findNearest(table, today)
