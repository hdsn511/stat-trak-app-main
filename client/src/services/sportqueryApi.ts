const BASE = 'http://localhost:3000/api/sportquery'

export type SessionSummary = {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

/** Shape the server detected for a result set; drives which card renders. */
export type ResultShape = 'player_trends' | 'player_games' | 'picks' | 'lines' | 'generic'

/** One result row. Columns vary by shape, so this stays open. */
export type ResultRow = Record<string, unknown>

export type MessageRow = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  sql_executed: string | null
  result_count: number | null
  result_rows: ResultRow[] | null
  result_shape: ResultShape | null
  created_at: string
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
  return body.data as T
}

export async function createSession(): Promise<string> {
  const res = await fetch(`${BASE}/session`, { method: 'POST' })
  const data = await json<{ sessionId: string }>(res)
  return data.sessionId
}

export async function listSessions(): Promise<SessionSummary[]> {
  return json(await fetch(`${BASE}/sessions`))
}

export async function loadMessages(sessionId: string): Promise<MessageRow[]> {
  return json(await fetch(`${BASE}/session/${sessionId}/messages`))
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${BASE}/session/${sessionId}`, { method: 'DELETE' })
  await json<unknown>(res)
}

export type Disambiguation = { candidates: string[]; prompt: string }

export type StreamEvent =
  | { type: 'narrative'; token: string }
  | {
      type: 'results'
      rows: ResultRow[]
      shape: ResultShape
      /** Set when the query asked for today and the server used the next slate. */
      wideningNote: string | null
      /** Set when SQL was generated but never ran successfully. */
      queryError: string | null
      disambiguation: Disambiguation | null
      followUps: string[]
    }
  | { type: 'done' }
  | { type: 'error'; error: string }

/**
 * POST a message and dispatch the server-sent events it streams back.
 *
 * The endpoint answers with SSE on success but plain JSON on rejection (a rate
 * limit, a validation error), so the content type is checked before the body
 * is treated as a stream.
 */
export async function streamMessage(
  sessionId: string,
  message: string,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
    signal,
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const body = await res.json().catch(() => null)
    const error =
      body?.error ??
      (res.status === 429 ? 'Rate limited — slow down for a moment.' : `Request failed (${res.status})`)
    onEvent({ type: 'error', error })
    return
  }

  if (!res.body) {
    onEvent({ type: 'error', error: 'No response body' })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (chunk: string) => {
    const eventLine = chunk.match(/^event:\s*(.+)$/m)
    // A data payload can wrap across lines; join every data: line in the frame.
    const dataLines = [...chunk.matchAll(/^data:\s?(.*)$/gm)].map((m) => m[1])
    if (!eventLine || dataLines.length === 0) return

    let data: Record<string, unknown>
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }

    switch (eventLine[1]!.trim()) {
      case 'narrative':
        onEvent({ type: 'narrative', token: String(data.token ?? '') })
        break
      case 'results':
        onEvent({
          type: 'results',
          rows: (data.rows as ResultRow[]) ?? [],
          shape: (data.shape as ResultShape) ?? 'generic',
          wideningNote: (data.widening_note as string) ?? null,
          queryError: (data.query_error as string) ?? null,
          disambiguation: (data.disambiguation as Disambiguation) ?? null,
          followUps: (data.follow_up_suggestions as string[]) ?? [],
        })
        break
      case 'done':
        onEvent({ type: 'done' })
        break
      case 'error':
        onEvent({ type: 'error', error: String(data.error ?? 'unknown') })
        break
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    frames.forEach(dispatch)
  }
  if (buffer.trim()) dispatch(buffer)
}
