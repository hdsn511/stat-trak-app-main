import { describe, expect, it } from 'vitest'
import { HERO_CHIPS, UNSUPPORTED_RE } from './suggestions'
import { SPORTS, STARTER_QUESTIONS } from './capabilities'
import { mlbConfig, nbaConfig, nflConfig, nhlConfig } from '@/ember/league/leagueConfigs'

const all: [string, string][] = [
  ...HERO_CHIPS.map((q) => ['home', q] as [string, string]),
  ...STARTER_QUESTIONS.map((q) => ['starter', q] as [string, string]),
  ...SPORTS.flatMap((s) => s.examples.map((q) => [`${s.slug} example`, q] as [string, string])),
  ...[nbaConfig, mlbConfig, nflConfig, nhlConfig].flatMap((c) =>
    c.chips.map((q) => [`${c.slug} chip`, q] as [string, string])
  ),
]

describe('suggested queries', () => {
  it.each(all)('%s: "%s" only asks for data we store', (_where, q) => {
    expect(UNSUPPORTED_RE.test(q)).toBe(false)
  })

  it('catches the kind of question we cannot answer', () => {
    expect(UNSUPPORTED_RE.test('hardest hit balls this week')).toBe(true)
    expect(UNSUPPORTED_RE.test('who scores most in clutch minutes?')).toBe(true)
    expect(UNSUPPORTED_RE.test('best red-zone rushers?')).toBe(true)
  })
})
