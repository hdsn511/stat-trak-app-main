// Canonical entity routes. Every league uses the same league-qualified shape,
// so a link never has to know which sport has a bespoke page. The older
// unqualified routes (/player/:id, /mlb/player/:id, /game/:id, /team/:id)
// still resolve — App.tsx redirects them here.

export function playerPath(league: string, id: number | string): string {
  return `/player/${league}/${id}`
}

export function gamePath(league: string, id: number | string): string {
  return `/game/${league}/${id}`
}

export function teamPath(league: string, id: number | string): string {
  return `/team/${league}/${id}`
}
