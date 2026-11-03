import type { Matchup } from '@/services/api'
import TeamLogo from './TeamLogo'

/**
 * The suggested Kalshi prop as a ticket: the rung large, the YES price under it in
 * cents, the way Kalshi quotes it. It is the one loud element in a row.
 */
export function PropTicket({ rung, label, price }: { rung: number | null | undefined; label: string; price?: number | null }) {
  if (rung == null) return <div className="w-[92px]" />
  return (
    <div className="w-[92px] rounded-md border border-[rgba(255,107,61,0.45)] bg-[rgba(255,107,61,0.07)] px-2 py-[7px] text-center">
      <div className="font-chakra italic font-bold text-[19px] leading-none text-[#FF6B3D] whitespace-nowrap">
        {rung}+ <span className="text-[13px]">{label}</span>
      </div>
      <div className="font-martian text-[11px] mt-[5px] tabular-nums text-[#EFEBE9] whitespace-nowrap">
        {price != null ? (
          `${Math.round(price * 100)}¢`
        ) : (
          <span className="text-[#8A827E] text-[10px]" title="Kalshi hasn't listed this line yet">
            no price yet
          </span>
        )}
      </div>
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
 * Season average and last-ten average as two points on one track, with the
 * suggested rung marked: how far he has moved, and where the line sits.
 */
export function AvgTrack({ season, recent, rung }: { season: number; recent: number; rung: number | null | undefined }) {
  const hi = Math.max(season, recent, rung ?? 0) * 1.15 || 1
  const at = (v: number) => `${(v / hi) * 100}%`
  const lo = Math.min(season, recent)
  const span = Math.abs(recent - season)
  return (
    <div className="w-[150px]" role="img" aria-label={`Season ${season}, last 10 ${recent}${rung != null ? `, line ${rung}` : ''}`}>
      <div className="relative h-[16px]">
        <div className="absolute top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 bg-[#2C2624]" />
        <div className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-[#FF6B3D]/50" style={{ left: at(lo), width: `${(span / hi) * 100}%` }} />
        {rung != null && (
          <div className="absolute top-0 bottom-0 w-[2px] bg-[#EFEBE9]/70" style={{ left: at(rung) }} title={`Line ${rung}`} />
        )}
        <div className="absolute top-1/2 w-[9px] h-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8A827E]" style={{ left: at(season) }} />
        <div className="absolute top-1/2 w-[11px] h-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FF6B3D]" style={{ left: at(recent) }} />
      </div>
      <div className="flex justify-between font-martian text-[10px] text-[#A8A09C] mt-[4px] tabular-nums whitespace-nowrap">
        <span>Season {season}</span>
        <span className="text-[#FF6B3D]">L10 {recent}</span>
      </div>
    </div>
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
