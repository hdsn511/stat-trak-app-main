import { Pool, type QueryResult } from 'pg'

const connectionString = process.env.SPORTQUERY_DB_URL
if (!connectionString) {
  console.warn(
    'SportQuery: SPORTQUERY_DB_URL not set. Assistant DB queries will fail.'
  )
}

const pool = connectionString
  ? new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
    })
  : null

export type RowSet = Record<string, unknown>[]

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
