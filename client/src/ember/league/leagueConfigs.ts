import type { LeagueSlug } from '@/config/leagues'

export interface LeagueConfig {
  slug: LeagueSlug
  /** League code, e.g. 'MLB' — rendered as `MLB.` with an ember period */
  name: string
  /** Ghost wordmark bleeding off the identity band */
  ghost: string
  tickerLabel: string
  metaLine: string
  askPlaceholder: string
  chips: string[]
}

export const nbaConfig: LeagueConfig = {
  slug: 'nba',
  name: 'NBA',
  ghost: 'NBA',
  tickerLabel: 'NBA · TONIGHT',
  metaLine: '82-GAME SEASON',
  askPlaceholder: 'ask about the NBA — players, teams, matchups…',
  chips: [
    'Top NBA rebounders against OKC this season',
    'Who scored the most points in the NBA last night?',
    'NBA players averaging the most assists over their last 5 games',
  ],
}

export const mlbConfig: LeagueConfig = {
  slug: 'mlb',
  name: 'MLB',
  ghost: 'MLB',
  tickerLabel: 'MLB · TONIGHT',
  metaLine: '162-GAME SEASON',
  askPlaceholder: 'ask about MLB — players, teams, matchups…',
  chips: [
    'MLB pitchers with the most strikeouts at home this season',
    'Who led MLB in stolen bases this season?',
    'MLB hitters with the most hits over their last 10 games',
  ],
}

export const nflConfig: LeagueConfig = {
  slug: 'nfl',
  name: 'NFL',
  ghost: 'NFL',
  tickerLabel: 'NFL · THIS WEEK',
  metaLine: '18-WEEK SEASON',
  askPlaceholder: 'ask about the NFL — players, teams, matchups…',
  chips: [
    'NFL receivers with the most targets this season',
    'NFL running backs with the most rushing yards this season',
    'NFL quarterbacks by passing yards over their last 3 games',
  ],
}

export const nhlConfig: LeagueConfig = {
  slug: 'nhl',
  name: 'NHL',
  ghost: 'NHL',
  tickerLabel: 'NHL · TONIGHT',
  metaLine: '82-GAME SEASON',
  askPlaceholder: 'ask about the NHL — players, teams, matchups…',
  chips: [
    'NHL players with the most goals over their last 5 games',
    'NHL goalies with the best save percentage this season',
    'NHL skaters with the most shots on goal over their last 5 games',
  ],
}
