/**
 * Headshot URL for a player. `ext_id` is the source system's id, which differs
 * by league: NBA ids are NBA.com person ids, MLB ids are statsapi ids, and NFL /
 * NHL ids are ESPN athlete ids.
 */
export function playerPhotoUrl(
  league: string,
  extId: string | number | null | undefined
): string | null {
  if (extId == null || extId === '') return null
  const id = String(extId)
  switch (league.toLowerCase()) {
    case 'nba':
      return `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`
    case 'mlb':
      return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_240,h_240,c_thumb,g_face,q_auto:best/v1/people/${id}/headshot/67/current`
    case 'nfl':
      return `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`
    case 'nhl':
      return `https://a.espncdn.com/i/headshots/nhl/players/full/${id}.png`
    default:
      return null
  }
}
