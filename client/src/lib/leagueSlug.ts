import { LEAGUES, type LeagueSlug } from '@/config/leagues'

/** Route-param guard: narrows an unknown path segment to a known league. */
export function isLeagueSlug(s: string | undefined): s is LeagueSlug {
  return LEAGUES.some((l) => l.slug === s)
}
