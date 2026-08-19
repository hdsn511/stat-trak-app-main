import { Pool, type QueryResult } from 'pg'

const connectionString = process.env.SPORTQUERY_DB_URL
if (!connectionString) {
  console.warn(
    'SportQuery: SPORTQUERY_DB_URL not set. Assistant DB queries will fail.'
  )
}

// On Lambda a container handles one request at a time, so anything above 1 is
// idle connections multiplied by the container count — which is how a
// serverless fan-out exhausts Postgres. Locally a small pool still helps.
const poolMax = Number(process.env.PG_POOL_MAX ?? (process.env.AWS_LAMBDA_FUNCTION_NAME ? 1 : 5))

const pool = connectionString
  ? new Pool({
      connectionString,
      max: poolMax,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
    })
  : null

export type RowSet = Record<string, unknown>[]

/**
 * Run a query inside a read-only transaction.
 *
 * Deployed, SPORTQUERY_DB_URL points at Supabase's Supavisor transaction-mode
 * pooler (port 6543), which forbids session-scoped state — every statement here
 * is transaction-scoped, which is why `SET LOCAL` rather than `SET` is required
 * and not merely tidier.
 *
 * Transaction mode also has no prepared statements. node-postgres only uses
 * them for a query given a `name`, so passing plain SQL keeps this compatible —
 * a constraint to preserve, not an accident.
 */
export async function runReadOnly(sql: string): Promise<RowSet> {
  if (!pool) throw new Error('SportQuery DB pool not configured')
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '2s'")
    const res: QueryResult = await client.query(sql)
    await client.query('COMMIT')
    return res.rows as RowSet
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
  }
}

export async function shutdownPool(): Promise<void> {
  if (pool) await pool.end()
}
