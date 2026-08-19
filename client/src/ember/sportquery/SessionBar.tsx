import type { SessionSummary } from '@/services/sportqueryApi'

interface SessionBarProps {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

const CHIP =
  'group flex items-center gap-2 shrink-0 rounded border px-[10px] py-[5px] font-martian text-[10px] whitespace-nowrap'

function title(s: SessionSummary): string {
  if (s.title) return s.title.length > 34 ? `${s.title.slice(0, 34)}…` : s.title
  return 'NEW SESSION'
}

export default function SessionBar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: SessionBarProps) {
  return (
    <div className="flex items-center gap-[10px] px-[28px] py-[9px] border-b border-[#221E1B] overflow-x-auto no-scrollbar shrink-0">
      <span className="font-martian font-medium text-[9px] text-[#665F5D] tracking-[1.5px] shrink-0">
        SESSIONS
      </span>

      <button
        type="button"
        onClick={onNew}
        className={`${CHIP} border-[#2C2624] text-[#FF6B3D] hover:border-[#FF6B3D] cursor-pointer`}
      >
        + NEW
      </button>

      {sessions.map((s) => {
        const active = s.id === activeId
        return (
          <div
            key={s.id}
            className={`${CHIP} ${
              active
                ? 'border-[#FF6B3D] bg-[#241C18] text-[#EFEBE9]'
                : 'border-[#2C2624] text-[#9A918F] hover:border-[#665F5D]'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className="cursor-pointer max-w-[220px] truncate text-left"
            >
              {title(s)}
            </button>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              aria-label={`Delete session ${title(s)}`}
              className="text-[#584F4C] hover:text-[#FF6B5C] cursor-pointer"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
