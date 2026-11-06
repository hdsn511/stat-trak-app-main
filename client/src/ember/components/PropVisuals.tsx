import type { Matchup } from '@/services/api'
import TeamLogo from './TeamLogo'

/**
 * The suggested Kalshi prop as a ticket: the rung large, the YES price under it in
 * cents, the way Kalshi quotes it. It is the one loud element in a row. Pass
 * `price={undefined}` (omit it) to show the line alone, without a price row.
 */
export function PropTicket({ rung, label, price }: { rung: number | null | undefined; label: string; price?: number | null }) {
  if (rung == null) {
    // No Kalshi rung for this stat: still say which stat the row is about.
    return (
      <div className="w-[112px] rounded-md border border-[#3A3330] px-2 py-[7px] text-center font-chakra italic font-bold text-[14px] text-[#EFEBE9]">
        {label}
      </div>
    )
  }
  return (
    <div className="w-[112px] rounded-md border border-[rgba(255,107,61,0.45)] bg-[rgba(255,107,61,0.07)] px-2 py-[7px] text-center">
      <div className="font-chakra italic font-bold text-[19px] leading-none text-[#FF6B3D] whitespace-nowrap">
        {rung}+ <span className="text-[13px]">{label}</span>
      </div>
      {price !== undefined && (
        <div className="font-martian text-[11px] mt-[5px] tabular-nums text-[#EFEBE9] whitespace-nowrap">
          {price != null ? (
            `${Math.round(price * 100)}¢`
          ) : (
            <span className="text-[#8A827E] text-[10px]" title="Kalshi hasn't listed this line yet">
              no price yet
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Last ten games as bars against the rung: cleared in ember, missed in grey, the
 * line drawn across. Reads as "how often does he clear it" at a glance.
 */
export function ClearStrip({ values, rung }: { values: number[]; rung: number }) {
  const max = Math.max(rung * 1.6, ...values, 1)
  const lineAt = (rung / max) * 100
  const cleared = values.filter((v) => v >= rung).length
  return (
    <div
      className="relative h-[34px] w-[150px] flex items-end gap-[3px]"
      role="img"
      aria-label={`Cleared ${rung} in ${cleared} of the last ${values.length} games`}
    >
      {values.map((v, i) => (
        <div
          key={i}
          title={String(v)}
          className={`flex-1 rounded-t-[2px] ${v >= rung ? 'bg-[#FF6B3D]' : 'bg-[#4A4340]'}`}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
      <div className="absolute left-0 right-0 border-t border-dashed border-[#EFEBE9]/70" style={{ bottom: `${lineAt}%` }} />
    </div>
  )
}

/**
 * Season vs recent as two bars on one zero-based scale, with the change spelled
 * out: the reader sees which is bigger, by how much (+11.4) and how much that is
 * (+41%), green when up and red when down. The suggested line is a tick on the
 * same scale, so "is the recent level over the line" reads directly.
 */
export function TrendBars({ season, recent, window = 10, rung }: {
  season: number
  recent: number
  window?: number
  rung?: number | null
}) {
  const hi = Math.max(season, recent, rung ?? 0) * 1.1 || 1
  const w = (v: number) => `${Math.max(0, (v / hi) * 100)}%`
  const diff = Math.round((recent - season) * 10) / 10
  const pct = season > 0 ? Math.round(((recent - season) / season) * 100) : null
  const up = diff >= 0
  const tone = up ? '#3FBF7F' : '#FF6B5C'
  const bar = (label: string, v: number, color: string, strong: boolean) => (
    <div className="grid grid-cols-[34px_1fr_38px] items-center gap-[6px]">
      <span className={`font-martian text-[10px] tracking-[0.5px] ${strong ? 'text-[#EFEBE9]' : 'text-[#8A827E]'}`}>{label}</span>
      <div className="relative h-[8px] rounded-[2px] bg-[#2C2624]">
        <div className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: w(v), background: color }} />
        {rung != null && (
          <div className="absolute -top-[2px] -bottom-[2px] w-[2px] bg-[#EFEBE9]" style={{ left: w(rung) }} />
        )}
      </div>
      <span className={`font-martian text-[12px] tabular-nums text-right ${strong ? 'font-bold text-[#EFEBE9]' : 'text-[#A8A09C]'}`}>{v}</span>
    </div>
  )
  return (
    <div
      className="w-[170px] flex flex-col gap-[5px]"
      role="img"
      aria-label={`Season ${season}, last ${window} ${recent}, ${up ? 'up' : 'down'} ${Math.abs(diff)}${pct != null ? ` (${pct}%)` : ''}${rung != null ? `, line ${rung}` : ''}`}
    >
      {bar('SZN', season, '#665F5D', false)}
      {bar(`L${window}`, recent, tone, true)}
      <div className="flex items-center justify-end gap-[6px] font-martian text-[11px] tabular-nums">
        {rung != null && <span className="mr-auto text-[10px] text-[#A8A09C]">│ line {rung}</span>}
        <span className="font-bold rounded-[3px] px-[6px] py-[1px]" style={{ color: tone, background: up ? 'rgba(63,191,127,0.12)' : 'rgba(255,107,92,0.12)' }}>
          {up ? '▲' : '▼'} {up ? '+' : ''}{diff}
          {pct != null && <span className="font-normal"> ({up ? '+' : ''}{pct}%)</span>}
        </span>
      </div>
    </div>
  )
}

/** The stat a row is about, as a small labelled tag next to the name. */
export function StatTag({ label }: { label: string }) {
  return (
    <span className="font-martian font-bold text-[10px] tracking-[0.5px] text-[#14100F] bg-[#EFEBE9] rounded-[3px] px-[5px] py-[1px] whitespace-nowrap">
      {label}
    </span>
  )
}

/** "vs DET · allows +7% PTS": the opponent and what it gives up in this stat. */
export function MatchupNote({ league, opponent, matchup, label }: {
  league: string
  opponent: string | null | undefined
  matchup: Matchup | null | undefined
  label: string
}) {
  if (!opponent) return null
  const pct = matchup ? Math.round((matchup.factor - 1) * 100) : null
  const tone = pct == null ? 'text-[#A8A09C]' : pct >= 3 ? 'text-[#3FBF7F]' : pct <= -3 ? 'text-[#FF6B5C]' : 'text-[#A8A09C]'
  return (
    <span className="inline-flex items-center gap-[5px] font-martian text-[11px] text-[#A8A09C]">
      vs <TeamLogo league={league} abbr={opponent} size={13} /> {opponent}
      {pct != null && (
        <span className={tone}>
          allows {pct > 0 ? '+' : ''}
          {pct}% {label}
        </span>
      )}
    </span>
  )
}

/** Yesterday's result for this player's suggestion, or nothing. */
export function ResultMark({ hit, actual }: { hit: boolean | null | undefined; actual?: number }) {
  if (hit == null) return <span className="w-[30px]" />
  return (
    <span
      title={actual != null ? `Yesterday: ${actual}` : undefined}
      className={`w-[30px] text-center font-martian font-bold text-[11px] rounded-[3px] py-[3px] ${
        hit ? 'text-[#3FBF7F] bg-[rgba(63,191,127,0.12)]' : 'text-[#FF6B5C] bg-[rgba(255,107,92,0.12)]'
      }`}
    >
      {hit ? 'W' : 'L'}
    </span>
  )
}
