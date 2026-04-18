import { parse as parseQuery } from 'libpg-query'

export type ValidationResult =
  | { ok: true; rewritten: string }
  | { ok: false; reason: string }

export async function validateSql(sql: string): Promise<ValidationResult> {
  if (!sql || typeof sql !== 'string') {
    return { ok: false, reason: 'empty query' }
  }

  let parsed: any
  try {
    parsed = await parseQuery(sql)
  } catch (err: any) {
    return { ok: false, reason: `parse error: ${err.message}` }
  }

  const stmts = parsed?.stmts ?? []
  if (stmts.length !== 1) {
    return { ok: false, reason: 'must be a single SELECT statement' }
  }

  const stmt = stmts[0].stmt
  if (!stmt || !('SelectStmt' in stmt)) {
    return { ok: false, reason: 'only SELECT statements are allowed' }
  }

  return { ok: true, rewritten: sql }
}
