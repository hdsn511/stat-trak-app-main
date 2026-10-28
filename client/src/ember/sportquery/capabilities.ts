/**
 * What SportQuery can answer, per sport. Mirrors the tables and columns the
 * model is given in server/src/prompts/sportquery-system.ts — when a stat is
 * added or removed there, update it here so the "what can I ask" panel never
 * promises a number the model can't produce.
 */

import type { LeagueSlug } from '@/config/leagues'

export interface StatGroup {
  label: string
  stats: string[]
}

export interface SportCapability {
  slug: LeagueSlug
  label: string
  /** The model's stat columns, grouped the way a question would name them. */
  groups: StatGroup[]
  /** Pre-computed trend stats (z-score vs season baseline over 3/5/10 games). */
  trends: string[]
  /** Kalshi lines and model picks exist for this sport. */
  markets: boolean
  /** Things people expect that the data does not have. */
  notAvailable: string
  examples: string[]
}

export const SPORTS: SportCapability[] = [
  {
    slug: 'nba',
    label: 'NBA',
    groups: [
      { label: 'Box score', stats: ['Points', 'Rebounds', 'Assists', '3-pointers made', 'Fouls', 'Minutes'] },
      {
        label: 'Context',
        stats: ['Home / away', 'Days of rest', 'Opponent', 'Opponent defense rank by position', 'Teammates out'],
      },
    ],
    trends: ['Points', 'Rebounds', 'Assists', '3PM', 'Fouls', 'Minutes'],
    markets: false,
    notAvailable:
      'Shooting percentages, steals, blocks, turnovers, plus-minus. Usage, pace and tracking stats stop after 2025-26.',
    examples: [
      'Top 5 NBA scorers by points per game last season',
      'Who scored the most points in the NBA last night?',
      'Which guards are trending up on assists over the last 5 games?',
    ],
  },
  {
    slug: 'mlb',
    label: 'MLB',
    groups: [
      {
        label: 'Batting',
        stats: [
          'At bats', 'Hits', 'Doubles', 'Triples', 'Home runs', 'RBI', 'Runs', 'Walks',
          'Strikeouts', 'Stolen bases', 'Total bases', 'Plate appearances',
        ],
      },
      {
        label: 'Pitching',
        stats: ['Outs pitched', 'Earned runs', 'Strikeouts', 'Walks', 'Hits allowed', 'HR allowed', 'Batters faced'],
      },
      {
        label: 'Context',
        stats: ['Opposing starter + hand', 'Park factors', 'Pitcher ERA / FIP / WHIP', 'Batting order', 'Home / away'],
      },
    ],
    trends: ['Hits', 'Total bases', 'RBI', 'Runs', 'Home runs'],
    markets: false,
    notAvailable: 'Betting lines and picks are not offered right now. AVG / OBP / SLG are not stored, but are calculated from the counting stats when you ask.',
    examples: [
      'Who has the most home runs this season in MLB?',
      'Top 5 MLB starting pitchers by strikeouts this season',
      'Best MLB hitters by batting average over their last 10 games',
    ],
  },
  {
    slug: 'nfl',
    label: 'NFL',
    groups: [
      {
        label: 'Passing',
        stats: ['Completions', 'Attempts', 'Yards', 'TDs', 'Interceptions', 'Sacks taken', 'QBR', 'Passer rating'],
      },
      { label: 'Rushing', stats: ['Carries', 'Yards', 'TDs', 'Long'] },
      { label: 'Receiving', stats: ['Receptions', 'Targets', 'Yards', 'TDs', 'Long'] },
      { label: 'Defense', stats: ['Tackles', 'Solo tackles', 'Sacks', 'Tackles for loss', 'Passes defended', 'Def TDs'] },
      { label: 'Kicking', stats: ['FG made / attempted', 'XP made / attempted'] },
    ],
    trends: ['Passing yds', 'Passing TD', 'Rushing yds', 'Rushing TD', 'Receiving yds', 'Receptions', 'Receiving TD', 'Tackles'],
    markets: false,
    notAvailable: 'Betting lines and picks (not offered).',
    examples: [
      'Top 5 NFL quarterbacks by passing yards this season',
      'Who leads the NFL in receiving yards this season?',
      'Which running backs have the most rushing touchdowns?',
    ],
  },
  {
    slug: 'nhl',
    label: 'NHL',
    groups: [
      {
        label: 'Skaters',
        stats: [
          'Goals', 'Assists', 'Points', 'Shots on goal', 'Blocks', 'Hits', 'Takeaways', 'Giveaways',
          'Plus-minus', 'PIM', 'Faceoffs', 'Time on ice (total / PP / SH)', 'Shifts',
        ],
      },
      {
        label: 'Goalies',
        stats: ['Saves', 'Shots against', 'Goals against', 'Save %', 'Even-strength / PP / SH saves'],
      },
    ],
    trends: ['Goals', 'Assists', 'Points', 'Shots on goal', 'Blocks', 'Hits'],
    markets: false,
    notAvailable: 'Betting lines and picks (not offered).',
    examples: [
      'Top 5 NHL goal scorers this season',
      'Which NHL goalies have the best save percentage this season?',
      'Who has the most points in the NHL over their last 10 games?',
    ],
  },
]

export const ACROSS_SPORTS = [
  'Game results and scores for every league',
  'Standings — finished-season tables for NFL/NHL; NBA/MLB records are calculated from game scores',
  'Head-to-head: how a player or team does against a specific opponent',
]

export const WHAT_YOU_CAN_DO = [
  { title: 'Rank', body: 'Leaders in any stat above — “top 10 …”, “who has the most …”.' },
  { title: 'Narrow', body: 'Last N games, home or away, vs a team, with days of rest, or without a teammate.' },
  { title: 'Spot trends', body: 'Who is running above their season baseline over the last 3, 5 or 10 games.' },
  { title: 'Follow up', body: 'Say “now only …” to refine the last answer. Click any result to open that player.' },
]

export const LIMITS = [
  'Read-only: it looks up and calculates stats, it does not predict games.',
  'Covers final games only — no live in-game stats.',
  'Works best with one sport per question; name the sport if a player or team is ambiguous.',
]

/** Starter chips shown on an empty conversation — one per sport. */
export const STARTER_QUESTIONS = [
  SPORTS[0]!.examples[0]!,
  SPORTS[1]!.examples[0]!,
  SPORTS[2]!.examples[0]!,
  SPORTS[3]!.examples[1]!,
]
