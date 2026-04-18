import { parse as parseQuery } from 'libpg-query'

export type ValidationResult =
  | { ok: true; rewritten: string }
  | { ok: false; reason: string }

const ALLOWED_TABLES = new Set([
  'players',
  'teams',
  'games',
  'leagues',
  'rosters',
  'nba_player_stats',
  'nba_trends',
  'player_game_conditions',
  'team_game_stats',
  'player_availability',
  'opponent_position_defense',
  'daily_conditions',
  'daily_lines',
  'pick_results',
  'game_matchups',
])

function collectRangeVars(node: any, bucket: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectRangeVars(n, bucket))
    return
  }
  if (node.RangeVar?.relname) {
    bucket.push(String(node.RangeVar.relname).toLowerCase())
  }
  for (const key of Object.keys(node)) {
    collectRangeVars(node[key], bucket)
  }
}

function collectFuncCalls(node: any, bucket: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectFuncCalls(n, bucket))
    return
  }
  if (node.FuncCall?.funcname) {
    const names = node.FuncCall.funcname
      .map((n: any) => (n.String?.sval ?? n.String?.str ?? '').toLowerCase())
      .filter(Boolean)
    if (names.length) bucket.push(names.join('.'))
  }
  for (const key of Object.keys(node)) {
    collectFuncCalls(node[key], bucket)
  }
}

function collectSchemaRefs(node: any, bucket: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectSchemaRefs(n, bucket))
    return
  }
  if (node.RangeVar?.schemaname) {
    bucket.push(String(node.RangeVar.schemaname).toLowerCase())
  }
  for (const key of Object.keys(node)) {
    collectSchemaRefs(node[key], bucket)
  }
}

function collectCteNames(node: any, bucket: Set<string>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectCteNames(n, bucket))
    return
  }
  if (node.CommonTableExpr?.ctename) {
    bucket.add(String(node.CommonTableExpr.ctename).toLowerCase())
  }
  for (const key of Object.keys(node)) {
    collectCteNames(node[key], bucket)
  }
}

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

  // Schema-qualified access (e.g. information_schema.tables, pg_catalog.*)
  // is always disallowed.
  const schemas: string[] = []
  collectSchemaRefs(stmt, schemas)
  for (const s of schemas) {
    if (s && s !== 'public') {
      return { ok: false, reason: `schema '${s}' is not allowed` }
    }
  }

  // CTE-defined relation names are treated as allowed (they reference a
  // sub-SELECT, not a real table — the sub-SELECT itself is still walked
  // and validated against the allowlist).
  const cteNames = new Set<string>()
  collectCteNames(stmt, cteNames)

  const tables: string[] = []
  collectRangeVars(stmt, tables)
  for (const t of tables) {
    if (cteNames.has(t)) continue
    if (!ALLOWED_TABLES.has(t)) {
      return { ok: false, reason: `table '${t}' is not allowlisted` }
    }
  }

  const funcs: string[] = []
  collectFuncCalls(stmt, funcs)
  for (const f of funcs) {
    if (f.startsWith('pg_') || f.includes('.pg_')) {
      return { ok: false, reason: `function '${f}' is not allowed` }
    }
    if (['dblink', 'lo_import', 'lo_export'].some((bad) => f.includes(bad))) {
      return { ok: false, reason: `function '${f}' is not allowed` }
    }
  }

  // LIMIT cap: wrap with a hard cap of 500. If inner query already has a
  // trailing LIMIT N, replace it with min(N, 500); otherwise wrap.
  const MAX_LIMIT = 500
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  const limitMatch = /\bLIMIT\s+(\d+)\s*$/i.exec(trimmed)
  let rewritten: string
  if (limitMatch) {
    const existing = parseInt(limitMatch[1]!, 10)
    const capped = Math.min(existing, MAX_LIMIT)
    rewritten = trimmed.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${capped}`)
  } else {
    rewritten = `SELECT * FROM (${trimmed}) AS _sq LIMIT ${MAX_LIMIT}`
  }

  return { ok: true, rewritten }
}
