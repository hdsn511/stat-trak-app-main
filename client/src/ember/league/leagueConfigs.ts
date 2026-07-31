export interface LeagueConfig {
  /** League code, e.g. 'MLB' — rendered as `MLB.` with an ember period */
  name: string
  /** Ghost wordmark bleeding off the identity band */
  ghost: string
  tickerLabel: string
  metaLine: string
  askPlaceholder: string
  chips: string[]
  conferenceLabels: [string, string]
  /** Skeleton standings rows rendered per conference */
  standingsRows: number
}

export const mlbConfig: LeagueConfig = {
  name: 'MLB',
  ghost: 'MLB',
  tickerLabel: 'MLB · TONIGHT',
  metaLine: '162-GAME SEASON · DATA PIPELINE IN PROGRESS',
  askPlaceholder: 'ask about MLB — players, teams, matchups…',
  chips: [
    'hardest hit balls this week',
    'best strikeout pitchers at home?',
    'who owns the bases this month?',
  ],
  conferenceLabels: ['AMERICAN', 'NATIONAL'],
  standingsRows: 15,
}

export const nflConfig: LeagueConfig = {
  name: 'NFL',
  ghost: 'NFL',
  tickerLabel: 'NFL · THIS WEEK',
  metaLine: '18-WEEK SEASON · DATA PIPELINE IN PROGRESS',
  askPlaceholder: 'ask about the NFL — players, teams, matchups…',
  chips: [
    'most targets per route this season',
    'best red-zone rushers?',
    'fastest pace offenses this year',
  ],
  conferenceLabels: ['AFC', 'NFC'],
  standingsRows: 16,
}

export const nhlConfig: LeagueConfig = {
  name: 'NHL',
  ghost: 'NHL',
  tickerLabel: 'NHL · TONIGHT',
  metaLine: '82-GAME SEASON · DATA PIPELINE IN PROGRESS',
  askPlaceholder: 'ask about the NHL — players, teams, matchups…',
  chips: [
    'hottest goal scorers right now',
    'best save percentage this month?',
    'top power-play units tonight',
  ],
  conferenceLabels: ['EASTERN', 'WESTERN'],
  standingsRows: 16,
}
