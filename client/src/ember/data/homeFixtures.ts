import { TickerGame } from '@/ember/components/LiveTicker'
import { TrendingRow } from '@/ember/components/TrendingPlayers'
import { StreakRow } from '@/ember/components/StreakWatch'

export type StatSignal = {
  id: string
  stat: string
  league: 'NBA' | 'MLB' | 'NFL' | 'NHL'
  name: string
  context: string
}

export const homeTicker: TickerGame[] = [
  {
    id: 'nba-bos-mia',
    league: 'NBA',
    away: 'BOS',
    home: 'MIA',
    awayScore: 54,
    homeScore: 58,
    status: 'Q2 4:12',
    live: true,
  },
  { id: 'nba-hou-okc', league: 'NBA', away: 'HOU', home: 'OKC', status: '8:00' },
  {
    id: 'mlb-nyy-bal',
    league: 'MLB',
    away: 'NYY',
    home: 'BAL',
    awayScore: 3,
    homeScore: 2,
    status: 'TOP 7',
    live: true,
  },
  { id: 'mlb-lad-sf', league: 'MLB', away: 'LAD', home: 'SF', status: '9:45' },
  { id: 'nhl-edm-dal', league: 'NHL', away: 'EDM', home: 'DAL', status: '8:00' },
  { id: 'nba-lal-gsw', league: 'NBA', away: 'LAL', home: 'GSW', status: '10:00' },
]

export const heroChips: string[] = [
  'Jokić rebounds vs top-10 defenses',
  'who hits 3+ threes most at home?',
  'best scoring pace matchups tonight',
]

export const statSignals: StatSignal[] = [
  {
    id: 'ohtani-3hr',
    stat: '3 HR',
    league: 'MLB',
    name: 'Shohei Ohtani',
    context: '4th career 3-homer game · 9 total bases',
  },
  {
    id: 'sabonis-21reb',
    stat: '21 REB',
    league: 'NBA',
    name: 'Domantas Sabonis',
    context: 'Season high · 8 straight double-doubles',
  },
  {
    id: 'mackinnon-5pts',
    stat: '5 PTS',
    league: 'NHL',
    name: 'Nathan MacKinnon',
    context: '2G 3A · his 9th 4+ point night this season',
  },
  {
    id: 'white-8-3pm',
    stat: '8 3PM',
    league: 'NBA',
    name: 'Derrick White',
    context: 'Career high · 6 of them after halftime',
  },
]

export const trendingRows: TrendingRow[] = [
  {
    rank: 1,
    name: 'Anthony Edwards',
    league: 'NBA',
    team: 'MIN',
    stat: 'PTS',
    chips: ['USG ↑', 'MIN ↑'],
    seasonVal: 26.4,
    l10Val: 32.1,
    delta: '+22%',
  },
  {
    rank: 2,
    name: 'Gunnar Henderson',
    league: 'MLB',
    team: 'BAL',
    stat: 'TB',
    chips: ['HARD HIT ↑'],
    seasonVal: 1.6,
    l10Val: 2.9,
    delta: '+81%',
  },
  {
    rank: 3,
    name: 'Derrick White',
    league: 'NBA',
    team: 'BOS',
    stat: '3PM',
    chips: ['VOLUME ↑'],
    seasonVal: 2.8,
    l10Val: 4.1,
    delta: '+46%',
  },
  {
    rank: 4,
    name: 'Elly De La Cruz',
    league: 'MLB',
    team: 'CIN',
    stat: 'H',
    chips: ['HOT ZONE ↑'],
    seasonVal: 1.1,
    l10Val: 1.8,
    delta: '+64%',
  },
  {
    rank: 5,
    name: 'Connor McDavid',
    league: 'NHL',
    team: 'EDM',
    stat: 'SOG',
    chips: ['PP TIME ↑'],
    seasonVal: 3.8,
    l10Val: 5.6,
    delta: '+47%',
  },
]

export const streakRows: StreakRow[] = [
  {
    name: 'Nikola Jokić',
    league: 'NBA',
    team: 'DEN',
    label: '10+ REB',
    games: [true, true, true, true, true, true, true, true, true, true],
    count: 12,
  },
  {
    name: 'Freddie Freeman',
    league: 'MLB',
    team: 'LAD',
    label: '1+ H',
    games: [true, true, false, true, true, true, true, true, true, true],
    count: 11,
  },
  {
    name: 'Karl-Anthony Towns',
    league: 'NBA',
    team: 'NYK',
    label: '1+ 3PM',
    games: [true, true, true, true, true, true, true, true, true, true],
    count: 14,
  },
  {
    name: 'Auston Matthews',
    league: 'NHL',
    team: 'TOR',
    label: '3+ SOG',
    games: [false, true, true, true, true, true, true, true, true, true],
    count: 9,
  },
]
