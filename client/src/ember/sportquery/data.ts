// SportQuery mock dataset + query logic, ported verbatim from the design
// prototype (docs/plans/Theme Directions ….dc.html, script block).

export interface PlayerRec {
  n: string
  tm: string
  tn: string
  pos: string
  num: number
  ppg: number
  rpg: number
  apg: number
  fg: number
  tp: number
  ft: number
  tpL10: number
  l10p: number[]
  l10t: number[]
  note: string
}

export interface GameLeader {
  t: string
  n: string
  pts: number
  reb: number
  ast: number
}

export interface GameRec {
  a: string
  an: string
  b: string
  bn: string
  as: number
  bs: number
  st: string
  live: boolean
  ls: [(number | null)[], (number | null)[]]
  note: string
  venue: string
  pace: string
  lc: number
  ll: string
  tt: number
  stats: Record<string, [number, number]>
  ldr: GameLeader[]
}

export type StatKey = 'ppg' | 'rpg' | 'apg' | 'fg' | 'tp' | 'ft'
export type Period = 'SEASON' | 'LAST 10' | 'LAST 5'
export type Metric = 'pts' | '3pm' | 'reb' | 'ast'
export type GMetric = 'pts' | 'reb' | 'ast'

export const PLAYERS = {
  sga: { n: 'Shai Gilgeous-Alexander', tm: 'OKC', tn: 'Thunder', pos: 'G', num: 2, ppg: 32.8, rpg: 5.1, apg: 6.4, fg: 52.6, tp: 37.9, ft: 88.2, tpL10: 41.2, l10p: [35, 31, 28, 40, 33, 29, 38, 31, 36, 30], l10t: [3, 2, 2, 4, 3, 2, 4, 2, 3, 3], note: '6 STRAIGHT 30-PT GAMES' },
  cur: { n: 'Stephen Curry', tm: 'GSW', tn: 'Warriors', pos: 'G', num: 30, ppg: 26.9, rpg: 4.3, apg: 6.1, fg: 46.4, tp: 41.8, ft: 92.3, tpL10: 44.8, l10p: [31, 24, 38, 22, 29, 33, 19, 41, 27, 30], l10t: [6, 4, 7, 3, 5, 6, 2, 9, 4, 5], note: '51 THREES IN LAST 10' },
  luk: { n: 'Luka Dončić', tm: 'LAL', tn: 'Lakers', pos: 'G', num: 77, ppg: 31.4, rpg: 8.9, apg: 9.1, fg: 48.1, tp: 36.2, ft: 78.6, tpL10: 38.9, l10p: [33, 28, 37, 30, 25, 39, 32, 27, 35, 29], l10t: [4, 3, 5, 3, 2, 5, 4, 3, 4, 3], note: '3 TRIPLE-DOUBLES IN L10' },
  jok: { n: 'Nikola Jokić', tm: 'DEN', tn: 'Nuggets', pos: 'C', num: 15, ppg: 27.2, rpg: 12.8, apg: 10.4, fg: 57.9, tp: 35.4, ft: 82.0, tpL10: 36.1, l10p: [24, 31, 27, 22, 29, 33, 26, 28, 30, 25], l10t: [1, 2, 2, 1, 2, 3, 1, 2, 2, 1], note: 'TRIPLE-DOUBLE IN 4 OF L10' },
  ant: { n: 'Anthony Edwards', tm: 'MIN', tn: 'Timberwolves', pos: 'G', num: 5, ppg: 28.6, rpg: 5.8, apg: 5.2, fg: 47.2, tp: 39.8, ft: 84.5, tpL10: 43.1, l10p: [29, 35, 26, 31, 38, 24, 33, 27, 30, 32], l10t: [5, 6, 3, 4, 7, 2, 5, 4, 4, 5], note: '43.1% FROM DEEP OVER L10' },
  hal: { n: 'Tyrese Haliburton', tm: 'IND', tn: 'Pacers', pos: 'G', num: 0, ppg: 22.4, rpg: 4.1, apg: 11.2, fg: 49.5, tp: 40.6, ft: 87.1, tpL10: 42.4, l10p: [24, 19, 27, 22, 25, 18, 26, 23, 21, 25], l10t: [4, 3, 5, 4, 4, 2, 5, 4, 3, 4], note: 'LEAGUE-BEST AST/TO' },
  tat: { n: 'Jayson Tatum', tm: 'BOS', tn: 'Celtics', pos: 'F', num: 0, ppg: 27.8, rpg: 8.7, apg: 4.9, fg: 46.8, tp: 37.1, ft: 83.3, tpL10: 35.2, l10p: [28, 31, 24, 33, 26, 29, 35, 22, 30, 27], l10t: [3, 4, 2, 5, 3, 4, 5, 2, 4, 3], note: '8.7 BOARDS LEADS ALL WINGS' },
  mit: { n: 'Donovan Mitchell', tm: 'CLE', tn: 'Cavaliers', pos: 'G', num: 45, ppg: 27.4, rpg: 4.6, apg: 5.4, fg: 46.1, tp: 38.4, ft: 86.7, tpL10: 42.8, l10p: [30, 26, 38, 24, 29, 33, 21, 36, 28, 31], l10t: [5, 4, 7, 3, 5, 6, 2, 6, 4, 5], note: '38 LAST NIGHT VS MIL' },
  gia: { n: 'Giannis Antetokounmpo', tm: 'MIL', tn: 'Bucks', pos: 'F', num: 34, ppg: 30.9, rpg: 11.6, apg: 6.1, fg: 60.2, tp: 27.4, ft: 68.9, tpL10: 25.0, l10p: [32, 28, 35, 30, 26, 38, 31, 29, 33, 27], l10t: [0, 1, 0, 1, 0, 1, 1, 0, 1, 0], note: '60.2 FG% ON 20 SHOTS/GM' },
} satisfies Record<string, PlayerRec>

export type PlayerId = keyof typeof PLAYERS

export const GAMES = {
  okcden: { a: 'OKC', an: 'THUNDER', b: 'DEN', bn: 'NUGGETS', as: 98, bs: 94, st: 'Q4 · 6:12', live: true, ls: [[28, 24, 27, 19], [26, 25, 22, 21]], note: 'SGA 34 · Jokić triple-double watch', venue: 'BALL ARENA', pace: '99.4', lc: 11, ll: 'OKC +9', tt: 6, stats: { 'FG%': [48.9, 51.2], '3P%': [37.5, 33.3], REB: [38, 41], AST: [22, 27], TOV: [11, 9] }, ldr: [{ t: 'OKC', n: 'S. Gilgeous-Alexander', pts: 34, reb: 5, ast: 6 }, { t: 'DEN', n: 'N. Jokić', pts: 31, reb: 12, ast: 9 }, { t: 'OKC', n: 'J. Williams', pts: 21, reb: 7, ast: 3 }, { t: 'DEN', n: 'J. Murray', pts: 24, reb: 3, ast: 5 }] },
  bosnyk: { a: 'BOS', an: 'CELTICS', b: 'NYK', bn: 'KNICKS', as: 87, bs: 81, st: 'Q3 · 2:45', live: true, ls: [[31, 26, 30, null], [29, 24, 28, null]], note: 'Tatum 26 through three', venue: 'MSG', pace: '97.1', lc: 8, ll: 'BOS +11', tt: 4, stats: { 'FG%': [47.1, 44.6], '3P%': [39.4, 31.0], REB: [33, 30], AST: [21, 18], TOV: [8, 10] }, ldr: [{ t: 'BOS', n: 'J. Tatum', pts: 26, reb: 8, ast: 3 }, { t: 'NYK', n: 'J. Brunson', pts: 24, reb: 2, ast: 6 }, { t: 'BOS', n: 'D. White', pts: 17, reb: 3, ast: 4 }, { t: 'NYK', n: 'K. Towns', pts: 19, reb: 9, ast: 2 }] },
  indmin: { a: 'IND', an: 'PACERS', b: 'MIN', bn: 'TIMBERWOLVES', as: 96, bs: 99, st: 'Q4 · 0:48', live: true, ls: [[22, 28, 25, 21], [25, 24, 27, 23]], note: 'Edwards 33 · one-possession game', venue: 'TARGET CTR', pace: '101.8', lc: 14, ll: 'MIN +8', tt: 9, stats: { 'FG%': [45.8, 47.9], '3P%': [36.1, 40.0], REB: [39, 42], AST: [26, 23], TOV: [12, 11] }, ldr: [{ t: 'MIN', n: 'A. Edwards', pts: 33, reb: 4, ast: 3 }, { t: 'IND', n: 'T. Haliburton', pts: 22, reb: 3, ast: 12 }, { t: 'MIN', n: 'R. Gobert', pts: 14, reb: 15, ast: 1 }, { t: 'IND', n: 'P. Siakam', pts: 24, reb: 8, ast: 3 }] },
  lalgsw: { a: 'LAL', an: 'LAKERS', b: 'GSW', bn: 'WARRIORS', as: 112, bs: 119, st: 'FINAL', live: false, ls: [[27, 30, 25, 30], [31, 28, 33, 27]], note: 'Curry 41 on 9 threes', venue: 'CHASE CTR', pace: '100.2', lc: 9, ll: 'GSW +15', tt: 5, stats: { 'FG%': [47.3, 50.5], '3P%': [34.2, 43.6], REB: [44, 40], AST: [25, 31], TOV: [13, 10] }, ldr: [{ t: 'GSW', n: 'S. Curry', pts: 41, reb: 4, ast: 6 }, { t: 'LAL', n: 'L. Dončić', pts: 35, reb: 8, ast: 11 }, { t: 'GSW', n: 'J. Kuminga', pts: 22, reb: 8, ast: 2 }, { t: 'LAL', n: 'A. Reaves', pts: 24, reb: 4, ast: 6 }] },
  milcle: { a: 'MIL', an: 'BUCKS', b: 'CLE', bn: 'CAVALIERS', as: 104, bs: 121, st: 'FINAL', live: false, ls: [[24, 29, 26, 25], [33, 28, 30, 30]], note: 'Mitchell 38 · CLE wins 6th straight', venue: 'ROCKET ARENA', pace: '96.5', lc: 3, ll: 'CLE +21', tt: 2, stats: { 'FG%': [44.2, 52.7], '3P%': [30.6, 41.9], REB: [41, 43], AST: [22, 29], TOV: [14, 9] }, ldr: [{ t: 'CLE', n: 'D. Mitchell', pts: 38, reb: 5, ast: 4 }, { t: 'MIL', n: 'G. Antetokounmpo', pts: 31, reb: 12, ast: 6 }, { t: 'CLE', n: 'E. Mobley', pts: 21, reb: 10, ast: 3 }, { t: 'MIL', n: 'D. Lillard', pts: 19, reb: 3, ast: 7 }] },
} satisfies Record<string, GameRec>

export type GameId = keyof typeof GAMES

export const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length

export const STATLBL: Record<StatKey, string> = { tp: '3P%', ppg: 'PTS', apg: 'AST', rpg: 'REB', fg: 'FG%', ft: 'FT%' }

export interface PlayerIntent {
  kind: 'player'
  label: string
  stat: StatKey
  filter: Period
  ids: PlayerId[]
  big: (p: PlayerRec) => string
  lbl: string
  text: string
}

export interface GameIntent {
  kind: 'game'
  label: string
  ids: GameId[]
  text: string
}

export type IntentDef = PlayerIntent | GameIntent
export type IntentId = 'tp' | 'ppg' | 'apg' | 'rpg' | 'hot' | 'games'

export const INTENTS: Record<IntentId, IntentDef> = {
  tp: { label: '3-POINT SHOOTING', kind: 'player', stat: 'tp', filter: 'LAST 10', ids: ['cur', 'ant', 'mit', 'hal', 'luk'], big: (p) => p.tpL10.toFixed(1) + '%', lbl: '3P% · L10', text: "Curry's the headline — 51 makes at 44.8% over his last 10. Edwards and Mitchell are both above 42% on seven-plus attempts a night, and Haliburton is quietly fifth in the league on efficiency." },
  ppg: { label: 'SCORING LEADERS', kind: 'player', stat: 'ppg', filter: 'SEASON', ids: ['sga', 'luk', 'gia', 'ant', 'tat'], big: (p) => p.ppg.toFixed(1), lbl: 'PPG · SEASON', text: 'Scoring leaders by season average. Gilgeous-Alexander holds the top line at 32.8 a night, with Dončić and Giannis within two points of the lead.' },
  apg: { label: 'PLAYMAKING', kind: 'player', stat: 'apg', filter: 'SEASON', ids: ['hal', 'jok', 'luk', 'sga', 'mit'], big: (p) => p.apg.toFixed(1), lbl: 'APG · SEASON', text: 'Haliburton leads the league at 11.2 assists with the best assist-to-turnover ratio; Jokić is the only center in the top five.' },
  rpg: { label: 'REBOUNDING', kind: 'player', stat: 'rpg', filter: 'SEASON', ids: ['jok', 'gia', 'luk', 'tat', 'ant'], big: (p) => p.rpg.toFixed(1), lbl: 'RPG · SEASON', text: 'Jokić owns the glass at 12.8 boards a night. Giannis is right behind, and Tatum leads all wings at 8.7.' },
  hot: { label: 'HOT STREAKS', kind: 'player', stat: 'ppg', filter: 'LAST 10', ids: ['sga', 'cur', 'mit', 'ant', 'jok'], big: (p) => avg(p.l10p).toFixed(1), lbl: 'PPG · L10', text: 'Five hottest hands over the last 10 games, ranked by scoring surge. Gilgeous-Alexander has six straight 30-point games; Curry and Mitchell are both up four-plus points on their season average.' },
  games: { label: 'TONIGHT’S SLATE', kind: 'game', ids: ['okcden', 'indmin', 'bosnyk', 'lalgsw', 'milcle'], text: 'Five games on the board tonight. OKC–DEN is the tightest live margin with six minutes left, and IND–MIN is a one-possession game in the final minute. Two finals are in the books.' },
}

export const CHIP_QS = ["Who's hot from three?", "Tonight's closest games", 'Best playmakers right now', 'Who owns the glass?']

export const OPPS = ['DAL', '@PHX', 'MIL', '@DEN', 'UTA', 'SAS', '@LAC', 'MEM', '@GSW', 'HOU']

export const DATES = ['APR 3', 'APR 5', 'APR 6', 'APR 8', 'APR 10']

export const rebArr = (p: PlayerRec): number[] => p.l10p.map((v, i) => Math.max(1, Math.round(p.rpg + ((v + i * 3) % 5) - 2)))

export const astArr = (p: PlayerRec): number[] => p.l10p.map((v, i) => Math.max(0, Math.round(p.apg + ((v + i * 2) % 4) - 2)))

export const ord = (n: number): string => {
  const t = n % 10
  const h = n % 100
  if (t === 1 && h !== 11) return n + 'ST'
  if (t === 2 && h !== 12) return n + 'ND'
  if (t === 3 && h !== 13) return n + 'RD'
  return n + 'TH'
}

export const pctl = (key: StatKey, v: number): number => {
  const vals = Object.values(PLAYERS).map((p) => p[key])
  const mn = Math.min(...vals)
  const mx = Math.max(...vals)
  return mn === mx ? 75 : Math.round(55 + (44 * (v - mn)) / (mx - mn))
}

export const statVal = (p: PlayerRec, key: StatKey, period: Period): number => {
  if (period === 'SEASON') return p[key]
  const n = period === 'LAST 10' ? 10 : 5
  const sl = (a: number[]) => a.slice(10 - n)
  if (key === 'ppg') return avg(sl(p.l10p))
  if (key === 'rpg') return avg(sl(rebArr(p)))
  if (key === 'apg') return avg(sl(astArr(p)))
  if (key === 'tp') return p.tpL10 + (n === 5 ? ((p.num % 5) - 2) * 0.4 : 0)
  if (key === 'fg') return p.fg + ((((p.num * 3) % 20) - 10) / 10) * (n === 5 ? 1.4 : 1)
  return p.ft + (((p.num * 7) % 12) - 6) / 10
}

export const matchIntent = (q: string): IntentId => {
  const s = q.toLowerCase()
  if (/three|3-p|3p|deep|arc|shoot/.test(s)) return 'tp'
  if (/tonight|game|matchup|score|close|slate/.test(s)) return 'games'
  if (/assist|playmak|passer|dime/.test(s)) return 'apg'
  if (/rebound|board|glass/.test(s)) return 'rpg'
  if (/hot|streak|form|fire|surge/.test(s)) return 'hot'
  return 'ppg'
}

// ---- chat/selection state shapes ----

export interface UserMsg {
  role: 'user'
  text: string
}

export interface AiMsg {
  role: 'ai'
  intent: IntentId
  query: string
  text: string
}

export type Msg = UserMsg | AiMsg

export interface PlayerSel {
  type: 'player'
  id: PlayerId
  msg: number
  query: string
  stat: StatKey
  filter: Period
  metric: Metric
}

export interface GameSel {
  type: 'game'
  id: GameId
  msg: number
  query: string
  gmetric: GMetric
}

export type Selection = PlayerSel | GameSel
