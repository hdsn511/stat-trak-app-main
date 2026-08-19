import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ChatPane from './ChatPane'
import DetailPane from './DetailPane'
import SessionBar from './SessionBar'
import { useSportQuery } from './useSportQuery'
import type { Selection } from './selection'

export default function SportQueryPage() {
  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  const {
    sessionId,
    sessions,
    turns,
    busy,
    booting,
    error,
    ask,
    startSession,
    selectSession,
    removeSession,
    dismissError,
  } = useSportQuery(routeSessionId)

  const [selection, setSelection] = useState<Selection | null>(null)

  // A query handed over from an ask bar on Home or a league page. The ref
  // guard stops StrictMode's double-effect from asking twice, and the history
  // entry is replaced so a refresh doesn't resend it.
  const autoAsked = useRef(false)
  useEffect(() => {
    if (booting || !sessionId || autoAsked.current) return
    const state = location.state as { query?: unknown } | null
    const q = typeof state?.query === 'string' ? state.query.trim() : ''
    if (!q) return
    autoAsked.current = true
    navigate(location.pathname, { replace: true, state: null })
    void ask(q)
  }, [booting, sessionId, location.state, location.pathname, ask, navigate])

  // Keep the URL pointing at the session being viewed.
  useEffect(() => {
    if (sessionId && sessionId !== routeSessionId) {
      navigate(`/sportquery/${sessionId}`, { replace: true })
    }
  }, [sessionId, routeSessionId, navigate])

  const switchSession = (id: string) => {
    setSelection(null)
    selectSession(id)
  }

  return (
    <div className="h-[calc(100vh-58px)] overflow-hidden flex flex-col">
      <SessionBar
        sessions={sessions}
        activeId={sessionId}
        onSelect={switchSession}
        onNew={() => {
          setSelection(null)
          void startSession()
        }}
        onDelete={(id) => {
          setSelection(null)
          void removeSession(id)
        }}
      />

      {error && (
        <div className="flex items-center gap-3 px-[28px] py-[9px] border-b border-[#3A2320] bg-[#241615] shrink-0">
          <span className="font-martian text-[10px] text-[#FF6B5C] tracking-[0.5px] flex-1 min-w-0">
            {error}
          </span>
          <button
            type="button"
            onClick={dismissError}
            className="font-martian text-[9px] text-[#9A918F] hover:text-[#EFEBE9] cursor-pointer shrink-0"
          >
            ✕ DISMISS
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {booting ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="font-martian text-[10px] text-[#665F5D] tracking-[1px]">
              STARTING SESSION…
            </span>
          </div>
        ) : (
          <>
            <ChatPane
              turns={turns}
              busy={busy}
              selection={selection}
              onAsk={(q) => void ask(q)}
              onSelect={setSelection}
            />
            {selection && (
              <DetailPane selection={selection} onClose={() => setSelection(null)} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
