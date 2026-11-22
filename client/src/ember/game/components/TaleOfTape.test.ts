import { describe, it, expect } from 'vitest'
import { keyMatchups } from './tape'

const side = (rank: number) => ({ value: 100, rank, vs_league: 0 })
const row = (key: string, label: string, away: number, home: number) => ({
  key, label, better: 'higher' as const, away: side(away), home: side(home),
})

describe('keyMatchups', () => {
  it('pairs each offense with the other side’s defense and ranks by gap', () => {
    const lanes = keyMatchups({
      team_count: 30,
      // away scores #2 into a home defense ranked #28: a big offense edge.
      offense: [row('pts', 'PTS', 2, 15), row('reb', 'REB', 14, 1)],
      // home rebounds #1 into an away defense ranked #3: strength vs strength.
      defense: [row('pts', 'PTS ALLOWED', 16, 28), row('reb', 'REB ALLOWED', 3, 12)],
    })
    expect(lanes[0]).toMatchObject({ offense: 'away', stat: 'PTS', offRank: 2, defRank: 28, gap: 26, verdict: 'offense' })
    expect(lanes.find((l) => l.offense === 'home' && l.stat === 'REB')).toMatchObject({ gap: 2, verdict: 'even' })
    expect(lanes).toHaveLength(3)
  })

  it('calls a defense edge when the offense ranks far worse', () => {
    const [top] = keyMatchups({
      team_count: 30,
      offense: [row('ast', 'AST', 29, 15)],
      defense: [row('ast', 'AST ALLOWED', 15, 1)],
    }, 1)
    expect(top).toMatchObject({ offense: 'away', verdict: 'defense', gap: -28 })
  })
})
