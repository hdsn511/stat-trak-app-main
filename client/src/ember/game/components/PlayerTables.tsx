import { Link } from 'react-router-dom'
import type { GameInsightStreak, GameInsightTrend, GameInsights } from '@/services/api'
import ModuleCard from '@/ember/components/ModuleCard'
import PlayerAvatar from '@/ember/components/PlayerAvatar'
import TeamLogo from '@/ember/components/TeamLogo'
import { EmptyState } from '@/ember/components/EntityState'
import { playerPath } from '@/lib/paths'
import { teamAccent } from '@/lib/teamBrand'
import { HitStrip, MatchupCell, Th } from './insightUi'
import { BAD, EMBER, GOOD, cents } from './insightTones'

function PlayerCell({ league, name, team, extId, position }: {
  league: string
  name: string
  team: string
  extId: string | null
  position: string | null
}) {
  return (
    <div className="flex items-center gap-[10px] min-w-0">
      <PlayerAvatar league={league} extId={extId} name={name} accent={teamAccent(league, team)} size={30} />
      <div className="min-w-0">
        <div className="font-schibsted font-bold text-[14px] text-[#EFEBE9] truncate flex items-center gap-[6px]">
          <TeamLogo league={league} abbr={team} size={14} />
          <span className="truncate">{name}</span>
        </div>
        <div className="font-martian text-[10px] text-[#8A827E] mt-[1px]">{[team, position].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  )
}

/** Rung + price, the bettable line. Green-bordered when Kalshi lists it for this game. */
function Rung({ rung, label, price, listed }: { rung: number | null; label: string; price: number | null; listed: boolean }) {
  if (rung == null) return <span className="font-martian text-[11px] text-[#665F5D]">—</span>
  return (
    <span
      className="inline-flex flex-col items-center rounded-md border px-2 py-[4px] min-w-[74px]"
      style={{ borderColor: listed ? `${EMBER}88` : '#2C2624', background: listed ? `${EMBER}12` : 'transparent' }}
      title={listed ? 'Listed on Kalshi for this game' : 'Not listed for this game yet; nearest standard rung'}
    >
      <span className="font-chakra italic font-bold text-[15px] leading-none whitespace-nowrap" style={{ color: listed ? EMBER : '#C9C2BE' }}>
        {rung}+ <span className="text-[11px]">{label}</span>
      </span>
      <span className="font-martian text-[10px] mt-[3px] tabular-nums text-[#A8A09C] whitespace-nowrap">
        {cents(price) ?? 'not listed'}
      </span>
    </span>
  )
}

const opp = (insights: GameInsights, team: string) => (team === insights.away.abbr ? insights.home.abbr : insights.away.abbr)

/** Merge the two teams' rows, keeping away rows first within equal rank so the order is stable. */
function both<T>(insights: GameInsights, pick: (t: GameInsights['away']) => T[]): T[] {
  const a = pick(insights.away)
  const h = pick(insights.home)
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, h.length); i++) {
    if (a[i]) out.push(a[i]!)
    if (h[i]) out.push(h[i]!)
  }
  return out
}

const STREAK_COLS = 'grid-cols-[minmax(180px,280px)_110px_70px_130px_64px_minmax(110px,1fr)]'

export function StreaksTable({ league, insights }: { league: string; insights: GameInsights }) {
  const rows = both<GameInsightStreak>(insights, (t) => t.streaks)
  return (
    <ModuleCard title="STREAKS" meta="CONSECUTIVE GAMES OVER A KALSHI RUNG · OUT PLAYERS REMOVED">
      {rows.length === 0 ? (
        <EmptyState compact label="NO ACTIVE STREAKS AT A KALSHI RUNG FOR EITHER TEAM" />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className={`grid ${STREAK_COLS} gap-3 px-[18px] py-2`}>
              <Th>PLAYER</Th>
              <Th align="center">LINE</Th>
              <Th align="center">RUN</Th>
              <Th>LAST {Math.max(...rows.map((r) => r.last10.length))}</Th>
              <Th align="right">L10 AVG</Th>
              <Th>VS DEFENSE</Th>
            </div>
            {rows.map((s) => (
              <Link
                key={`${s.player_id}:${s.stat}`}
                to={playerPath(league, s.player_id)}
                className={`grid ${STREAK_COLS} gap-3 items-center px-[18px] py-[8px] border-t border-[#221D1A] hover:bg-[#211C1A]`}
                style={{ boxShadow: `inset 3px 0 0 ${teamAccent(league, s.team)}` }}
              >
                <PlayerCell league={league} name={s.name} team={s.team} extId={s.ext_id} position={s.position} />
                <span className="flex justify-center">
                  <Rung rung={s.rung} label={s.stat_label} price={s.price} listed={s.listed} />
                </span>
                <span className="text-center font-martian font-bold text-[15px] tabular-nums" style={{ color: GOOD }}>
                  {s.depth}
                  <span className="text-[11px] text-[#8A827E] font-normal" title={`${s.depth} straight, from the last ${s.games} games`}> straight</span>
                </span>
                <HitStrip values={s.last10} rung={s.rung} width={124} />
                <span className="text-right font-martian text-[13px] text-[#EFEBE9] tabular-nums">{s.l10_avg}</span>
                <MatchupCell league={league} opponent={opp(insights, s.team)} matchup={s.matchup} label={s.stat_label} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </ModuleCard>
  )
}

const TREND_COLS = 'grid-cols-[minmax(180px,280px)_70px_170px_90px_110px_minmax(110px,1fr)]'

function Delta({ t }: { t: GameInsightTrend }) {
  const season = t.season_avg
  const up = t.z >= 0
  const color = up ? GOOD : BAD
  const pctChange = season && season > 0 ? Math.round(((t.recent_avg - season) / season) * 100) : null
  return (
    <span className="inline-flex items-center gap-2 font-martian text-[12px] tabular-nums whitespace-nowrap">
      <span className="text-[#8A827E]">{season ?? '—'}</span>
      <span style={{ color }}>{up ? '▲' : '▼'}</span>
      <span className="font-bold text-[14px]" style={{ color }}>{t.recent_avg}</span>
      {pctChange != null && (
        <span className="text-[10px]" style={{ color }}>
          {pctChange > 0 ? '+' : ''}
          {pctChange}%
        </span>
      )}
    </span>
  )
}

/** z-score as a centred bar: right/green for hot, left/red for cold. */
function ZBar({ z }: { z: number }) {
  const w = Math.min(Math.abs(z) / 2, 1) * 50
  const color = z >= 0 ? GOOD : BAD
  return (
    <span className="flex items-center gap-2" title={`Trend z-score ${z}`}>
      <span className="relative h-[6px] w-[44px] bg-[#221D1A] rounded-full overflow-hidden">
        <span className="absolute top-0 bottom-0 left-1/2 w-px bg-[#4A4340]" />
        <span
          className="absolute top-0 bottom-0 rounded-full"
          style={{ background: color, width: `${w}%`, left: z >= 0 ? '50%' : `${50 - w}%` }}
        />
      </span>
      <span className="font-martian text-[11px] tabular-nums" style={{ color }}>
        {z > 0 ? '+' : ''}
        {z.toFixed(2)}
      </span>
    </span>
  )
}

export function TrendsTable({ league, insights }: { league: string; insights: GameInsights }) {
  const rows = both<GameInsightTrend>(insights, (t) => t.trends)
  return (
    <ModuleCard title="TRENDS" meta="RECENT FORM VS SEASON · ▲ HOT / ▼ COLD">
      {rows.length === 0 ? (
        <EmptyState compact label="NO TREND ROWS FOR EITHER ROSTER" />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[660px]">
            <div className={`grid ${TREND_COLS} gap-3 px-[18px] py-2`}>
              <Th>PLAYER</Th>
              <Th>STAT</Th>
              <Th>SEASON → RECENT</Th>
              <Th>Z</Th>
              <Th align="center">NEAR LINE</Th>
              <Th>VS DEFENSE</Th>
            </div>
            {rows.map((t) => (
              <Link
                key={`${t.player_id}:${t.stat}`}
                to={playerPath(league, t.player_id)}
                className={`grid ${TREND_COLS} gap-3 items-center px-[18px] py-[8px] border-t border-[#221D1A] hover:bg-[#211C1A]`}
                style={{ boxShadow: `inset 3px 0 0 ${teamAccent(league, t.team)}` }}
              >
                <PlayerCell league={league} name={t.name} team={t.team} extId={t.ext_id} position={t.position} />
                <span className="font-martian text-[11px] text-[#C9C2BE] tracking-[0.5px]">
                  {t.stat_label}
                  <span className="block text-[9px] text-[#8A827E]">L{t.window}</span>
                </span>
                <Delta t={t} />
                <ZBar z={t.z} />
                <span className="flex justify-center">
                  <Rung rung={t.rung} label={t.stat_label} price={t.price} listed={t.price != null} />
                </span>
                <MatchupCell league={league} opponent={opp(insights, t.team)} matchup={t.matchup} label={t.stat_label} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </ModuleCard>
  )
}
