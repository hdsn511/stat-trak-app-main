// Build the player-detail route for a given league. MLB has its own dedicated
// player view at /mlb/player/:id; every other league uses the shared
// /player/:id route. Defaulting to the shared route keeps NBA links unchanged.
export function playerPath(slug: string | undefined, id: number | string): string {
  return slug === 'mlb' ? `/mlb/player/${id}` : `/player/${id}`
}
