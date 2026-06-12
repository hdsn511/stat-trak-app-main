import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nbaApi, PlayerStreakRow, TopPickPlayer, LeagueApi } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type CardView = 'streaks' | 'picks'

export type StatTab = { key: string; label: string }

const NBA_STAT_TABS: StatTab[] = [
  { key: 'pts',  label: 'PTS' },
  { key: 'reb',  label: 'REB' },
  { key: 'ast',  label: 'AST' },
  { key: 'fg3m', label: '3PM' },
]

function fmtLine(v: number): string {
  return String(Math.round(v))
}

function MatchupChip({ rank }: { rank: number | null }) {
  if (rank == null) return null
  if (rank <= 10) {
    return (
      <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold font-condensed uppercase tracking-wide border bg-under/10 text-under border-under/20">
        TOUGH DEF | RANK {rank}
      </span>
    )
  }
  if (rank >= 21) {
    return (
      <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-bold font-condensed uppercase tracking-wide border bg-over/10 text-over border-over/20">
        WEAK DEF
      </span>
    )
  }
  return null
}

function PickStatus({ pick }: { pick: TopPickPlayer }) {
  if (pick.did_hit === true) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[11px] font-black text-over tracking-wide">HIT</span>
        {pick.actual_result != null && (
          <span className="text-[9px] text-over/60 font-mono">
            got {pick.actual_result}
          </span>
        )}
      </div>
    )
  }
  if (pick.did_hit === false) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[11px] font-black text-under tracking-wide">MISS</span>
        {pick.actual_result != null && (
          <span className="text-[9px] text-under/60 font-mono">
            got {pick.actual_result}
          </span>
        )}
      </div>
    )
  }
  return (
    <span className="text-[10px] text-gray-700 font-condensed uppercase tracking-widest">
      Pending
    </span>
  )
}

const COL_W = 'w-14'

export default function StreaksCard(
  { api = nbaApi, statTabs = NBA_STAT_TABS }: { api?: LeagueApi; statTabs?: StatTab[] }
) {
  const STAT_TABS = statTabs
  const [view, setView] = useState<CardView>('streaks')
  const [stat, setStat] = useState<string>(STAT_TABS[0].key)
  const [streakRows, setStreakRows] = useState<PlayerStreakRow[]>([])
  const [picks, setPicks] = useState<TopPickPlayer[]>([])
  const [streakLoading, setStreakLoading] = useState(true)
  const [picksLoading, setPicksLoading] = useState(false)
  const [picksFetched, setPicksFetched] = useState(false)

  useEffect(() => {
    setStreakLoading(true)
    api.getPlayerStreaks(stat)
      .then(res => setStreakRows(res.rows.slice(0, 10)))
      .catch(() => setStreakRows([]))
      .finally(() => setStreakLoading(false))
  }, [stat, api])

  useEffect(() => {
    if (view !== 'picks' || picksFetched) return
    setPicksLoading(true)
    api.getTopPicks(20)
      .then(res => setPicks(res.player))
      .catch(() => setPicks([]))
      .finally(() => { setPicksLoading(false); setPicksFetched(true) })
  }, [view, picksFetched, api])

  const cardTabs: { key: CardView; label: string }[] = [
    { key: 'streaks', label: 'Streaks' },
    { key: 'picks',   label: 'Picks' },
  ]

  return (
    <div className="bg-[#0D0D0D] border border-[#161616] rounded-2xl overflow-hidden">

      {/* Card-level tabs */}
      <div className="flex border-b border-[#111]">
        {cardTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={cn(
              'px-5 py-3.5 text-[11px] font-bold font-condensed tracking-[0.12em] uppercase transition-colors relative',
              view === t.key ? 'text-white' : 'text-gray-600 hover:text-gray-400'
            )}
          >
            {t.label}
            {view === t.key && (
              <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
            )}
          </button>
        ))}
        <div className="flex-1 flex items-center justify-end pr-4">
          <span className="text-[9px] text-gray-700 font-condensed uppercase tracking-widest">
            {view === 'streaks' ? 'Last 10 games' : 'Today\'s slate'}
          </span>
        </div>
      </div>

      {/* ── STREAKS view ──────────────────────────────────────────────── */}
      {view === 'streaks' && (
        <>
          {/* Stat tabs */}
          <div className="flex border-b border-[#111]">
            {STAT_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setStat(t.key)}
                className={cn(
                  'flex-1 py-2.5 text-[11px] font-bold font-condensed tracking-wide uppercase transition-colors relative',
                  stat === t.key ? 'text-white' : 'text-gray-600 hover:text-gray-400'
                )}
              >
                {t.label}
                {stat === t.key && (
                  <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-mint rounded-t-full" />
                )}
              </button>
            ))}
          </div>

          {/* Column headers */}
          {!streakLoading && streakRows.length > 0 && (
            <div className="flex items-center px-4 py-2 border-b border-[#111]">
              <div className="flex-1 min-w-0" />
              <div className="flex flex-shrink-0 ml-3">
                {['100%', '90%', '80%', '70%'].map(label => (
                  <span key={label} className={cn('text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest text-right', COL_W)}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {streakLoading && (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[60px] bg-[#141414] rounded" />
              ))}
            </div>
          )}

          {!streakLoading && streakRows.length === 0 && (
            <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
              No streaks found
            </div>
          )}

          {!streakLoading && streakRows.map((row, i) => (
            <Link
              key={row.player_id}
              to={`/player/${row.player_id}`}
              className="flex items-center px-4 py-3 border-b border-[#0F0F0F] last:border-0 hover:bg-white/[0.03] transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-[10px] text-gray-700 font-mono w-4 flex-shrink-0 group-hover:text-mint transition-colors">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-white font-condensed truncate group-hover:text-mint transition-colors">
                    {row.player_name}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-gray-600 font-condensed">
                      {row.team}
                      {row.opponent ? (
                        <> vs <span className="text-gray-500">{row.opponent.team}</span></>
                      ) : ''}
                    </span>
                    <MatchupChip rank={row.opponent?.league_rank ?? null} />
                  </div>
                </div>
              </div>

              <div className="flex flex-shrink-0 ml-3">
                <span className={cn('text-[15px] font-black text-over font-mono tabular-nums text-right leading-none', COL_W)}>
                  {fmtLine(row.line_100)}+
                </span>
                <span className={cn('text-[15px] font-bold text-white/70 font-mono tabular-nums text-right leading-none', COL_W)}>
                  {fmtLine(row.line_90)}+
                </span>
                <span className={cn('text-[15px] font-bold text-white/50 font-mono tabular-nums text-right leading-none', COL_W)}>
                  {fmtLine(row.line_80)}+
                </span>
                <span className={cn('text-[15px] font-bold text-white/30 font-mono tabular-nums text-right leading-none', COL_W)}>
                  {fmtLine(row.line_70)}+
                </span>
              </div>
            </Link>
          ))}
        </>
      )}

      {/* ── PICKS view ────────────────────────────────────────────────── */}
      {view === 'picks' && (
        <>
          {/* Column headers */}
          {!picksLoading && picks.length > 0 && (
            <div className="flex items-center px-4 py-2 border-b border-[#111]">
              <div className="flex-1 min-w-0 text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest">
                Player
              </div>
              <div className="flex items-center gap-6 flex-shrink-0 ml-3 text-[9px] font-bold text-gray-700 font-condensed uppercase tracking-widest">
                <span className="w-20 text-right">Line</span>
                <span className="w-10 text-right">Conf</span>
                <span className="w-16 text-right">Result</span>
              </div>
            </div>
          )}

          {picksLoading && (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[60px] bg-[#141414] rounded" />
              ))}
            </div>
          )}

          {!picksLoading && picks.length === 0 && (
            <div className="px-4 py-8 text-center text-[11px] text-gray-700 font-condensed">
              No picks for today
            </div>
          )}

          {!picksLoading && picks.map((pick, i) => (
            <Link
              key={`${pick.player_id}-${pick.stat}`}
              to={`/player/${pick.player_id}`}
              className="flex items-center px-4 py-3 border-b border-[#0F0F0F] last:border-0 hover:bg-white/[0.03] transition-colors group"
            >
              {/* Player */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-[10px] text-gray-700 font-mono w-4 flex-shrink-0 group-hover:text-mint transition-colors">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-white font-condensed truncate group-hover:text-mint transition-colors">
                    {pick.player_name}
                  </div>
                  <span className="text-[10px] text-gray-600 font-condensed">
                    {pick.team}
                    {pick.opponent?.team ? <> vs <span className="text-gray-500">{pick.opponent.team}</span></> : ''}
                  </span>
                </div>
              </div>

              {/* Line / Conf / Result */}
              <div className="flex items-center gap-6 flex-shrink-0 ml-3">
                {/* Line badge */}
                <div className="w-20 text-right">
                  <span className="text-[11px] font-black text-mint font-mono">
                    {pick.direction === 'over' ? '↑' : '↓'} {pick.line} {pick.stat_label}
                  </span>
                </div>

                {/* Confidence */}
                <div className="w-10 text-right">
                  <span className="text-[13px] font-black text-white font-mono tabular-nums">
                    {Math.round(pick.confidence ?? 0)}
                  </span>
                </div>

                {/* Hit / Miss / Pending */}
                <div className="w-16 flex justify-end">
                  <PickStatus pick={pick} />
                </div>
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  )
}
