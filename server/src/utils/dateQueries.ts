import { supabaseAdmin } from '../config/supabaseAdmin'

async function findNearest(table: string, today: string): Promise<string> {
  const { data: upcoming } = await supabaseAdmin
    .from(table)
    .select('game_date')
    .gte('game_date', today)
    .order('game_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (upcoming?.game_date) return upcoming.game_date

  const { data: past } = await supabaseAdmin
    .from(table)
    .select('game_date')
    .lt('game_date', today)
    .order('game_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return past?.game_date ?? today
}

export const findNearestPickDate = (today: string) => findNearest('pick_results', today)
export const findNearestConditionsDate = (today: string) => findNearest('daily_conditions', today)
export const findNearestLinesDate = (today: string) => findNearest('daily_lines', today)
