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
        <div className="font-martian text-[11px] text-[#A8A09C] mt-[1px]">{[team, position].filter(Boolean).join(' · ')}</div>
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
      title={listed ? `Kalshi market price: ${cents(price)} implied chance. Not the player's hit rate.` : 'Kalshi has not listed this line for this game yet; showing the nearest standard rung'}
    >
      <span className="font-chakra italic font-bold text-[16px] leading-none whitespace-nowrap" style={{ color: listed ? EMBER : '#C9C2BE' }}>
        {rung}+ <span className="text-[11px]">{label}</span>
      </span>
      <span className="font-martian text-[11px] mt-[3px] tabular-nums text-[#C9C2BE] whitespace-nowrap">
        {price != null ? <><span className="text-[10px] text-[#8A827E]">mkt </span>{cents(price)}</> : <span className="text-[10px] text-[#8A827E]">no mkt yet</span>}
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

/** Rows per side: the two tables sit side by side, so they show the same count. */
const MAX_ROWS = 10

// Fluid columns: the tables fill their half of the page and never scroll sideways.
const STREAK_COLS = 'grid-cols-[minmax(0,1.6fr)_84px_52px_minmax(60px,1fr)_64px_minmax(0,0.8fr)]'

export function StreaksTable({ league, insights }: { league: string; insights: GameInsights }) {
  const rows = both<GameInsightStreak>(insights, (t) => t.streaks).slice(0, MAX_ROWS)
  return (
    <ModuleCard className="h-full" title="STREAKS" meta="CONSECUTIVE GAMES OVER A KALSHI RUNG · OUT PLAYERS REMOVED">
      {rows.length === 0 ? (
        <EmptyState compact label="NO ACTIVE STREAKS AT A KALSHI RUNG FOR EITHER TEAM" />
      ) : (
        <div>
          <div>
            <div className={`grid ${STREAK_COLS} gap-2 px-3 py-2`}>
              <Th>PLAYER</Th>
              <Th align="center" tip="Kalshi rung the streak clears. mkt % = Kalshi price (implied chance), not a hit rate. Orange = listed for this game">LINE (MKT %)</Th>
              <Th align="center" tip="Games in a row at or above the line">RUN</Th>
              <Th tip="Each game as a bar: green cleared the line, red missed. Dashed line = the rung">LAST {Math.max(...rows.map((r) => r.last10.length))}</Th>
              <Th align="right" tip="Average over the last 10 games">L10 AVG</Th>
              <Th tip="How much more (+) or less (−) than average the opponent allows in this stat, and its rank (#1 = stingiest, #30 = softest)">VS DEFENSE</Th>
            </div>
            {rows.map((s) => (
              <Link
                key={`${s.player_id}:${s.stat}`}
                to={playerPath(league, s.player_id, { stat: s.stat_label, line: s.rung, window: 10 })}
                className={`grid ${STREAK_COLS} gap-3 items-center px-[18px] py-[8px] border-t border-[#221D1A] hover:bg-[#211C1A]`}
                style={{ boxShadow: `inset 3px 0 0 ${teamAccent(league, s.team)}` }}
              >
                <PlayerCell league={league} name={s.name} team={s.team} extId={s.ext_id} position={s.position} />
                <span className="flex justify-center">
                  <Rung rung={s.rung} label={s.stat_label} price={s.price} listed={s.listed} />
                </span>
                <span className="text-center font-martian font-bold text-[18px] leading-none tabular-nums" style={{ color: GOOD }}>
                  {s.depth}
                  <span className="block text-[10px] text-[#8A827E] font-normal tracking-[0.5px] mt-[2px]" title={`${s.depth} straight, from the last ${s.games} games`}>STRAIGHT</span>
                </span>
                <HitStrip values={s.last10} rung={s.rung} width="100%" />
                <span className="text-right font-martian font-bold text-[15px] text-[#EFEBE9] tabular-nums">{s.l10_avg}</span>
                <MatchupCell league={league} opponent={opp(insights, s.team)} matchup={s.matchup} label={s.stat_label} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </ModuleCard>
  )
}

const TREND_COLS = 'grid-cols-[minmax(0,1.6fr)_44px_minmax(0,1.2fr)_76px_84px_minmax(0,0.8fr)]'

function Delta({ t }: { t: GameInsightTrend }) {
  const season = t.season_avg
  const up = t.z >= 0
  const color = up ? GOOD : BAD
  const pctChange = season && season > 0 ? Math.round(((t.recent_avg - season) / season) * 100) : null
  return (
    <span className="inline-flex items-center gap-2 font-martian text-[13px] tabular-nums whitespace-nowrap">
      <span className="text-[#A8A09C]">{season ?? '—'}</span>
      <span style={{ color }}>{up ? '▲' : '▼'}</span>
      <span className="font-bold text-[16px]" style={{ color }}>{t.recent_avg}</span>
      {pctChange != null && (
        <span className="text-[11px]" style={{ color }}>
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
    <span
      className="flex items-center gap-2"
      title={`Trend strength (z-score) ${z}: ${Math.abs(z) >= 2 ? 'rare' : Math.abs(z) >= 1 ? 'strong' : Math.abs(z) >= 0.3 ? 'mild' : 'barely moved'}`}
    >
      <span className="relative h-[6px] w-[44px] bg-[#221D1A] rounded-full overflow-hidden">
        <span className="absolute top-0 bottom-0 left-1/2 w-px bg-[#4A4340]" />
        <span
          className="absolute top-0 bottom-0 rounded-full"
          style={{ background: color, width: `${w}%`, left: z >= 0 ? '50%' : `${50 - w}%` }}
        />
      </span>
      <span className="font-martian text-[12px] tabular-nums" style={{ color }}>
        {z > 0 ? '+' : ''}
        {z.toFixed(2)}
      </span>
    </span>
  )
}

export function TrendsTable({ league, insights }: { league: string; insights: GameInsights }) {
  // At most two rows per player, so one hot player can't fill the table.
  const seen = new Map<number, number>()
  const rows = both<GameInsightTrend>(insights, (t) => t.trends)
    .filter((t) => {
      const n = (seen.get(t.player_id) ?? 0) + 1
      seen.set(t.player_id, n)
      return n <= 2
    })
    .slice(0, MAX_ROWS)
  return (
    <ModuleCard className="h-full" title="TRENDS" meta="RECENT FORM VS SEASON · ▲ HOT / ▼ COLD">
      {rows.length === 0 ? (
        <EmptyState compact label="NO TREND ROWS FOR EITHER ROSTER" />
      ) : (
        <div>
          <div>
            <div className={`grid ${TREND_COLS} gap-2 px-3 py-2`}>
              <Th>PLAYER</Th>
              <Th tip="The stat, and how many recent games the trend uses (L5 = last 5)">STAT</Th>
              <Th tip="Season average → recent average, and the % change">SEASON → RECENT</Th>
              <Th tip="How unusual the recent form is for this player (z-score). ±0.3 is a mild move, ±1 is strong, ±2 is rare">STRENGTH</Th>
              <Th align="center" tip="Kalshi rung nearest the recent average. The % is the Kalshi market price (implied chance), not a hit rate">NEAR LINE (MKT %)</Th>
              <Th tip="How much more (+) or less (−) than average the opponent allows in this stat, and its rank (#1 = stingiest, #30 = softest)">VS DEFENSE</Th>
            </div>
            {rows.map((t) => (
              <Link
                key={`${t.player_id}:${t.stat}`}
                to={playerPath(league, t.player_id, { stat: t.stat_label, line: t.rung, window: t.window })}
                className={`grid ${TREND_COLS} gap-3 items-center px-[18px] py-[8px] border-t border-[#221D1A] hover:bg-[#211C1A]`}
                style={{ boxShadow: `inset 3px 0 0 ${teamAccent(league, t.team)}` }}
              >
                <PlayerCell league={league} name={t.name} team={t.team} extId={t.ext_id} position={t.position} />
                <span className="font-martian text-[12px] text-[#EFEBE9] tracking-[0.5px]">
                  {t.stat_label}
                  {t.window < 5 ? (
                    <span className="block text-[10px] text-[#FFB020]" title={`Only ${t.window} recent games, so one big game moves the average a lot`}>
                      L{t.window} · small
                    </span>
                  ) : (
                    <span className="block text-[10px] text-[#8A827E]">L{t.window}</span>
                  )}
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
