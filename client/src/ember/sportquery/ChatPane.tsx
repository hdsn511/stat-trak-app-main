import { useEffect, useRef } from 'react'
import AskBar from '@/ember/components/AskBar'
import QueryChips from '@/ember/components/QueryChips'
import ResultCards from './ResultCards'
import type { Selection } from './selection'
import type { AssistantTurn, Turn } from './useSportQuery'

const STARTER_CHIPS = [
  "Who's hot from three over the last 10 games?",
  'Top scorers against top-10 defenses',
  'Best assist-to-turnover ratios this season',
  'Which players are on the longest rebounding runs?',
]

interface ChatPaneProps {
  turns: Turn[]
  busy: boolean
  selection: Selection | null
  onAsk: (q: string) => void
  onSelect: (sel: Selection) => void
}

function AiLabel({ meta }: { meta?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-martian font-bold text-[10px] text-[#FF6B3D]">&gt;_</span>
      <span className="font-chakra italic font-bold text-[11px] tracking-[1.5px] text-[#665F5D]">
        SPORTQUERY
      </span>
      {meta && (
        <span className="font-martian text-[9px] text-[#443E3B] tracking-[0.5px]">{meta}</span>
      )}
    </div>
  )
}

function Typing() {
  return (
    <div className="flex gap-1 ml-1">
      {['0s', '0.2s', '0.4s'].map((d) => (
        <span
          key={d}
          className="w-[5px] h-[5px] rounded-full bg-[#FF6B3D] animate-tdot"
          style={{ animationDelay: d }}
        />
      ))}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'error'; children: string }) {
  const color = tone === 'error' ? '#FF6B5C' : '#FFB020'
  return (
    <div
      className="font-martian text-[10px] tracking-[0.5px] border rounded-md px-[12px] py-[8px]"
      style={{ color, borderColor: `${color}55`, background: `${color}12` }}
    >
      {children}
    </div>
  )
}

function AssistantBlock({
  turn,
  selection,
  onSelect,
  onAsk,
}: {
  turn: AssistantTurn
  selection: Selection | null
  onSelect: (s: Selection) => void
  onAsk: (q: string) => void
}) {
  const meta =
    turn.rows.length > 0
      ? `${turn.shape.replace(/_/g, ' ').toUpperCase()} · ${turn.rows.length} ROW${turn.rows.length === 1 ? '' : 'S'}`
      : undefined

  return (
    <div className="flex flex-col gap-3 animate-rise">
      <div className="flex items-center gap-2">
        <AiLabel meta={meta} />
        {turn.pending && <Typing />}
      </div>

      {turn.text && (
        <div className="font-schibsted text-[14px] leading-[1.6] text-[#D8D2CE] max-w-[620px] [text-wrap:pretty]">
          {turn.text}
        </div>
      )}

      {turn.wideningNote && <Notice tone="warn">{turn.wideningNote}</Notice>}
      {turn.queryError && <Notice tone="error">{turn.queryError}</Notice>}

      {turn.disambiguation && (
        <div className="flex flex-col gap-2">
          <div className="font-martian text-[10px] text-[#9A918F] tracking-[0.5px]">
            {turn.disambiguation.prompt}
          </div>
          <QueryChips
            chips={turn.disambiguation.candidates}
            onSelect={onAsk}
            variant="dark"
          />
        </div>
      )}

      <ResultCards
        rows={turn.rows}
        shape={turn.shape}
        query={turn.query}
        turnId={turn.id}
        selection={selection}
        onSelect={onSelect}
      />

      {turn.followUps.length > 0 && !turn.pending && (
        <div className="pt-1">
          <QueryChips chips={turn.followUps.slice(0, 3)} onSelect={onAsk} variant="dark" />
        </div>
      )}
    </div>
  )
}

export default function ChatPane({ turns, busy, selection, onAsk, onSelect }: ChatPaneProps) {
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  const innerMax = selection ? '100%' : '720px'

  return (
    <div
      className="flex flex-col min-h-0 min-w-0 shrink-0 max-w-full border-r border-[#221E1B]"
      style={{
        width: selection ? 'min(480px, 42%)' : '100%',
        transition: 'width 0.35s cubic-bezier(0.2, 0.7, 0.3, 1)',
      }}
    >
      <div ref={chatRef} className="flex-1 overflow-y-auto px-[28px] pt-[26px] pb-3">
        <div className="mx-auto flex flex-col gap-6" style={{ maxWidth: innerMax }}>
          <div className="pt-1 pb-[2px]">
            <div className="font-chakra italic font-bold text-[26px] tracking-[-0.5px] text-[#EFEBE9]">
              SPORT<span className="text-[#FF6B3D]">QUERY</span>
            </div>
            <div className="font-martian text-[10px] text-[#665F5D] tracking-[0.5px] mt-[5px]">
              NATURAL-LANGUAGE STATS · NBA BOX SCORES, TRENDS, LINES AND PICKS
            </div>
          </div>

          {turns.length === 0 && (
            <div className="font-schibsted text-[13px] text-[#9A918F] leading-[1.6] max-w-[560px]">
              Ask a question in plain English. SportQuery writes the SQL, runs it read-only
              against the stats database, and shows you the rows it found.
            </div>
          )}

          {turns.map((turn) =>
            turn.role === 'user' ? (
              <div key={turn.id} className="flex flex-col animate-rise">
                <div className="self-end max-w-[78%] bg-[#EFE9E0] text-[#14100F] rounded-[10px_10px_2px_10px] px-4 py-[10px] font-schibsted font-medium text-[14px] leading-[1.5]">
                  {turn.text}
                </div>
              </div>
            ) : (
              <AssistantBlock
                key={turn.id}
                turn={turn}
                selection={selection}
                onSelect={onSelect}
                onAsk={onAsk}
              />
            )
          )}

          <div className="h-[6px] shrink-0" />
        </div>
      </div>

      <div className="border-t border-[#221E1B] px-[28px] pt-[14px] pb-[18px] shrink-0">
        <div className="mx-auto" style={{ maxWidth: innerMax }}>
          {turns.length === 0 && (
            <div className="mb-3">
              <QueryChips chips={STARTER_CHIPS} onSelect={onAsk} variant="dark" />
            </div>
          )}
          <AskBar
            placeholder={
              busy ? 'thinking…' : 'ask across the league — players, teams, matchups…'
            }
            onSubmit={onAsk}
          />
        </div>
      </div>
    </div>
  )
}
