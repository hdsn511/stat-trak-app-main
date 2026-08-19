import type { Request, Response } from 'express'
import { callLLM } from '../services/sportqueryLLM'
import { validateSql } from '../services/sqlValidator'
import { runReadOnly } from '../services/sportqueryDB'
import {
  appendMessage,
  createSession,
  deleteSession,
  getMessages,
  listSessions,
  setSessionTitle,
} from '../services/sportquerySession'
import { detectShape, enrich } from '../services/sportqueryEnrich'
import { supabaseAdmin } from '../config/supabaseAdmin'

type SlateTable = 'pick_results' | 'daily_lines'

// SportQuery's documented schema is NBA-only, so every slate lookup is too.
// Without this the fallback finds an MLB date, substitutes it into an
// NBA-scoped query, and still comes back empty.
const SPORTQUERY_LEAGUE_ID = 1

/**
 * The slate closest to today, preferring an upcoming one. Looking only forward
 * fails whenever the pipeline's data ends yesterday, which is the normal state
 * between slates and during an off-season.
 */
async function findNearestSlate(
  table: SlateTable
): Promise<{ date: string; direction: 'upcoming' | 'past' } | null> {
  const today = new Date().toISOString().slice(0, 10)

  const [upcoming, past] = await Promise.all([
    supabaseAdmin
      .from(table)
      .select('game_date')
      .eq('league_id', SPORTQUERY_LEAGUE_ID)
      .gte('game_date', today)
      .order('game_date', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from(table)
      .select('game_date')
      .eq('league_id', SPORTQUERY_LEAGUE_ID)
      .lt('game_date', today)
      .order('game_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (upcoming.data?.game_date) {
    return { date: upcoming.data.game_date, direction: 'upcoming' }
  }
  if (past.data?.game_date) {
    return { date: past.data.game_date, direction: 'past' }
  }
  return null
}

// If the query targets picks/lines with a strict CURRENT_DATE and returned 0
// rows, re-run it against the nearest slate that has data. Returns the
// (possibly widened) rows and a note describing the substitution, so the UI
// never presents another day's slate as though it were today's.
async function maybeWidenToNearestSlate(
  sql: string,
  rows: any[]
): Promise<{ rows: any[]; note: string | null }> {
  if (rows.length > 0) return { rows, note: null }

  const picksMatch = /FROM\s+pick_results/i.test(sql)
  const linesMatch = /FROM\s+daily_lines/i.test(sql)
  if (!/CURRENT_DATE/.test(sql) || (!picksMatch && !linesMatch)) return { rows, note: null }

  const table: SlateTable = picksMatch ? 'pick_results' : 'daily_lines'
  const slate = await findNearestSlate(table)
  if (!slate) return { rows, note: null }

  const v = await validateSql(sql.replace(/CURRENT_DATE/g, `'${slate.date}'`))
  if (v.ok === false) {
    console.warn(`[sportquery] date-widening validator rejected widened SQL: ${v.reason}`)
    return { rows, note: null }
  }

  const widenedRows = await runReadOnly(v.rewritten)
  if (widenedRows.length === 0) return { rows, note: null }

  return {
    rows: widenedRows,
    note:
      slate.direction === 'upcoming'
        ? `No rows for today — showing the next slate, ${slate.date}.`
        : `No rows for today — showing the most recent slate, ${slate.date}.`,
  }
}

export async function postSession(_req: Request, res: Response) {
  try {
    const s = await createSession()
    res.json({ success: true, data: { sessionId: s.id } })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function getSessions(_req: Request, res: Response) {
  try {
    const rows = await listSessions()
    res.json({ success: true, data: rows })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function getSessionMessages(req: Request, res: Response) {
  try {
    const rows = await getMessages(req.params.id!)
    res.json({ success: true, data: rows })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function deleteSessionHandler(req: Request, res: Response) {
  try {
    await deleteSession(req.params.id!)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
}

export async function postMessage(req: Request, res: Response) {
  const { sessionId, message } = req.body ?? {}
  if (!sessionId || !message) {
    res
      .status(400)
      .json({ success: false, error: 'sessionId and message required' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    await appendMessage(sessionId, 'user', message)

    const history = await getMessages(sessionId)
    const forLLM = history.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const envelope = await callLLM(forLLM, message)

    send('narrative', { token: envelope.narrative })

    let rows: any[] = []
    let sqlForLog: string | null = null
    // Set when the model produced SQL that never ran. Without this the user
    // gets a confident narrative next to an empty result area and no reason.
    let queryError: string | null = null
    const disambiguation = envelope.disambiguation ?? null

    // Ask the model for a corrected query, then validate and run it. Returns
    // null when the retry is unusable, so the caller can report the failure.
    const retryOnce = async (why: string): Promise<{ sql: string; rows: any[] } | null> => {
      const retryEnvelope = await callLLM(
        forLLM,
        `${message}\n\n[SYSTEM NOTE] ${why} Produce a corrected query.`
      )
      if (!retryEnvelope.sql) return null
      const v2 = await validateSql(retryEnvelope.sql)
      if (!v2.ok) return null
      try {
        return { sql: retryEnvelope.sql, rows: await runReadOnly(v2.rewritten) }
      } catch {
        return null
      }
    }

    if (envelope.sql) {
      const v = await validateSql(envelope.sql)
      if (v.ok === false) {
        const retry = await retryOnce(`Your previous SQL was rejected by the validator: ${v.reason}.`)
        if (retry) {
          sqlForLog = retry.sql
          rows = retry.rows
        } else {
          queryError = `The generated query was rejected (${v.reason}) and the retry also failed.`
        }
      } else {
        try {
          sqlForLog = envelope.sql
          rows = await runReadOnly(v.rewritten)
        } catch (err: any) {
          const retry = await retryOnce(`Your previous SQL errored: ${err.message}.`)
          if (retry) {
            sqlForLog = retry.sql
            rows = retry.rows
          } else {
            sqlForLog = null
            queryError = `The generated query failed to run (${err.message}) and the retry also failed.`
          }
        }
      }
    }

    let wideningNote: string | null = null
    if (sqlForLog) {
      const fb = await maybeWidenToNearestSlate(sqlForLog, rows)
      if (fb.rows.length > rows.length) {
        rows = fb.rows
        wideningNote = fb.note
      }
    }

    const shape = detectShape(rows)
    const enriched = enrich(shape, rows)

    send('results', {
      rows: enriched,
      shape,
      widening_note: wideningNote,
      query_error: queryError,
      disambiguation,
      follow_up_suggestions: envelope.follow_up_suggestions ?? [],
    })

    await appendMessage(sessionId, 'assistant', envelope.narrative, {
      sqlExecuted: sqlForLog,
      resultCount: rows.length,
      resultRows: enriched.length > 0 ? enriched : null,
      resultShape: enriched.length > 0 ? shape : null,
    })

    if (history.length === 1) {
      await setSessionTitle(sessionId, message)
    }

    send('done', {})
  } catch (err: any) {
    send('error', { error: err.message ?? 'unknown error' })
  } finally {
    res.end()
  }
}
