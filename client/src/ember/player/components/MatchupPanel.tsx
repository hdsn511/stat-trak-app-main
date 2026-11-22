import type { ReactNode } from 'react'
import type { StatDef } from '@/config/playerStats'
import type { HitRate, MatchupTarget, Signal, Split } from '../derive'
import type { GameRow } from '../types'

interface MatchupPanelProps {
  target: MatchupTarget | null
  /** Season vs this-opponent averages, one per single stat (no combos). */
  splits: Split[]
  signal: Signal | null
  h2h: GameRow[]
  /** Columns for the head-to-head log: volume stat + single stats. */
  defs: StatDef[]
  /** The stat and line in focus, for the hit/miss colouring. */
  activeDef?: StatDef
  line?: number
  h2hRate?: HitRate | null
}

const SMALL_SAMPLE = 3
const GOOD = '#3FBF7F'
const BAD = '#FF6B5C'

const BUCKET_COLOR: Record<Signal['bucket'], string> = {
  GREAT: GOOD,
  GOOD: GOOD,
  NEUTRAL: '#9A918F',
  TOUGH: BAD,
  BRUTAL: BAD,
}

const ord = (n: number): string => {
  const t = n % 10
  const h = n % 100
  if (t === 1 && h !== 11) return `${n}ST`
  if (t === 2 && h !== 12) return `${n}ND`
  if (t === 3 && h !== 13) return `${n}RD`
  return `${n}TH`
}

const f1 = (v: number | null) => (v == null ? '—' : v.toFixed(1))

function Title({ children }: { children: ReactNode }) {
  return (
    <span className="font-chakra italic font-bold text-[13px] tracking-[0.5px] text-[#EFEBE9]">
      <span className="text-[#FF6B3D]">{'//'}</span> {children}
    </span>
  )
}

/** A labelled fact in the summary strip: small caption, one bold value, optional context. */
function Fact({ caption, children, sub, tip }: { caption: string; children: ReactNode; sub?: ReactNode; tip?: string }) {
  return (
    <div className="min-w-0" title={tip}>
      <div className="font-martian text-[10px] text-[#A8A09C] tracking-[1px]">{caption}</div>
      <div className="font-martian font-bold text-[18px] text-[#EFEBE9] mt-[5px] tabular-nums leading-none">{children}</div>
      {sub && <div className="font-martian text-[11px] text-[#A8A09C] mt-[5px]">{sub}</div>}
    </div>
  )
}

// Shared cell classes so header, value and diff rows keep every stat in a fixed column.
const th = 'font-martian text-[11px] text-[#A8A09C] tracking-[1px] text-right px-[10px] py-[8px] whitespace-nowrap font-normal'
const rowHead = 'font-martian text-[11px] tracking-[1px] text-left px-[10px] py-[9px] whitespace-nowrap'
const td = 'font-martian text-[15px] tabular-nums text-right px-[10px] py-[9px] whitespace-nowrap'

/**
 * ESPN-style splits: one column per stat, rows for the season, this opponent,
 * and the difference. Reads across like a box score instead of hunting tiles.
 */
function SplitsTable({ splits, team, games, activeKey }: { splits: Split[]; team: string; games: number; activeKey?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#27221F]">
            <th className={`${rowHead} text-[#A8A09C] font-normal`}>SPLIT</th>
            {splits.map((s) => (
              <th key={s.key} className={`${th} ${s.key === activeKey ? 'text-[#FF6B3D]' : ''}`}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#221D1A]">
            <td className={`${rowHead} text-[#C9C2BE]`}>SEASON</td>
            {splits.map((s) => (
              <td key={s.key} className={`${td} text-[#C9C2BE]`}>{f1(s.season)}</td>
            ))}
          </tr>
          <tr className="border-b border-[#221D1A] bg-[#1F1A18]">
            <td className={`${rowHead} text-[#EFEBE9] font-bold`}>
              {`VS ${team}`} <span className="text-[#8A827E] font-normal">{`· ${games} GP`}</span>
            </td>
            {splits.map((s) => (
              <td key={s.key} className={`${td} font-bold text-[#EFEBE9]`}>{f1(s.versus)}</td>
            ))}
          </tr>
          <tr>
            <td className={`${rowHead} text-[#8A827E]`}>DIFF</td>
            {splits.map((s) => (
              <td
                key={s.key}
                className={`${td} text-[13px]`}
                style={{ color: s.delta == null ? '#665F5D' : s.delta > 0 ? GOOD : s.delta < 0 ? BAD : '#A8A09C' }}
              >
                {s.delta == null ? '—' : `${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(1)}`}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * Head-to-head game log, newest first, then the meeting average against the
 * season average. The focus stat's cell is green/red against the current line.
 */
function H2HTable({ games, defs, splits, activeDef, line }: {
  games: GameRow[]
  defs: StatDef[]
  splits: Split[]
  activeDef?: StatDef
  line?: number
}) {
  const fmt = (d: StatDef, v: number | null) => (v == null ? '—' : d.format ? d.format(v) : String(v))
  const split = (key: string) => splits.find((s) => s.key === key)
  // The focus stat may be a combo, which isn't a single-stat column: add it at the end.
  const cols = activeDef && !defs.some((d) => d.key === activeDef.key) ? [...defs, activeDef] : defs
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#27221F]">
            <th className={`${rowHead} text-[#A8A09C] font-normal`}>DATE</th>
            <th className={`${rowHead} text-[#A8A09C] font-normal`}>OPP</th>
            {cols.map((d) => (
              <th key={d.key} className={`${th} ${d.key === activeDef?.key ? 'text-[#FF6B3D]' : ''}`}>{d.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((g, i) => (
            <tr key={i} className="border-b border-[#221D1A] hover:bg-[#211C1A] transition-colors">
              <td className={`${rowHead} text-[#A8A09C]`}>{String(g.date ?? '')}</td>
              <td className={`${rowHead} font-schibsted font-bold text-[14px] text-[#EFEBE9] tracking-normal`}>
                {`${g.isHome === false ? '@' : 'vs '}${String(g.opponent ?? '—')}`}
              </td>
              {cols.map((d) => {
                const v = d.get(g)
                const hit =
                  d.key === activeDef?.key && line != null && v != null
                    ? v > line ? 'over' : v < line ? 'under' : 'push'
                    : null
                return (
                  <td
                    key={d.key}
                    className={`${td} ${hit ? 'font-bold' : 'text-[#EFEBE9]'}`}
                    style={
                      hit
                        ? {
                            color: hit === 'over' ? GOOD : hit === 'under' ? BAD : '#C9C2BE',
                            background: hit === 'over' ? 'rgba(63,191,127,0.10)' : hit === 'under' ? 'rgba(255,107,92,0.08)' : undefined,
                          }
                        : undefined
                    }
                    title={hit ? `${hit.toUpperCase()} ${line}` : undefined}
                  >
                    {fmt(d, v)}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr className="border-b border-[#221D1A] bg-[#1F1A18]">
            <td className={`${rowHead} text-[#EFEBE9] font-bold`} colSpan={2}>{`AVG · ${games.length} GP`}</td>
            {cols.map((d) => (
              <td key={d.key} className={`${td} font-bold text-[#EFEBE9]`}>{f1(split(d.key)?.versus ?? null)}</td>
            ))}
          </tr>
          <tr>
            <td className={`${rowHead} text-[#8A827E]`} colSpan={2}>SEASON</td>
            {cols.map((d) => (
              <td key={d.key} className={`${td} text-[#A8A09C]`}>{f1(split(d.key)?.season ?? null)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function MatchupPanel({ target, splits, signal, h2h, defs, activeDef, line, h2hRate }: MatchupPanelProps) {
  if (!target) {
    return (
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px] px-[18px] py-9 text-center">
        <div className="font-martian text-[12px] text-[#A8A09C] tracking-[1px]">
          SELECT AN OPPONENT TO SEE MATCHUP DETAIL
        </div>
        <div className="font-martian text-[10px] text-[#8A827E] tracking-[0.5px] mt-2">
          NO SCHEDULED GAME — USE THE VS FILTER ABOVE
        </div>
      </div>
    )
  }

  const u = target.upcoming
  const thin = h2h.length > 0 && h2h.length < SMALL_SAMPLE
  const decided = h2hRate ? h2hRate.over + h2hRate.under : 0
  // The splits table shows single stats only; the H2H log adds the focus combo itself.
  const singleSplits = splits.filter((s) => defs.some((d) => d.key === s.key))

  return (
    <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px]">
      <div className="flex items-center gap-3 px-[18px] py-[13px] border-b border-[#27221F] flex-wrap">
        {/* One template string, not several JSX children — a text matcher
            cannot match across sibling text nodes. */}
        <Title>{`${target.source === 'schedule' ? 'NEXT' : 'MATCHUP'}: ${u?.isHome === false ? '@' : 'VS'} ${target.team}`}</Title>
        {u && (
          <span className="font-martian text-[10px] text-[#C9C2BE] tracking-[1px]">
            {`${u.date} · ${u.isHome ? 'HOME' : 'AWAY'}${u.daysRest != null ? ` · ${u.daysRest}D REST` : ''}`}
          </span>
        )}
        {thin && (
          <span className="font-martian text-[10px] text-[#FFB020] tracking-[1px]">
            {`SMALL SAMPLE · ${h2h.length} GAME${h2h.length > 1 ? 'S' : ''}`}
          </span>
        )}
      </div>

      {/* What a bettor reads first: how the defense rates, how this line has
          done against them, and how many games that rests on. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 px-[18px] py-[14px] border-b border-[#221D1A]">
        {signal ? (
          <Fact
            caption={`${target.team} DEFENSE${signal.positionGroup ? ` VS ${signal.positionGroup}` : ''}`}
            sub={`${signal.allowed} ALLOWED PER GAME · AS OF ${signal.asOf}`}
            tip="League rank in this stat allowed; 1st allows the least"
          >
            <span>{`RANKS ${ord(signal.rank)}`}</span>{' '}
            <span
              className="font-martian font-bold text-[11px] tracking-[0.5px] px-[8px] py-[3px] rounded-xl border align-middle"
              style={{ color: BUCKET_COLOR[signal.bucket], borderColor: BUCKET_COLOR[signal.bucket] }}
            >
              {signal.bucket}
            </span>
          </Fact>
        ) : (
          <Fact caption={`${target.team} DEFENSE`} sub="NO DEFENSIVE SPLIT FOR THIS STAT">—</Fact>
        )}
        {activeDef && line != null && (
          <Fact
            caption={`${activeDef.label} ${line} VS ${target.team}`}
            sub={h2hRate?.pct != null ? `OVER ${h2hRate.pct}% OF MEETINGS` : 'NO DECIDED GAMES'}
            tip="Every meeting in the log, against the current line (over-under)"
          >
            <span style={{ color: h2hRate?.pct == null || decided < SMALL_SAMPLE ? '#EFEBE9' : h2hRate.pct >= 50 ? GOOD : BAD }}>
              {h2hRate ? `${h2hRate.over}-${h2hRate.under}` : '—'}
            </span>
          </Fact>
        )}
        <Fact caption="MEETINGS" sub="IN THE LOGGED SEASONS">{h2h.length}</Fact>
      </div>

      {/* Splits: season and versus side by side per stat, never blended. */}
      <div className="px-[8px] pt-[6px] pb-[10px]">
        <SplitsTable splits={singleSplits.length ? singleSplits : splits} team={target.team} games={h2h.length} activeKey={activeDef?.key} />
      </div>

      <div className="border-t border-[#27221F]">
        <div className="flex items-baseline px-[18px] py-[11px] gap-3">
          <Title>HEAD TO HEAD</Title>
          {h2h.length > 0 && activeDef && line != null && (
            <span className="ml-auto font-martian text-[10px] text-[#8A827E] tracking-[0.5px]">
              {`${activeDef.label} COLORED VS LINE ${line}`}
            </span>
          )}
        </div>
        {h2h.length === 0 ? (
          <div className="px-[18px] pb-8 text-center font-martian text-[12px] text-[#A8A09C] tracking-[1px]">
            NO MEETINGS THIS SEASON
          </div>
        ) : (
          <div className="px-[8px] pb-[12px]">
            <H2HTable games={h2h} defs={defs} splits={splits} activeDef={activeDef} line={line} />
          </div>
        )}
      </div>
    </div>
  )
}
