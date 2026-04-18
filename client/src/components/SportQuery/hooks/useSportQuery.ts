import { useCallback, useEffect, useState } from 'react'
import {
  type MessageRow,
  type PlayerResultRow,
  createSession,
  loadMessages,
  streamMessage,
} from '../../../services/sportqueryApi'

export type ChatTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
  rows?: PlayerResultRow[]
  disambiguation?: { candidates: string[]; prompt: string } | null
  follow_up_suggestions?: string[]
  isStreaming?: boolean
}

export function useSportQuery(initialSessionId?: string) {
  const [sessionId, setSessionId] = useState<string | undefined>(
    initialSessionId
  )
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (!initialSessionId) return
    loadMessages(initialSessionId)
      .then((rows: MessageRow[]) => {
        setTurns(
          rows.map((r) => ({
            id: r.id,
            role: r.role,
            content: r.content,
          }))
        )
        setSessionId(initialSessionId)
      })
      .catch(() => setTurns([]))
  }, [initialSessionId])

  const send = useCallback(
    async (message: string) => {
      let sid = sessionId
      if (!sid) {
        sid = await createSession()
        setSessionId(sid)
      }

      const userTurn: ChatTurn = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: message,
      }
      const assistantTurn: ChatTurn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        isStreaming: true,
      }
      setTurns((t) => [...t, userTurn, assistantTurn])
      setIsSending(true)

      await streamMessage(sid, message, (e) => {
        setTurns((t) =>
          t.map((turn) => {
            if (turn.id !== assistantTurn.id) return turn
            if (e.type === 'narrative') {
              return { ...turn, content: turn.content + e.token }
            }
            if (e.type === 'results') {
              return {
                ...turn,
                rows: e.rows,
                disambiguation: e.disambiguation,
                follow_up_suggestions: e.follow_up_suggestions,
              }
            }
            if (e.type === 'done') {
              return { ...turn, isStreaming: false }
            }
            if (e.type === 'error') {
              return {
                ...turn,
                content: turn.content + `\n\n(Error: ${e.error})`,
                isStreaming: false,
              }
            }
            return turn
          })
        )
      })
      setIsSending(false)
    },
    [sessionId]
  )

  return { sessionId, turns, isSending, send }
}
