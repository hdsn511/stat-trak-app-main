// Defaults to the main API's /sportquery path; override with
// VITE_SPORTQUERY_BASE_URL once the streaming route moves to its own Lambda
// Function URL origin (API Gateway buffers full responses, so SSE streaming
// needs a separate host — see infra/lib/api-stack.ts).
const BASE =
  import.meta.env.VITE_SPORTQUERY_BASE_URL ??
  `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api'}/sportquery`

export type SessionSummary = {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  sql_executed: string | null
  result_count: number | null
  created_at: string
}

export type PlayerResultRow = {
  id?: number
  player_id?: number
  name?: string
  team?: string
  position?: string
  z_score?: number
  rolling_avg?: number
  [k: string]: unknown
}

export async function createSession(): Promise<string> {
  const r = await fetch(`${BASE}/session`, { method: 'POST' })
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
  return j.data.sessionId
}

export async function listSessions(): Promise<SessionSummary[]> {
  const r = await fetch(`${BASE}/sessions`)
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
  return j.data
}

export async function loadMessages(sessionId: string): Promise<MessageRow[]> {
  const r = await fetch(`${BASE}/session/${sessionId}/messages`)
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
  return j.data
}

export async function deleteSession(sessionId: string): Promise<void> {
  const r = await fetch(`${BASE}/session/${sessionId}`, { method: 'DELETE' })
  const j = await r.json()
  if (!j.success) throw new Error(j.error)
}

export type StreamEvent =
  | { type: 'narrative'; token: string }
  | {
      type: 'results'
      rows: PlayerResultRow[]
      disambiguation?: { candidates: string[]; prompt: string } | null
      follow_up_suggestions?: string[]
    }
  | { type: 'done' }
  | { type: 'error'; error: string }

export async function streamMessage(
  sessionId: string,
  message: string,
  onEvent: (e: StreamEvent) => void
): Promise<void> {
  const res = await fetch(`${BASE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  })

  if (!res.body) throw new Error('No response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const eventLine = part.match(/^event:\s*(.+)$/m)
      const dataLine = part.match(/^data:\s*(.+)$/m)
      if (!eventLine || !dataLine) continue
      const eventName = eventLine[1]!.trim()
      const data = JSON.parse(dataLine[1]!)
      switch (eventName) {
        case 'narrative':
          onEvent({ type: 'narrative', token: data.token })
          break
        case 'results':
          onEvent({
            type: 'results',
            rows: data.rows ?? [],
            disambiguation: data.disambiguation ?? null,
            follow_up_suggestions: data.follow_up_suggestions ?? [],
          })
          break
        case 'done':
          onEvent({ type: 'done' })
          break
        case 'error':
          onEvent({ type: 'error', error: data.error ?? 'unknown' })
          break
      }
    }
  }
}
