/**
 * Suggested questions shown on Home. Every one must be answerable from the
 * tables SportQuery can read (see server prompts/sportquery-system.ts). Keep
 * them literal: sport named, a stat we store, a window we can compute.
 */
const POOL: Record<string, string[]> = {
  nba: [
    'Which NBA players have the most threes over their last 10 games?',
    'Top 5 NBA rebounders per game this season',
    'Who scored the most points in the NBA last night?',
    'Which NBA guards have the most assists over their last 5 games?',
    'Top 5 NBA scorers by points per game this season',
    'Which NBA centers have the most blocks this season?',
    'Who has the most steals per game in the NBA this season?',
  ],
  nhl: [
    'Which NHL players have the most points over their last 10 games?',
    'Top 5 NHL goal scorers this season',
    'Which NHL goalies have the best save percentage this season?',
    'Who has the most shots on goal in the NHL this season?',
    'Which NHL defensemen have the most points this season?',
  ],
  nfl: [
    'Top 5 NFL quarterbacks by passing yards this season',
    'Who leads the NFL in receiving yards this season?',
    'Which running backs have the most rushing touchdowns?',
    'Which NFL receivers have the most receptions this season?',
    'Who has the most sacks in the NFL this season?',
  ],
  mlb: [
    'Who has the most home runs this season in MLB?',
    'Top 5 MLB starting pitchers by strikeouts this season',
    'Best MLB hitters by batting average over their last 10 games',
    'Who led MLB in stolen bases this season?',
    'MLB hitters with the most RBI this season',
  ],
}

/** Every suggestion we might show; the test checks each against UNSUPPORTED_RE. */
export const HERO_CHIPS = Object.values(POOL).flat()

/**
 * Four suggestions that change each local calendar day: the sports are
 * shuffled and each contributes the question at that day's index in its pool.
 * Deterministic per day, so a re-render or reload never reshuffles them.
 */
export function dailyChips(date = new Date()): string[] {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5)
  const sports = Object.keys(POOL)
  const first = day % sports.length
  return sports.map((_, i) => {
    const pool = POOL[sports[(first + i) % sports.length]!]!
    return pool[(day + i) % pool.length]!
  })
}

/**
 * Things the data does not contain. A suggestion mentioning one of these would
 * send the user to an answer we cannot give, so suggestions are tested against
 * it (client) and model follow-ups are filtered by the same list (server).
 */
export const UNSUPPORTED_TERMS = [
  'hard(est)?.? ?hit',
  'exit velocity',
  'launch angle',
  'statcast',
  'barrel',
  'xwoba',
  'clutch',
  'per route',
  'route',
  'red.?zone',
  'power.?play unit',
  'pace (matchup|offense)',
  'fastest pace',
  'tracking',
  'play.?by.?play',
  'live',
  'salary',
  'contract',
  'injur(y|ies) history',
  'weather',
  'predict',
  '\\bWAR\\b',
  'spin rate',
  'time of possession',
  // Betting: picks, lines and props are not offered right now.
  '\\bpicks?\\b',
  '\\blines?\\b',
  'odds',
  'props?\\b',
  'kalshi',
  'spread',
  'cover(ing)?\\b',
  '\\bbet',
  'parlay',
]

export const UNSUPPORTED_RE = new RegExp(UNSUPPORTED_TERMS.join('|'), 'i')

/** Three of one league's suggestions, rotating daily like dailyChips. */
export function dailyLeagueChips(slug: string, date = new Date()): string[] {
  const pool = POOL[slug] ?? []
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5)
  return pool.length ? [0, 1, 2].map((i) => pool[(day + i) % pool.length]!) : []
}
