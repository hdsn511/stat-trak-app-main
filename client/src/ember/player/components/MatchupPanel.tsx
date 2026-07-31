import type { ReactNode } from 'react'
import type { StatDef } from '@/config/playerStats'
import type { MatchupTarget, Signal, Split } from '../derive'
import type { GameRow } from '../types'
import GameLogTable from './GameLogTable'

interface MatchupPanelProps {
  target: MatchupTarget | null
  splits: Split[]
  signal: Signal | null
  h2h: GameRow[]
  statDefs: StatDef[]
  volumeDef: StatDef | null
}

const SMALL_SAMPLE = 3

const BUCKET_COLOR: Record<Signal['bucket'], string> = {
  GREAT: '#3FBF7F',
  GOOD: '#3FBF7F',
  NEUTRAL: '#9A918F',
  TOUGH: '#FF6B5C',
  BRUTAL: '#FF6B5C',
}

const ord = (n: number): string => {
  const t = n % 10
  const h = n % 100
  if (t === 1 && h !== 11) return `${n}ST`
  if (t === 2 && h !== 12) return `${n}ND`
  if (t === 3 && h !== 13) return `${n}RD`
  return `${n}TH`
}

function Title({ children }: { children: ReactNode }) {
  return (
    <span className="font-chakra italic font-bold text-[13px] tracking-[0.5px] text-[#EFEBE9]">
      <span className="text-[#FF6B3D]">{'//'}</span> {children}
    </span>
  )
}

export default function MatchupPanel({
  target,
  splits,
  signal,
  h2h,
  statDefs,
  volumeDef,
}: MatchupPanelProps) {
  if (!target) {
    return (
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px] px-[18px] py-9 text-center">
        <div className="font-martian text-[10px] text-[#665F5D] tracking-[1px]">
          SELECT AN OPPONENT TO SEE MATCHUP DETAIL
        </div>
        <div className="font-martian text-[8px] text-[#4A403C] tracking-[0.5px] mt-2">
          NO SCHEDULED GAME — USE THE VS FILTER ABOVE
        </div>
      </div>
    )
  }

  const u = target.upcoming
  const thin = h2h.length > 0 && h2h.length < SMALL_SAMPLE

  return (
    <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px]">
      <div className="flex items-center gap-3 px-[18px] py-[13px] border-b border-[#27221F] flex-wrap">
        {/* One template string, not several JSX children — a text matcher
            cannot match across sibling text nodes. */}
        <Title>{`${target.source === 'schedule' ? 'NEXT' : 'MATCHUP'}: VS ${target.team}`}</Title>
        {u && (
          <span className="font-martian text-[8px] text-[#9A918F] tracking-[1px]">
            {`${u.date} · ${u.isHome ? 'HOME' : 'AWAY'}${
              u.daysRest != null ? ` · ${u.daysRest}D REST` : ''
            }`}
          </span>
        )}
        {signal && (
          <span
            className="ml-auto font-martian font-bold text-[9px] tracking-[0.5px] px-[11px] py-[5px] rounded-xl border"
            style={{
              color: BUCKET_COLOR[signal.bucket],
              borderColor: BUCKET_COLOR[signal.bucket],
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            {signal.bucket}
          </span>
        )}
      </div>

      {signal && (
        <div className="px-[18px] py-[10px] border-b border-[#221D1A] font-martian text-[9px] text-[#9A918F] tracking-[0.5px]">
          {`${target.team} RANKS ${ord(signal.rank)}${
            signal.positionGroup ? ` VS ${signal.positionGroup}` : ''
          } · ${signal.allowed} ALLOWED PER GAME`}
          <span className="text-[#4A403C]">{` · AS OF ${signal.asOf}`}</span>
        </div>
      )}

      {/* Splits: season and versus side by side, never blended. */}
      <div className="px-[18px] pt-[14px] pb-3">
        <div className="grid grid-cols-[1fr_72px_72px_64px] gap-2 pb-[6px] border-b border-[#27221F]">
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">STAT</span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">
            SEASON
          </span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">
            {`VS ${target.team}`}
          </span>
          <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">
            DIFF
          </span>
        </div>
        {splits.map((s) => (
          <div
            key={s.key}
            className="grid grid-cols-[1fr_72px_72px_64px] gap-2 py-[7px] border-b border-[#221D1A] items-center"
          >
            <span className="font-martian text-[9px] text-[#9A918F] tracking-[0.5px]">
              {s.label}
            </span>
            <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right">
              {s.season == null ? '—' : s.season.toFixed(1)}
            </span>
            <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right">
              {s.versus == null ? '—' : s.versus.toFixed(1)}
            </span>
            <span
              className="font-martian font-medium text-[11px] text-right"
              style={{ color: s.delta == null ? '#665F5D' : s.delta >= 0 ? '#3FBF7F' : '#FF6B5C' }}
            >
              {s.delta == null ? '—' : `${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(1)}`}
            </span>
          </div>
        ))}
      </div>

      {/* Head-to-head log */}
      <div className="border-t border-[#27221F]">
        <div className="flex items-baseline px-[18px] py-[11px] gap-3">
          <Title>HEAD TO HEAD</Title>
          {thin && (
            <span className="font-martian text-[8px] text-[#FF6B3D] tracking-[1px]">
              {`SMALL SAMPLE · ${h2h.length} GAME${h2h.length > 1 ? 'S' : ''}`}
            </span>
          )}
        </div>
        {h2h.length === 0 ? (
          <div className="px-[18px] pb-8 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
            NO MEETINGS THIS SEASON
          </div>
        ) : (
          <GameLogTable games={h2h} statDefs={statDefs} volumeDef={volumeDef} activeStat="" />
        )}
      </div>
    </div>
  )
}
