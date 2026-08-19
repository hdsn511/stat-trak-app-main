import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSession,
  deleteSession,
  listSessions,
  loadMessages,
  streamMessage,
  type Disambiguation,
  type ResultRow,
  type ResultShape,
  type SessionSummary,
} from '@/services/sportqueryApi'

export interface UserTurn {
  id: string
  role: 'user'
  text: string
}

export interface AssistantTurn {
  id: string
  role: 'assistant'
  text: string
  /** The user question this answers, shown as context on the detail pane. */
  query: string
  rows: ResultRow[]
  shape: ResultShape
  wideningNote: string | null
  queryError: string | null
  disambiguation: Disambiguation | null
  followUps: string[]
  pending: boolean
}

export type Turn = UserTurn | AssistantTurn

let localId = 0
const nextId = () => `local-${++localId}`

/**
 * SportQuery conversation state against the streaming backend.
 *
 * A turn moves through three steps: the user message is appended immediately,
 * a pending assistant turn is created, then the narrative and result events
 * fill it in. Result rows are persisted server-side, so reopening a session
 * restores its cards rather than bare prose.
 */
export function useSportQuery(initialSessionId?: string, forceNewSession = false) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)

  const abortRef = useRef<AbortController | null>(null)
  // Guards against a second send while one is in flight; state updates are
  // async, so `busy` alone can be read stale by a fast double-submit.
  const inFlight = useRef(false)
  // Session an ask() has already started against. A league-page ask bar sets
  // sessionId and calls ask() for a brand-new session almost simultaneously;
  // if the transcript fetch below (which for a fresh session returns []) wins
  // the race, it wipes out ask()'s just-appended turns and the answer never
  // renders live, even though it did stream and persist correctly.
  const askedForSession = useRef<string | null>(null)

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch {
      // A failed session list should not block the chat itself.
    }
  }, [])

  // Resolve a session on mount: the one named in the URL, the most recent, or
  // a fresh one — except when a league-page ask bar handed over a question,
  // where "most recent" would silently drop it into an unrelated
  // conversation instead of starting the new one the user asked for.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const existing = await listSessions()
        if (cancelled) return
        setSessions(existing)

        const target =
          initialSessionId ?? (forceNewSession ? null : existing[0]?.id) ?? (await createSession())
        if (cancelled) return
        setSessionId(target)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // forceNewSession is read once, at the mount that resolves the initial
    // session — same contract as initialSessionId — not on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId])

  // Load the transcript whenever the active session changes.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    loadMessages(sessionId)
      .then((rows) => {
        // ask() has already appended (and possibly finished streaming) a
        // turn for this session — that live state is more current than this
        // fetch, which may well have started before the question was asked.
        if (cancelled || askedForSession.current === sessionId) return
        const restored: Turn[] = rows.map((m) =>
          m.role === 'user'
            ? { id: m.id, role: 'user', text: m.content }
            : {
                id: m.id,
                role: 'assistant',
                text: m.content,
                query: '',
                rows: m.result_rows ?? [],
                shape: m.result_shape ?? 'generic',
                wideningNote: null,
                queryError: null,
                disambiguation: null,
                followUps: [],
                pending: false,
              }
        )
        // Attach each answer to the question above it, for the detail pane's
        // "FROM: …" context line.
        restored.forEach((t, i) => {
          const prev = restored[i - 1]
          if (t.role === 'assistant' && prev?.role === 'user') t.query = prev.text
        })
        setTurns(restored)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim()
      if (!question || !sessionId || inFlight.current) return

      askedForSession.current = sessionId
      inFlight.current = true
      setBusy(true)
      setError(null)

      const answerId = nextId()
      setTurns((t) => [
        ...t,
        { id: nextId(), role: 'user', text: question },
        {
          id: answerId,
          role: 'assistant',
          text: '',
          query: question,
          rows: [],
          shape: 'generic',
          wideningNote: null,
          queryError: null,
          disambiguation: null,
          followUps: [],
          pending: true,
        },
      ])

      const patch = (fields: Partial<AssistantTurn>) =>
        setTurns((t) =>
          t.map((turn) =>
            turn.id === answerId && turn.role === 'assistant' ? { ...turn, ...fields } : turn
          )
        )

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamMessage(
          sessionId,
          question,
          (event) => {
            switch (event.type) {
              case 'narrative':
                patch({ text: event.token })
                break
              case 'results':
                patch({
                  rows: event.rows,
                  shape: event.shape,
                  wideningNote: event.wideningNote,
                  queryError: event.queryError,
                  disambiguation: event.disambiguation,
                  followUps: event.followUps,
                })
                break
              case 'error':
                setError(event.error)
                patch({ queryError: event.error })
                break
              case 'done':
                break
            }
          },
          controller.signal
        )
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      } finally {
        patch({ pending: false })
        inFlight.current = false
        setBusy(false)
        abortRef.current = null
        void refreshSessions()
      }
    },
    [sessionId, refreshSessions]
  )

  const startSession = useCallback(async () => {
    try {
      const id = await createSession()
      setTurns([])
      setSessionId(id)
      await refreshSessions()
      return id
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [refreshSessions])

  const removeSession = useCallback(
    async (id: string) => {
      try {
        await deleteSession(id)
        const remaining = sessions.filter((s) => s.id !== id)
        setSessions(remaining)
        if (id === sessionId) {
          const next = remaining[0]?.id ?? (await createSession())
          setTurns([])
          setSessionId(next)
        }
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [sessions, sessionId]
  )

  // Drop an in-flight stream if the page unmounts mid-answer.
  useEffect(() => () => abortRef.current?.abort(), [])

  return {
    sessionId,
    sessions,
    turns,
    busy,
    booting,
    error,
    ask,
    startSession,
    selectSession: setSessionId,
    removeSession,
    dismissError: () => setError(null),
  }
}
