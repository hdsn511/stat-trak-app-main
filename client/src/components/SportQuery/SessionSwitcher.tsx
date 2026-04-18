import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createSession,
  listSessions,
  type SessionSummary,
} from '../../services/sportqueryApi'

export function SessionSwitcher() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    listSessions().then(setSessions).catch(() => setSessions([]))
  }, [open])

  const newSession = async () => {
    const id = await createSession()
    navigate(`/sportquery/${id}`)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500 hover:text-mint"
        onClick={() => setOpen((o) => !o)}
      >
        Sessions ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#0D0D0D] border border-[#161616] rounded-xl animate-fade-up z-10">
          <button
            className="w-full text-left px-4 py-2 font-sans text-sm text-mint hover:bg-[#141414] rounded-t-xl"
            onClick={newSession}
          >
            + New conversation
          </button>
          <div className="max-h-72 overflow-y-auto">
            {sessions.map((s) => (
              <button
                key={s.id}
                className="w-full text-left px-4 py-2 font-sans text-sm text-gray-300 hover:bg-[#141414] truncate"
                onClick={() => {
                  navigate(`/sportquery/${s.id}`)
                  setOpen(false)
                }}
              >
                {s.title ?? 'New conversation'}
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="px-4 py-2 font-sans text-xs text-gray-600">
                No prior sessions.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
