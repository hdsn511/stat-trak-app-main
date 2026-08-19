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
    'best rebounders vs OKC this season',
    'who scores most in clutch minutes?',
    'fastest pace matchup tonight',
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
    'hardest hit balls this week',
    'best strikeout pitchers at home?',
    'who owns the bases this month?',
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
    'most targets per route this season',
    'best red-zone rushers?',
    'fastest pace offenses this year',
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
    'hottest goal scorers right now',
    'best save percentage this month?',
    'top power-play units tonight',
  ],
}
