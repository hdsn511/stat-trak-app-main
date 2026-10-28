import { seasonStartFor, LeagueConfig } from '../config/leagues'

export const STREAK_WINDOW = 10

/**
 * The player's last STREAK_WINDOW games strictly before `endIdx`, restricted to
 * the season that contains `date`. A window that would reach back into the
 * prior season (or into an offseason gap) returns null: the player simply has
 * no streak yet, rather than one borrowed from months ago.
 */
export function priorSeasonWindow<T extends { game_date: string }>(
  games: T[],
  endIdx: number,
  date: string,
  lg: LeagueConfig
): T[] | null {
  const floor = seasonStartFor(lg, new Date(`${date}T00:00:00Z`))
  const window = games
    .slice(0, endIdx)
    .filter((g) => g.game_date >= floor)
    .slice(-STREAK_WINDOW)
  return window.length === STREAK_WINDOW ? window : null
}
