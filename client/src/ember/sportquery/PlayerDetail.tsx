import Segmented from './Segmented'
import {
  DATES,
  OPPS,
  PLAYERS,
  STATLBL,
  avg,
  astArr,
  ord,
  pctl,
  rebArr,
  statVal,
  type Metric,
  type Period,
  type PlayerSel,
  type StatKey,
} from './data'

interface PlayerDetailProps {
  sel: PlayerSel
  onChange: (sel: PlayerSel) => void
}

const STAT_DEFS: readonly (readonly [string, StatKey])[] = [
  ['PTS', 'ppg'],
  ['REB', 'rpg'],
  ['AST', 'apg'],
  ['FG%', 'fg'],
  ['3P%', 'tp'],
  ['FT%', 'ft'],
]

const PERIODS: readonly (readonly [string, Period])[] = [
  ['SEASON', 'SEASON'],
  ['LAST 10', 'LAST 10'],
  ['LAST 5', 'LAST 5'],
]

const METRICS: readonly (readonly [string, Metric])[] = [
  ['PTS', 'pts'],
  ['3PM', '3pm'],
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

export default function PlayerDetail({ sel, onChange }: PlayerDetailProps) {
  const p = PLAYERS[sel.id]
  const period = sel.filter
  const rebs = rebArr(p)
  const asts = astArr(p)

  // game log series
  const series: Record<Metric, number[]> = { pts: p.l10p, '3pm': p.l10t, reb: rebs, ast: asts }
  const sAvg = { pts: p.ppg, '3pm': avg(p.l10t), reb: p.rpg, ast: p.apg }[sel.metric]
  const arr = series[sel.metric]
  const mx = Math.max(...arr)

  // scoring profile mix
  const t3 = 3 * avg(p.l10t)
  const ftp = +(p.ppg * (p.ft / 100) * 0.21).toFixed(1)
  const two = Math.max(0, p.ppg - t3 - ftp)
  const mix: [string, number, string][] = [
    ['2PT', two, '#EFE9E0'],
    ['3PT', t3, '#FF6B3D'],
    ['FT', ftp, '#665F5D'],
  ]
  const dlt = avg(p.l10p) - p.ppg

  const hh = (k: StatKey) => (k === sel.stat ? 'text-[#FF6B3D]' : 'text-[#665F5D]')
  const hc = (k: StatKey) => (k === sel.stat ? 'text-[#FF6B3D]' : 'text-[#EFEBE9]')

  return (
    <div className="px-[28px] pt-6 pb-11 relative overflow-hidden">
      <div className="absolute top-[-30px] right-1 font-chakra italic font-bold text-[170px] text-[rgba(239,235,233,0.04)] tracking-[-8px] pointer-events-none">
        #{p.num}
      </div>
      {/* Header */}
      <div className="flex items-end gap-4 relative flex-wrap">
        <div className="bg-[#EFE9E0] text-[#14100F] font-martian font-bold text-[20px] px-[13px] py-[11px] rounded-lg">
          #{p.num}
        </div>
        <div className="min-w-0">
          <div className="font-chakra italic font-bold text-[clamp(24px,3vw,34px)] tracking-[-1px] leading-none text-[#EFEBE9]">
            {p.n}
          </div>
          <div className="font-martian text-[10px] text-[#9A918F] mt-[7px] tracking-[0.5px]">
            {`${p.tn} · ${p.pos} · 2025–26 SEASON`.toUpperCase()}
          </div>
        </div>
        <div className="ml-auto shrink-0 font-martian font-medium text-[9px] text-[#FF6B3D] bg-[rgba(255,107,61,0.08)] border border-[rgba(255,107,61,0.5)] rounded-xl px-3 py-[5px] tracking-[0.5px]">
          {p.note}
        </div>
      </div>
      {/* Stat line */}
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-5 relative">
        <div className="flex items-center px-[18px] py-[13px] border-b border-[#27221F] gap-3 flex-wrap">
          <CardTitle>STAT LINE</CardTitle>
          <Segmented
            options={PERIODS}
            value={period}
            onChange={(f) => onChange({ ...sel, filter: f })}
            itemClass="px-3 tracking-[0.5px]"
          />
        </div>
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(104px,1fr))] gap-2 px-[18px] pt-[14px] pb-4">
          {STAT_DEFS.map(([k, key]) => {
            const hl = key === sel.stat
            const pc = pctl(key, p[key])
            return (
              <div
                key={key}
                className={`border rounded-lg pt-3 px-[13px] pb-[11px] ${hl ? 'bg-[#EFE9E0] border-[#EFE9E0]' : 'bg-[#221D1A] border-[#2E2724]'}`}
              >
                <div className={`font-martian text-[8px] tracking-[1px] ${hl ? 'text-[#504A44]' : 'text-[#665F5D]'}`}>{k}</div>
                <div className={`font-martian font-bold text-[20px] mt-[5px] ${hl ? 'text-[#14100F]' : 'text-[#EFEBE9]'}`}>
                  {statVal(p, key, period).toFixed(1)}
                </div>
                <div className={`h-[3px] rounded-[2px] overflow-hidden mt-2 ${hl ? 'bg-[#CDC3BB]' : 'bg-[#2C2624]'}`}>
                  <div className={`h-full ${hl ? 'bg-[#C2410C]' : 'bg-[#FF6B3D]'}`} style={{ width: `${pc}%` }} />
                </div>
                <div className={`font-martian text-[7px] mt-[5px] tracking-[0.5px] ${hl ? 'text-[#504A44]' : 'text-[#665F5D]'}`}>
                  {ord(pc)} PCTL{hl ? ' · FOCUS' : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))] gap-[14px] mt-[14px] relative">
        {/* Game log */}
        <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg">
          <div className="flex items-center px-[18px] py-[13px] border-b border-[#27221F] gap-3 flex-wrap">
            <CardTitle>GAME LOG — L10</CardTitle>
            <Segmented options={METRICS} value={sel.metric} onChange={(mk) => onChange({ ...sel, metric: mk })} itemClass="px-[11px]" />
          </div>
          <div className="relative px-[18px] pt-[14px] pb-3">
            <div
              className="absolute left-[18px] right-[18px] z-[1]"
              style={{ borderTop: '1px dashed rgba(239,233,224,0.45)', bottom: `${33 + Math.round((sAvg / mx) * 64)}px` }}
            >
              <span className="absolute right-0 top-[-14px] font-martian font-medium text-[7px] text-[#EFE9E0] tracking-[0.5px] bg-[#1B1715] px-[3px]">
                AVG {sAvg.toFixed(1)}
              </span>
            </div>
            <div className="flex items-stretch gap-2 h-[104px]">
              {arr.map((v, j) => (
                <div key={j} className="flex-1 flex flex-col items-center gap-1 justify-end min-w-0">
                  <span className={`font-martian font-medium text-[8px] ${v === mx ? 'text-[#FF6B3D]' : 'text-[#9A918F]'}`}>{v}</span>
                  <div
                    className="w-full max-w-[26px] rounded-t-[3px]"
                    style={{ height: `${Math.max(4, Math.round((v / mx) * 64))}px`, background: v === mx ? '#FF6B3D' : '#4A403C' }}
                  />
                  <span className="font-martian text-[7px] text-[#665F5D] overflow-hidden max-w-full">{OPPS[j]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Scoring profile */}
        <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg">
          <div className="flex items-baseline px-[18px] py-[13px] border-b border-[#27221F]">
            <CardTitle>SCORING PROFILE</CardTitle>
            <span className="ml-auto font-martian text-[8px] text-[#665F5D] tracking-[1px]">
              {p.ppg.toFixed(1)} PPG · SEASON
            </span>
          </div>
          <div className="pt-4 px-[18px] pb-[6px]">
            <div className="flex h-[14px] rounded overflow-hidden gap-[2px]">
              {mix.map(([k, v, c]) => (
                <div key={k} style={{ background: c, width: `${Math.round((v / p.ppg) * 100)}%` }} />
              ))}
            </div>
          </div>
          <div className="pt-2 px-[18px] pb-[14px]">
            {mix.map(([k, v, c]) => (
              <div key={k} className="grid grid-cols-[12px_74px_1fr_44px] gap-[10px] items-center py-[7px] border-b border-[#221D1A]">
                <span className="w-2 h-2 rounded-[2px]" style={{ background: c }} />
                <span className="font-martian text-[9px] text-[#9A918F] tracking-[0.5px]">{k}</span>
                <span className="font-martian font-bold text-[12px] text-[#EFEBE9]">
                  {v.toFixed(1)} <span className="font-martian font-normal text-[8px] text-[#665F5D]">PTS/G</span>
                </span>
                <span
                  className="font-martian font-medium text-[10px] text-right"
                  style={{ color: c === '#665F5D' ? '#9A918F' : c }}
                >
                  {Math.round((v / p.ppg) * 100)}%
                </span>
              </div>
            ))}
            <div className="flex gap-[18px] pt-3">
              {[
                ['L10 HIGH', String(Math.max(...p.l10p)), '#EFEBE9'],
                ['L10 LOW', String(Math.min(...p.l10p)), '#EFEBE9'],
                ['VS SEASON', (dlt >= 0 ? '+' : '') + dlt.toFixed(1), dlt >= 0 ? '#3FBF7F' : '#FF6B5C'],
              ].map(([k, v, c]) => (
                <div key={k}>
                  <div className="font-martian text-[7px] text-[#665F5D] tracking-[1px]">{k}</div>
                  <div className="font-martian font-bold text-[15px] mt-[3px]" style={{ color: c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Last 5 games */}
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px] overflow-hidden relative">
        <div className="flex items-baseline px-[18px] py-[13px] border-b border-[#27221F]">
          <CardTitle>LAST 5 GAMES</CardTitle>
          <span className="ml-auto font-martian text-[8px] text-[#FF6B3D] tracking-[1px]">
            FOCUS COLUMN: {STATLBL[sel.stat]}
          </span>
        </div>
        <div className="grid grid-cols-[58px_62px_1fr_46px_46px_46px_46px] gap-2 px-[18px] py-[9px] border-b border-[#27221F]">
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">DATE</span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">OPP</span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">RESULT</span>
          <span className={`font-martian text-[8px] tracking-[1px] text-right ${hh('ppg')}`}>PTS</span>
          <span className={`font-martian text-[8px] tracking-[1px] text-right ${hh('rpg')}`}>REB</span>
          <span className={`font-martian text-[8px] tracking-[1px] text-right ${hh('apg')}`}>AST</span>
          <span className={`font-martian text-[8px] tracking-[1px] text-right ${hh('tp')}`}>3PM</span>
        </div>
        {p.l10p.slice(5).map((pts, j) => {
          const win = (pts + j) % 3 !== 0
          const us = 104 + ((pts + j * 7) % 18)
          const them = win ? us - (3 + (pts % 7)) : us + (2 + ((j * 3) % 8))
          return (
            <div
              key={j}
              className="grid grid-cols-[58px_62px_1fr_46px_46px_46px_46px] gap-2 px-[18px] py-[9px] border-t border-[#221D1A] items-center hover:bg-[#211C1A]"
            >
              <span className="font-martian text-[10px] text-[#665F5D]">{DATES[j]}</span>
              <span className="font-schibsted font-bold text-[11px] text-[#EFEBE9]">{OPPS[5 + j]}</span>
              <span className={`font-martian font-medium text-[10px] ${win ? 'text-[#3FBF7F]' : 'text-[#FF6B5C]'}`}>
                {(win ? 'W ' : 'L ') + us + '–' + them}
              </span>
              <span className={`font-martian font-bold text-[12px] text-right ${hc('ppg')}`}>{pts}</span>
              <span className={`font-martian font-bold text-[12px] text-right ${hc('rpg')}`}>{rebs[5 + j]}</span>
              <span className={`font-martian font-bold text-[12px] text-right ${hc('apg')}`}>{asts[5 + j]}</span>
              <span className={`font-martian font-bold text-[12px] text-right ${hc('tp')}`}>{p.l10t[5 + j]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
