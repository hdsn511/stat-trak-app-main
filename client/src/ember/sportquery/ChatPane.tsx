import { useEffect, useRef } from 'react'
import AskBar from '@/ember/components/AskBar'
import QueryChips from '@/ember/components/QueryChips'
import {
  CHIP_QS,
  GAMES,
  INTENTS,
  PLAYERS,
  type AiMsg,
  type GameIntent,
  type Msg,
  type PlayerIntent,
  type Selection,
} from './data'

interface ChatPaneProps {
  messages: Msg[]
  typing: boolean
  sel: Selection | null
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

function PlayerCards({ it, m, i, sel, onSelect }: { it: PlayerIntent; m: AiMsg; i: number; sel: Selection | null; onSelect: (s: Selection) => void }) {
  return (
    <>
      {it.ids.map((id, ix) => {
        const p = PLAYERS[id]
        const on = sel?.type === 'player' && sel.id === id && sel.msg === i
        const arr = it.stat === 'tp' ? p.l10t : p.l10p
        const mx = Math.max(...arr)
        return (
          <div
            key={id}
            onClick={() =>
              onSelect({
                type: 'player',
                id,
                msg: i,
                query: m.query,
                stat: it.stat,
                filter: it.filter,
                metric: it.stat === 'tp' ? '3pm' : it.stat === 'rpg' ? 'reb' : it.stat === 'apg' ? 'ast' : 'pts',
              })
            }
            className={`grid grid-cols-[30px_1fr_84px_88px_14px] gap-[14px] items-center border rounded-lg px-4 py-3 cursor-pointer hover:border-[#FF6B3D] ${
              on ? 'bg-[#241C18] border-[#FF6B3D]' : 'bg-[#1B1715] border-[#2C2624]'
            }`}
          >
            <span className="font-martian font-bold text-[14px] text-[#665F5D]">
              {String(ix + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                {p.n}
              </div>
              <div className="font-martian text-[9px] text-[#9A918F] mt-[3px]">
                {p.tm} · {p.pos} · #{p.num}
              </div>
            </div>
            <div className="flex items-end gap-[2px] h-[26px]">
              {arr.map((v, j) => (
                <div
                  key={j}
                  className="w-[6px] rounded-[1px]"
                  style={{
                    height: `${Math.max(3, Math.round((v / mx) * 24))}px`,
                    background: v === mx ? '#FF6B3D' : '#4A403C',
                  }}
                />
              ))}
            </div>
            <div className="text-right">
              <div className="font-martian font-bold text-[17px] text-[#FF6B3D]">{it.big(p)}</div>
              <div className="font-martian text-[8px] text-[#665F5D] tracking-[0.5px] mt-[2px]">
                {it.lbl}
              </div>
            </div>
            <span className="font-martian font-bold text-[12px] text-[#665F5D]">→</span>
          </div>
        )
      })}
    </>
  )
}

function GameCards({ it, m, i, sel, onSelect }: { it: GameIntent; m: AiMsg; i: number; sel: Selection | null; onSelect: (s: Selection) => void }) {
  return (
    <>
      {it.ids.map((id) => {
        const g = GAMES[id]
        const on = sel?.type === 'game' && sel.id === id && sel.msg === i
        return (
          <div
            key={id}
            onClick={() => onSelect({ type: 'game', id, msg: i, query: m.query, gmetric: 'pts' })}
            className={`flex items-center gap-[14px] border rounded-lg px-4 py-[13px] cursor-pointer hover:border-[#FF6B3D] ${
              on ? 'bg-[#241C18] border-[#FF6B3D]' : 'bg-[#1B1715] border-[#2C2624]'
            }`}
          >
            <span
              className="w-[7px] h-[7px] rounded-full shrink-0"
              style={{
                background: g.live ? '#FF6B3D' : '#443E3B',
                boxShadow: g.live ? '0 0 8px rgba(255,107,61,0.8)' : 'none',
              }}
            />
            <div className="flex items-baseline gap-[9px] shrink-0">
              <span className="font-schibsted font-bold text-[14px] text-[#EFEBE9]">{g.a}</span>
              <span className={`font-martian font-bold text-[16px] ${g.as >= g.bs ? 'text-[#EFEBE9]' : 'text-[#9A918F]'}`}>{g.as}</span>
              <span className="font-martian text-[10px] text-[#665F5D]">—</span>
              <span className={`font-martian font-bold text-[16px] ${g.bs >= g.as ? 'text-[#EFEBE9]' : 'text-[#9A918F]'}`}>{g.bs}</span>
              <span className="font-schibsted font-bold text-[14px] text-[#EFEBE9]">{g.b}</span>
            </div>
            <span className={`font-martian font-medium text-[9px] tracking-[0.5px] shrink-0 ${g.live ? 'text-[#FF6B3D]' : 'text-[#665F5D]'}`}>
              {g.st}
            </span>
            <span className="ml-auto font-schibsted text-[11px] text-[#9A918F] whitespace-nowrap overflow-hidden text-ellipsis">
              {g.note}
            </span>
            <span className="font-martian font-bold text-[12px] text-[#665F5D]">→</span>
          </div>
        )
      })}
    </>
  )
}

export default function ChatPane({ messages, typing, sel, onAsk, onSelect }: ChatPaneProps) {
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, typing])

  const innerMax = sel ? '100%' : '720px'

  return (
    <div
      className="flex flex-col min-h-0 min-w-0 shrink-0 max-w-full border-r border-[#221E1B]"
      style={{ width: sel ? 'min(480px, 42%)' : '100%', transition: 'width 0.35s cubic-bezier(0.2, 0.7, 0.3, 1)' }}
    >
      <div ref={chatRef} className="flex-1 overflow-y-auto px-[28px] pt-[26px] pb-3">
        <div className="mx-auto flex flex-col gap-6" style={{ maxWidth: innerMax }}>
          <div className="pt-1 pb-[2px]">
            <div className="font-chakra italic font-bold text-[26px] tracking-[-0.5px] text-[#EFEBE9]">
              SPORT<span className="text-[#FF6B3D]">QUERY</span>
            </div>
            <div className="font-martian text-[10px] text-[#665F5D] tracking-[0.5px] mt-[5px]">
              NATURAL-LANGUAGE STATS · ASK ACROSS EVERY BOX SCORE
            </div>
          </div>
          {messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="flex flex-col animate-rise">
                  <div className="self-end max-w-[78%] bg-[#EFE9E0] text-[#14100F] rounded-[10px_10px_2px_10px] px-4 py-[10px] font-schibsted font-medium text-[14px] leading-[1.5]">
                    {m.text}
                  </div>
                </div>
              )
            }
            const it = INTENTS[m.intent]
            return (
              <div key={i} className="flex flex-col gap-3 animate-rise">
                <AiLabel meta={`${it.label} · TOP ${it.ids.length}`} />
                <div className="font-schibsted text-[14px] leading-[1.6] text-[#D8D2CE] max-w-[620px] [text-wrap:pretty]">
                  {m.text}
                </div>
                <div className="flex flex-col gap-2">
                  {it.kind === 'game' ? (
                    <GameCards it={it} m={m} i={i} sel={sel} onSelect={onSelect} />
                  ) : (
                    <PlayerCards it={it} m={m} i={i} sel={sel} onSelect={onSelect} />
                  )}
                </div>
              </div>
            )
          })}
          {typing && (
            <div className="flex items-center gap-2">
              <AiLabel />
              <div className="flex gap-1 ml-1">
                {['0s', '0.2s', '0.4s'].map((d) => (
                  <span
                    key={d}
                    className="w-[5px] h-[5px] rounded-full bg-[#FF6B3D] animate-tdot"
                    style={{ animationDelay: d }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="h-[6px] shrink-0" />
        </div>
      </div>
      <div className="border-t border-[#221E1B] px-[28px] pt-[14px] pb-[18px] shrink-0">
        <div className="mx-auto" style={{ maxWidth: innerMax }}>
          <div className="mb-3">
            <QueryChips chips={CHIP_QS} onSelect={onAsk} variant="dark" />
          </div>
          <AskBar placeholder="ask across the league — players, teams, matchups…" onSubmit={onAsk} />
        </div>
      </div>
    </div>
  )
}
