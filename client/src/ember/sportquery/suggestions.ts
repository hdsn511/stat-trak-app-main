/**
 * Suggested questions shown on Home. Every one must be answerable from the
 * tables SportQuery can read (see server prompts/sportquery-system.ts). Keep
 * them literal: sport named, a stat we store, a window we can compute.
 */
export const HERO_CHIPS = [
  'Which NBA players have the most threes over their last 10 games?',
  'Top 5 NBA rebounders per game this season',
  'Which NHL players have the most points over their last 10 games?',
  'Who scored the most points in the NBA last night?',
]

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
