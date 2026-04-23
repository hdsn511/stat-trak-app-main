import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createSession,
  listSessions,
  type SessionSummary,
} from '../../services/sportqueryApi'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export function SessionSwitcher() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) {
      listSessions().then(setSessions).catch(() => setSessions([]))
    }
  }, [open])

  const newSession = async () => {
    const id = await createSession()
    navigate(`/sportquery/${id}`)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="text-[10px] font-condensed uppercase tracking-[0.2em] text-gray-500 hover:text-mint h-auto px-0 py-0"
        >
          Sessions ▾
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-72 bg-[#0D0D0D] border border-[#161616] rounded-xl animate-fade-up"
      >
        <DropdownMenuItem
          onSelect={newSession}
          className="font-sans text-sm text-mint hover:bg-[#141414] rounded-t-xl cursor-pointer"
        >
          + New conversation
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[#161616]" />
        <div className="max-h-72 overflow-y-auto">
          {sessions.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => {
                navigate(`/sportquery/${s.id}`)
                setOpen(false)
              }}
              className="font-sans text-sm text-gray-300 hover:bg-[#141414] truncate cursor-pointer"
            >
              {s.title ?? 'New conversation'}
            </DropdownMenuItem>
          ))}
          {sessions.length === 0 && (
            <div className="px-2 py-2 font-sans text-xs text-gray-600">
              No prior sessions.
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
