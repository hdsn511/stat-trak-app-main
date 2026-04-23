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
    const disambiguation = envelope.disambiguation ?? null

    if (envelope.sql) {
      const v = await validateSql(envelope.sql)
      if (v.ok === false) {
        const failReason = v.reason
        const retryEnvelope = await callLLM(
          forLLM,
          `${message}\n\n[SYSTEM NOTE] Your previous SQL was rejected by the validator: ${failReason}. Produce a corrected query.`
        )
        if (retryEnvelope.sql) {
          const v2 = await validateSql(retryEnvelope.sql)
          if (v2.ok) {
            sqlForLog = retryEnvelope.sql
            rows = await runReadOnly(v2.rewritten)
          }
        }
      } else {
        sqlForLog = envelope.sql
        try {
          rows = await runReadOnly(v.rewritten)
        } catch (err: any) {
          const retryEnvelope = await callLLM(
            forLLM,
            `${message}\n\n[SYSTEM NOTE] Your previous SQL errored: ${err.message}. Produce a corrected query.`
          )
          if (retryEnvelope.sql) {
            const v2 = await validateSql(retryEnvelope.sql)
            if (v2.ok) {
              sqlForLog = retryEnvelope.sql
              rows = await runReadOnly(v2.rewritten)
            }
          }
        }
      }
    }

    send('results', {
      rows,
      disambiguation,
      follow_up_suggestions: envelope.follow_up_suggestions ?? [],
    })

    await appendMessage(
      sessionId,
      'assistant',
      envelope.narrative,
      sqlForLog,
      rows.length
    )

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
