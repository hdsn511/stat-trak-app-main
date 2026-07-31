import Segmented from './Segmented'
import { GAMES, type GMetric, type GameSel } from './data'

interface GameDetailProps {
  sel: GameSel
  onChange: (sel: GameSel) => void
}

const GMETRICS: readonly (readonly [string, GMetric])[] = [
  ['PTS', 'pts'],
  ['REB', 'reb'],
  ['AST', 'ast'],
]

function CardTitle({ children }: { children: string }) {
  return (
    <span className="font-chakra italic font-bold text-[13px] tracking-[0.5px] text-[#EFEBE9]">
      <span className="text-[#FF6B3D]">{'//'}</span> {children}
    </span>
  )
}

export default function GameDetail({ sel, onChange }: GameDetailProps) {
  const g = GAMES[sel.id]

  // cumulative margin per quarter
  let ca = 0
  let cb = 0
  const margins = g.ls[0].map((v, i) => {
    const w = g.ls[1][i]
    if (v === null || w === null) return null
    ca += v
    cb += w
    return ca - cb
  })
  const mmax = Math.max(1, ...margins.filter((m): m is number => m !== null).map(Math.abs))

  // top performers
  const sorted = [...g.ldr].sort((x, y) => y[sel.gmetric] - x[sel.gmetric])
  const pmax = Math.max(...g.ldr.map((l) => l[sel.gmetric]))

  const facts: [string, string][] = [
    ['PACE', g.pace],
    ['LEAD CHANGES', String(g.lc)],
    ['LARGEST LEAD', g.ll],
    ['TIMES TIED', String(g.tt)],
  ]

  return (
    <div className="px-[28px] pt-5 pb-11">
      {/* Score header */}
      <div className="flex items-center justify-center gap-[clamp(10px,2.5vw,32px)] pt-[14px] pb-1 flex-wrap">
        <div className="text-right">
          <div className="font-chakra italic font-bold text-[clamp(20px,2.5vw,30px)] tracking-[-1px] text-[#EFEBE9]">{g.a}</div>
          <div className="font-martian text-[9px] text-[#665F5D] mt-[3px]">{g.an}</div>
        </div>
        <div className={`font-martian font-bold text-[clamp(28px,3.5vw,44px)] ${g.as >= g.bs ? 'text-[#EFEBE9]' : 'text-[#665F5D]'}`}>{g.as}</div>
        <div className="text-center min-w-[84px]">
          <div className="font-martian font-medium text-[10px] text-[#FF6B3D] tracking-[1px]">{g.live ? `● ${g.st}` : g.st}</div>
          <div className="font-martian text-[8px] text-[#665F5D] mt-1 tracking-[1px]">{g.venue}</div>
        </div>
        <div className={`font-martian font-bold text-[clamp(28px,3.5vw,44px)] ${g.bs >= g.as ? 'text-[#EFEBE9]' : 'text-[#665F5D]'}`}>{g.bs}</div>
        <div>
          <div className="font-chakra italic font-bold text-[clamp(20px,2.5vw,30px)] tracking-[-1px] text-[#EFEBE9]">{g.b}</div>
          <div className="font-martian text-[9px] text-[#665F5D] mt-[3px]">{g.bn}</div>
        </div>
      </div>
      {/* Facts strip */}
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))] gap-2 mt-4">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-[#1B1715] border border-[#2C2624] rounded-lg px-[14px] py-[11px]">
            <div className="font-martian text-[7px] text-[#665F5D] tracking-[1px]">{k}</div>
            <div className="font-martian font-bold text-[16px] text-[#EFEBE9] mt-[5px]">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))] gap-[14px] mt-[14px]">
        {/* Linescore + lead flow */}
        <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg overflow-hidden">
          <div className="flex items-baseline px-[18px] py-[13px] border-b border-[#27221F]">
            <CardTitle>LINESCORE + LEAD FLOW</CardTitle>
          </div>
          <div className="grid grid-cols-[54px_repeat(4,1fr)_52px] gap-[6px] px-[18px] py-[9px] border-b border-[#27221F]">
            <span />
            {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
              <span key={q} className="font-martian text-[8px] text-[#665F5D] text-center">{q}</span>
            ))}
            <span className="font-martian text-[8px] text-[#EFEBE9] text-right tracking-[1px]">TOT</span>
          </div>
          {([[g.a, g.ls[0], g.as, g.as >= g.bs], [g.b, g.ls[1], g.bs, g.bs >= g.as]] as const).map(([tm, q, tot, lead]) => (
            <div key={tm} className="grid grid-cols-[54px_repeat(4,1fr)_52px] gap-[6px] px-[18px] py-2 border-t border-[#221D1A] items-center">
              <span className="font-schibsted font-bold text-[12px] text-[#EFEBE9]">{tm}</span>
              {q.map((v, i) => (
                <span key={i} className="font-martian font-medium text-[12px] text-[#9A918F] text-center">{v === null ? '–' : v}</span>
              ))}
              <span className={`font-martian font-bold text-[13px] text-right ${lead ? 'text-[#EFEBE9]' : 'text-[#9A918F]'}`}>{tot}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-[18px] pt-3 pb-1 border-t border-[#27221F] mt-1">
            <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">MARGIN AFTER EACH Q</span>
            <span className="ml-auto flex items-center gap-[5px] font-martian text-[8px] text-[#9A918F]">
              <span className="w-2 h-2 rounded-[2px] bg-[#EFE9E0]" />{g.a}
            </span>
            <span className="flex items-center gap-[5px] font-martian text-[8px] text-[#9A918F]">
              <span className="w-2 h-2 rounded-[2px] bg-[#FF6B3D]" />{g.b}
            </span>
          </div>
          <div className="flex gap-[10px] px-[18px] pt-2 pb-4">
            {margins.map((m, i) => {
              const lbl = m === null ? `Q${i + 1} –` : m === 0 ? `Q${i + 1} TIE` : `Q${i + 1} ${m > 0 ? g.a : g.b} +${Math.abs(m)}`
              const lblC = m === null ? '#443E3B' : m === 0 ? '#9A918F' : m > 0 ? '#EFE9E0' : '#FF6B3D'
              return (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div className="h-[30px] flex items-end w-full justify-center">
                    <div
                      className="w-[60%] max-w-[34px] rounded-t-[3px] bg-[#EFE9E0]"
                      style={{ height: `${m !== null && m > 0 ? Math.max(3, Math.round((m / mmax) * 26)) : 0}px` }}
                    />
                  </div>
                  <div className="w-full border-t border-[#3A322E]" />
                  <div className="h-[30px] flex items-start w-full justify-center">
                    <div
                      className="w-[60%] max-w-[34px] rounded-b-[3px] bg-[#FF6B3D]"
                      style={{ height: `${m !== null && m < 0 ? Math.max(3, Math.round((-m / mmax) * 26)) : 0}px` }}
                    />
                  </div>
                  <span className="font-martian font-medium text-[8px] mt-1 whitespace-nowrap" style={{ color: lblC }}>{lbl}</span>
                </div>
              )
            })}
          </div>
        </div>
        {/* Team comparison */}
        <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg pb-2">
          <div className="flex items-baseline px-[18px] pt-[13px] pb-[10px]">
            <CardTitle>TEAM COMPARISON</CardTitle>
            <span className="ml-auto font-martian text-[8px] text-[#665F5D] tracking-[1px]">LEADER IN EMBER</span>
          </div>
          {Object.entries(g.stats).map(([k, [a, b]]) => {
            const aWin = k === 'TOV' ? a < b : a > b
            const statMax = Math.max(a, b)
            return (
              <div key={k} className="grid grid-cols-[1fr_58px_1fr] gap-3 items-center px-[18px] py-[9px]">
                <div className="flex items-center gap-[10px] justify-end min-w-0">
                  <span className={`font-martian font-bold text-[11px] shrink-0 ${aWin ? 'text-[#FF6B3D]' : 'text-[#9A918F]'}`}>{a}</span>
                  <div
                    className={`h-[6px] rounded-[3px] max-w-full shrink ${aWin ? 'bg-[#FF6B3D]' : 'bg-[#3A322E]'}`}
                    style={{ width: `${Math.round((a / statMax) * 100)}%` }}
                  />
                </div>
                <div className="text-center font-martian text-[9px] text-[#665F5D] tracking-[1px]">{k}</div>
                <div className="flex items-center gap-[10px] min-w-0">
                  <div
                    className={`h-[6px] rounded-[3px] max-w-full shrink ${!aWin ? 'bg-[#FF6B3D]' : 'bg-[#3A322E]'}`}
                    style={{ width: `${Math.round((b / statMax) * 100)}%` }}
                  />
                  <span className={`font-martian font-bold text-[11px] shrink-0 ${!aWin ? 'text-[#FF6B3D]' : 'text-[#9A918F]'}`}>{b}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {/* Top performers */}
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px] overflow-hidden">
        <div className="flex items-center px-[18px] py-[13px] border-b border-[#27221F] gap-3 flex-wrap">
          <CardTitle>TOP PERFORMERS</CardTitle>
          <Segmented options={GMETRICS} value={sel.gmetric} onChange={(mk) => onChange({ ...sel, gmetric: mk })} />
        </div>
        {sorted.map((l, i) => (
          <div
            key={l.n}
            className="grid grid-cols-[26px_40px_minmax(110px,1fr)_minmax(80px,1.2fr)_60px] gap-3 items-center px-[18px] py-[10px] border-t border-[#221D1A] hover:bg-[#211C1A]"
          >
            <span className="font-martian font-bold text-[12px] text-[#665F5D]">{String(i + 1).padStart(2, '0')}</span>
            <span className="font-martian font-bold text-[9px] bg-[#EFE9E0] text-[#14100F] rounded-[3px] px-[5px] py-[3px] text-center">{l.t}</span>
            <div className="min-w-0">
              <div className="font-schibsted font-bold text-[12px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">{l.n}</div>
              <div className="font-martian text-[8px] text-[#665F5D] mt-[2px]">
                {l.pts} PTS · {l.reb} REB · {l.ast} AST
              </div>
            </div>
            <div className="h-[6px] rounded-[3px] bg-[#2C2624] overflow-hidden">
              <div className="h-full bg-[#FF6B3D]" style={{ width: `${Math.round((l[sel.gmetric] / pmax) * 100)}%` }} />
            </div>
            <span className="font-martian font-bold text-[13px] text-[#FF6B3D] text-right">
              {l[sel.gmetric]} <span className="font-martian font-normal text-[8px] text-[#665F5D] uppercase">{sel.gmetric}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
