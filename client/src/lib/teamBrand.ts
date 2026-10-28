import colors from './teamColors.json'

type Brand = { c: string; a: string }
const COLORS = colors as Record<string, Brand>

const SPORT: Record<string, string> = { nba: 'nba', mlb: 'mlb', nfl: 'nfl', nhl: 'nhl' }

// Our team abbreviations vs ESPN's, only where they differ.
const ESPN_CODE: Record<string, Record<string, string>> = {
  nba: { gsw: 'gs', nop: 'no', nyk: 'ny', sas: 'sa', uta: 'utah', was: 'wsh' },
  mlb: { az: 'ari', cws: 'chw' },
}

export function espnCode(league: string, abbr: string): string {
  const a = abbr.toLowerCase()
  return ESPN_CODE[league.toLowerCase()]?.[a] ?? a
}

export function teamLogoUrl(league: string, abbr: string): string | null {
  const sport = SPORT[league.toLowerCase()]
  if (!sport || !abbr) return null
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${espnCode(league, abbr)}.png`
}

/** Relative luminance 0..1 of a #rrggbb colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

/**
 * A team colour that reads on this app's near-black background: the primary
 * when it is bright enough, otherwise the alternate, otherwise the app orange.
 */
export function teamAccent(league: string, abbr: string): string {
  const b = COLORS[`${league.toLowerCase()}:${espnCode(league, abbr)}`]
  if (!b) return '#FF6B3D'
  if (luminance(b.c) > 0.08) return b.c
  if (luminance(b.a) > 0.08 && b.a.toLowerCase() !== '#ffffff') return b.a
  return luminance(b.a) > 0.08 ? b.a : '#FF6B3D'
}
