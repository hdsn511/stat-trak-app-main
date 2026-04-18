import { describe, it, expect } from 'vitest'
import { validateSql } from '../src/services/sqlValidator'

describe('sqlValidator — parse & statement type', () => {
  it('accepts a simple SELECT', async () => {
    const result = await validateSql('SELECT 1')
    expect(result.ok).toBe(true)
  })

  it('accepts a SELECT with CTE', async () => {
    const result = await validateSql(
      'WITH t AS (SELECT 1 AS x) SELECT x FROM t'
    )
    expect(result.ok).toBe(true)
  })

  it('rejects unparsable SQL', async () => {
    const result = await validateSql('SELEKT 1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/parse/i)
  })

  it('rejects INSERT', async () => {
    const result = await validateSql("INSERT INTO players (id) VALUES (1)")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/SELECT/i)
  })

  it('rejects UPDATE', async () => {
    const result = await validateSql(
      "UPDATE players SET name = 'x' WHERE id = 1"
    )
    expect(result.ok).toBe(false)
  })

  it('rejects DELETE', async () => {
    const result = await validateSql('DELETE FROM players WHERE id = 1')
    expect(result.ok).toBe(false)
  })

  it('rejects DROP', async () => {
    const result = await validateSql('DROP TABLE players')
    expect(result.ok).toBe(false)
  })

  it('rejects two statements', async () => {
    const result = await validateSql('SELECT 1; SELECT 2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/single|one/i)
  })
})

describe('sqlValidator — table whitelist', () => {
  it('accepts queries against allowlisted tables', async () => {
    const result = await validateSql(
      'SELECT id FROM players WHERE name ILIKE $1'
    )
    expect(result.ok).toBe(true)
  })

  it('accepts joins across allowlisted tables', async () => {
    const result = await validateSql(`
      SELECT s.points FROM nba_player_stats s
      JOIN players p ON s.player_id = p.id
      JOIN game_matchups gm ON s.game_id = gm.game_id
    `)
    expect(result.ok).toBe(true)
  })

  it('rejects queries hitting pg_class', async () => {
    const result = await validateSql('SELECT * FROM pg_class')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/table|allow/i)
  })

  it('rejects queries hitting information_schema', async () => {
    const result = await validateSql(
      'SELECT * FROM information_schema.tables'
    )
    expect(result.ok).toBe(false)
  })

  it('rejects unknown tables', async () => {
    const result = await validateSql('SELECT * FROM secret_table')
    expect(result.ok).toBe(false)
  })

  it('rejects pg_sleep function', async () => {
    const result = await validateSql('SELECT pg_sleep(5)')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/function|pg_/i)
  })
})

describe('sqlValidator — LIMIT injection', () => {
  it('injects LIMIT 500 when none present', async () => {
    const result = await validateSql('SELECT id FROM players')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rewritten).toMatch(/LIMIT\s+500/i)
  })

  it('caps existing LIMIT > 500 to 500', async () => {
    const result = await validateSql('SELECT id FROM players LIMIT 5000')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rewritten).toMatch(/LIMIT\s+500/i)
      expect(result.rewritten).not.toMatch(/LIMIT\s+5000/i)
    }
  })

  it('preserves existing LIMIT < 500', async () => {
    const result = await validateSql('SELECT id FROM players LIMIT 10')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rewritten).toMatch(/LIMIT\s+10/i)
  })
})
