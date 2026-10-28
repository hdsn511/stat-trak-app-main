import { describe, expect, it } from 'vitest'
import { priorSeasonWindow } from '../src/utils/streakWindow'
import { league } from '../src/config/leagues'

const NBA = league({ locals: {} } as any)
const g = (d: string) => ({ game_date: d })

describe('priorSeasonWindow', () => {
  it('does not borrow last season to fill the window (Jalen Wilson case)', () => {
    const april = Array.from({ length: 10 }, (_, i) => g(`2026-04-${String(i + 1).padStart(2, '0')}`))
    // Ten April games, none yet this season: no streak on 2026-10-28.
    expect(priorSeasonWindow(april, april.length, '2026-10-28', NBA)).toBeNull()
  })

  it('does not mix last season with the first games of this one', () => {
    const games = [
      ...Array.from({ length: 8 }, (_, i) => g(`2026-04-1${i}`)),
      g('2026-10-23'),
      g('2026-10-25'),
    ]
    expect(priorSeasonWindow(games, games.length, '2026-10-28', NBA)).toBeNull()
  })

  it('returns the last 10 when all are in the same season', () => {
    const games = Array.from({ length: 12 }, (_, i) => g(`2026-10-${String(i + 1).padStart(2, '0')}`))
    const w = priorSeasonWindow(games, games.length, '2026-10-28', NBA)
    expect(w).toHaveLength(10)
    expect(w![0]!.game_date).toBe('2026-10-03')
  })
})
