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
