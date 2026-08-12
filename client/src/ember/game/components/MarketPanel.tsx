import { Link } from 'react-router-dom'
import type { GamePick, GameProp, TeamRef } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import { playerPath } from '@/lib/paths'

interface MarketPanelProps {
  league: string
  props: GameProp[]
  picks: GamePick[]
  home: TeamRef
  away: TeamRef
}

const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#221D1A] border border-[#2C2624] rounded-md px-[12px] py-[8px]">
      <div className="font-martian text-[7px] text-[#665F5D] tracking-[1px]">{label}</div>
      <div className="font-martian font-bold text-[13px] text-[#EFEBE9] mt-[4px]">{value}</div>
    </div>
  )
}

function gameLineChips(props: GameProp[], home: TeamRef, away: TeamRef) {
  const chips: Array<{ label: string; value: string }> = []

  const spread = props.find((p) => p.prop_type === 'spread' && p.line != null)
  if (spread) {
    const team =
      spread.team_id === home.id
        ? home.abbreviation
        : spread.team_id === away.id
          ? away.abbreviation
          : null
    const line = spread.line as number
    const signed = `${line > 0 ? '+' : ''}${line}`
    chips.push({ label: 'SPREAD', value: team ? `${team} ${signed}` : signed })
  }

  const total = props.find((p) => p.prop_type === 'total' && p.line != null)
  if (total) chips.push({ label: 'TOTAL', value: `O/U ${total.line}` })

  const winner = props.find((p) => p.prop_type === 'winner' && p.implied_prob != null)
  if (winner) {
    const team =
      winner.team_id === home.id
        ? home.abbreviation
        : winner.team_id === away.id
          ? away.abbreviation
          : 'FAV'
    chips.push({ label: 'MONEYLINE', value: `${team} ${pct(winner.implied_prob)}` })
  }

  return chips
}

export default function MarketPanel({ league, props, picks, home, away }: MarketPanelProps) {
  const chips = gameLineChips(props, home, away)
  const playerProps = props
    .filter((p) => p.prop_type === 'player' && p.line != null)
    .slice(0, 10)

  if (chips.length === 0 && playerProps.length === 0 && picks.length === 0) return null

  return (
    <ModuleCard title="MARKET" meta="KALSHI LINES + SYSTEM PICKS">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 px-[18px] py-[14px] border-b border-[#221D1A]">
          {chips.map((c) => (
            <Chip key={c.label} {...c} />
          ))}
        </div>
      )}

      {playerProps.length > 0 && (
        <div>
          <div className="grid grid-cols-[1fr_60px_60px_66px] gap-2 px-[18px] py-2 border-b border-[#221D1A]">
            <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px]">
              PLAYER PROP
            </span>
            <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">
              STAT
            </span>
            <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">
              LINE
            </span>
            <span className="font-martian text-[8px] text-[#665F5D] tracking-[1px] text-right">
              IMPL
            </span>
          </div>
          {playerProps.map((p) => {
            const row = (
              <>
                <span className="font-schibsted font-bold text-[12px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                  {p.player_name ?? p.market_ticker}
                </span>
                <span className="font-martian text-[10px] text-[#9A918F] text-right uppercase">
                  {p.stat ?? '—'}
                </span>
                <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right tabular-nums">
                  {p.line}
                </span>
                <span className="font-martian text-[11px] text-[#FF6B3D] text-right tabular-nums">
                  {pct(p.implied_prob)}
                </span>
              </>
            )
            const cls =
              'grid grid-cols-[1fr_60px_60px_66px] gap-2 items-center px-[18px] py-[9px] border-t border-[#221D1A]'
            return p.entity_id ? (
              <Link
                key={p.market_ticker}
                to={playerPath(league, p.entity_id)}
                className={`${cls} hover:bg-[#211C1A]`}
              >
                {row}
              </Link>
            ) : (
              <div key={p.market_ticker} className={cls}>
                {row}
              </div>
            )
          })}
        </div>
      )}

      {picks.length > 0 && (
        <div className="border-t border-[#27221F]">
          <div className="px-[18px] py-[10px]">
            <span className="font-martian text-[8px] text-[#FF6B3D] tracking-[1.5px]">
              SYSTEM PICKS
            </span>
          </div>
          {picks.slice(0, 10).map((pick, i) => (
            <div
              key={`${pick.entity_id}-${pick.stat}-${i}`}
              className="grid grid-cols-[1fr_54px_60px_60px_50px] gap-2 items-center px-[18px] py-[9px] border-t border-[#221D1A]"
            >
              <span className="font-schibsted font-bold text-[12px] text-[#EFEBE9] whitespace-nowrap overflow-hidden text-ellipsis">
                {pick.player_name ?? `${pick.prop_type.toUpperCase()} PICK`}
              </span>
              <span className="font-martian text-[10px] text-[#9A918F] text-right uppercase">
                {pick.stat}
              </span>
              <span className="font-martian font-bold text-[12px] text-[#EFEBE9] text-right tabular-nums">
                {pick.recommended_line}
              </span>
              <span className="font-martian text-[11px] text-[#9A918F] text-right tabular-nums">
                {pct(pick.hit_rate)}
              </span>
              <span
                className={`font-martian font-bold text-[10px] text-right tracking-[1px] ${
                  pick.did_hit == null
                    ? 'text-[#665F5D]'
                    : pick.did_hit
                      ? 'text-[#4ADE80]'
                      : 'text-[#FF6B5C]'
                }`}
              >
                {pick.did_hit == null ? 'PEND' : pick.did_hit ? 'HIT' : 'MISS'}
              </span>
            </div>
          ))}
        </div>
      )}
    </ModuleCard>
  )
}
