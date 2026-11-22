// Canonical entity routes. Every league uses the same league-qualified shape,
// so a link never has to know which sport has a bespoke page. The older
// unqualified routes (/player/:id, /mlb/player/:id, /game/:id, /team/:id)
// still resolve — App.tsx redirects them here.

/** Optional context a link carries so the player page opens on the stat, line and window the row was about. */
export interface PlayerLinkContext {
  /** Stat key or label (PTS). */
  stat?: string | null
  line?: number | null
  /** Game-count window (10 = last 10). */
  window?: number | null
}

export function playerPath(league: string, id: number | string, ctx?: PlayerLinkContext): string {
  const q = new URLSearchParams()
  if (ctx?.stat) q.set('stat', ctx.stat)
  if (ctx?.line != null) q.set('line', String(ctx.line))
  if (ctx?.window != null) q.set('window', String(ctx.window))
  const qs = q.toString()
  return `/player/${league}/${id}${qs ? `?${qs}` : ''}`
}

export function gamePath(league: string, id: number | string): string {
  return `/game/${league}/${id}`
}

export function teamPath(league: string, id: number | string): string {
  return `/team/${league}/${id}`
}
