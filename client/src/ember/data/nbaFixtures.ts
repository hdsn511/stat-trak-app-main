import type { StreakRow, TickerGame, TrendingRow } from '@/ember/components'

export type StandingRow = {
  rank: number
  abbr: string
  name: string
  w: number
  l: number
  pct: number
  /** Last-10 win fraction (0–1), drives the L10 bar width */
  l10: number
  streak: string
}

export const nbaTicker: TickerGame[] = [
  {
    id: 'bos-mia',
    away: 'BOS',
    home: 'MIA',
    awayScore: 54,
    homeScore: 58,
    status: 'Q2 4:12',
    live: true,
  },
  { id: 'nyk-phi', away: 'NYK', home: 'PHI', status: '7:00' },
  { id: 'hou-okc', away: 'HOU', home: 'OKC', status: '8:00' },
  { id: 'dal-den', away: 'DAL', home: 'DEN', status: '8:30' },
  { id: 'lal-gsw', away: 'LAL', home: 'GSW', status: '10:00' },
  { id: 'min-sac', away: 'MIN', home: 'SAC', status: '10:30' },
]

export const eastStandings: StandingRow[] = [
  { rank: 1, abbr: 'BOS', name: 'Celtics', w: 58, l: 20, pct: 0.744, l10: 0.8, streak: 'W6' },
  { rank: 2, abbr: 'NYK', name: 'Knicks', w: 51, l: 27, pct: 0.654, l10: 0.7, streak: 'W3' },
  { rank: 3, abbr: 'MIL', name: 'Bucks', w: 49, l: 29, pct: 0.628, l10: 0.7, streak: 'W2' },
  { rank: 4, abbr: 'CLE', name: 'Cavaliers', w: 47, l: 31, pct: 0.603, l10: 0.5, streak: 'L2' },
  { rank: 5, abbr: 'ORL', name: 'Magic', w: 46, l: 32, pct: 0.59, l10: 0.6, streak: 'W1' },
  { rank: 6, abbr: 'IND', name: 'Pacers', w: 45, l: 33, pct: 0.577, l10: 0.7, streak: 'W4' },
  { rank: 7, abbr: 'PHI', name: '76ers', w: 44, l: 34, pct: 0.564, l10: 0.5, streak: 'L1' },
  { rank: 8, abbr: 'MIA', name: 'Heat', w: 43, l: 35, pct: 0.551, l10: 0.5, streak: 'L1' },
  { rank: 9, abbr: 'ATL', name: 'Hawks', w: 38, l: 40, pct: 0.487, l10: 0.4, streak: 'L3' },
  { rank: 10, abbr: 'CHI', name: 'Bulls', w: 36, l: 42, pct: 0.462, l10: 0.5, streak: 'W1' },
  { rank: 11, abbr: 'BKN', name: 'Nets', w: 32, l: 46, pct: 0.41, l10: 0.4, streak: 'L2' },
  { rank: 12, abbr: 'TOR', name: 'Raptors', w: 30, l: 48, pct: 0.385, l10: 0.4, streak: 'W1' },
  { rank: 13, abbr: 'CHA', name: 'Hornets', w: 27, l: 51, pct: 0.346, l10: 0.3, streak: 'L4' },
  { rank: 14, abbr: 'DET', name: 'Pistons', w: 24, l: 54, pct: 0.308, l10: 0.4, streak: 'W2' },
  { rank: 15, abbr: 'WAS', name: 'Wizards', w: 18, l: 60, pct: 0.231, l10: 0.3, streak: 'L5' },
]

export const westStandings: StandingRow[] = [
  { rank: 1, abbr: 'OKC', name: 'Thunder', w: 57, l: 21, pct: 0.731, l10: 0.8, streak: 'W7' },
  { rank: 2, abbr: 'DEN', name: 'Nuggets', w: 53, l: 25, pct: 0.679, l10: 0.7, streak: 'W2' },
  { rank: 3, abbr: 'MIN', name: 'Timberwolves', w: 49, l: 29, pct: 0.628, l10: 0.7, streak: 'W3' },
  { rank: 4, abbr: 'DAL', name: 'Mavericks', w: 48, l: 30, pct: 0.615, l10: 0.6, streak: 'W2' },
  { rank: 5, abbr: 'LAC', name: 'Clippers', w: 47, l: 31, pct: 0.603, l10: 0.5, streak: 'L1' },
  { rank: 6, abbr: 'PHX', name: 'Suns', w: 45, l: 33, pct: 0.577, l10: 0.4, streak: 'L2' },
  { rank: 7, abbr: 'GSW', name: 'Warriors', w: 44, l: 34, pct: 0.564, l10: 0.6, streak: 'W1' },
  { rank: 8, abbr: 'NOP', name: 'Pelicans', w: 42, l: 36, pct: 0.538, l10: 0.5, streak: 'L1' },
  { rank: 9, abbr: 'LAL', name: 'Lakers', w: 41, l: 37, pct: 0.526, l10: 0.6, streak: 'W2' },
  { rank: 10, abbr: 'HOU', name: 'Rockets', w: 40, l: 38, pct: 0.513, l10: 0.5, streak: 'W1' },
  { rank: 11, abbr: 'SAC', name: 'Kings', w: 38, l: 40, pct: 0.487, l10: 0.4, streak: 'L1' },
  { rank: 12, abbr: 'POR', name: 'Trail Blazers', w: 34, l: 44, pct: 0.436, l10: 0.5, streak: 'W2' },
  { rank: 13, abbr: 'MEM', name: 'Grizzlies', w: 31, l: 47, pct: 0.397, l10: 0.3, streak: 'L3' },
  { rank: 14, abbr: 'UTA', name: 'Jazz', w: 26, l: 52, pct: 0.333, l10: 0.4, streak: 'W1' },
  { rank: 15, abbr: 'SAS', name: 'Spurs', w: 22, l: 56, pct: 0.282, l10: 0.3, streak: 'L2' },
]

export const nbaTrending: TrendingRow[] = [
  {
    rank: 1,
    name: 'Anthony Edwards',
    team: 'MIN',
    stat: 'PTS',
    chips: ['USG ↑', 'MIN ↑'],
    seasonVal: 26.4,
    l10Val: 32.1,
    delta: '+22%',
  },
  {
    rank: 2,
    name: 'Derrick White',
    team: 'BOS',
    stat: '3PM',
    chips: ['VOLUME ↑'],
    seasonVal: 2.8,
    l10Val: 4.1,
    delta: '+46%',
  },
  {
    rank: 3,
    name: 'Chet Holmgren',
    team: 'OKC',
    stat: 'REB',
    chips: ['OPP PACE'],
    seasonVal: 8.2,
    l10Val: 10.8,
    delta: '+32%',
  },
  {
    rank: 4,
    name: 'Cade Cunningham',
    team: 'DET',
    stat: 'AST',
    chips: ['USG ↑'],
    seasonVal: 8.9,
    l10Val: 11.2,
    delta: '+26%',
  },
  {
    rank: 5,
    name: 'Jamal Murray',
    team: 'DEN',
    stat: 'PTS',
    chips: ['MIN ↑'],
    seasonVal: 21.2,
    l10Val: 25.9,
    delta: '+22%',
  },
]

/** 10-bar strip: first `misses` bars dim, the rest filled */
const streakBars = (misses: number): boolean[] =>
  Array.from({ length: 10 }, (_, i) => i >= misses)

export const nbaStreaks: StreakRow[] = [
  { name: 'Nikola Jokić', team: 'DEN', label: '10+ REB', games: streakBars(0), count: 12 },
  { name: 'Karl-Anthony Towns', team: 'NYK', label: '1+ 3PM', games: streakBars(0), count: 14 },
  { name: 'Luka Dončić', team: 'DAL', label: '28+ PTS', games: streakBars(1), count: 9 },
  { name: 'Trae Young', team: 'ATL', label: '8+ AST', games: streakBars(2), count: 8 },
]
