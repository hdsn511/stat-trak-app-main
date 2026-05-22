import { useNavigate } from 'react-router-dom'
import { GameDetail } from '@/services/api'
import { cn } from '@/lib/utils'

interface Props { data: GameDetail }

const STAT_LBL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST',
  points: 'PTS', rebounds: 'REB', assists: 'AST',
  three_points_made: '3PM', steals: 'STL', blocks: 'BLK',
}

// ─── Diverging stat bar — value | bar ··LABEL·· bar | value ──────────────
function DivBar({
  label, lv, rv, max,
}: { label: string; lv: number | null; rv: number | null; max: number }) {
  const l = lv ?? 0
  const r = rv ?? 0
  const fmt = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(1)
  const lp = max > 0 ? Math.min((l / max) * 100, 100) : 0
  const rp = max > 0 ? Math.min((r / max) * 100, 100) : 0

  return (
    <div className="flex items-center gap-1.5">
      {/* left: value then bar grows rightward from center */}
      <span className="text-[10px] font-mono text-white w-8 text-right tabular-nums leading-none">{fmt(l)}</span>
      <div className="flex-1 h-[3px] bg-[#1c1c1c] rounded-full overflow-hidden flex justify-end">
        <div className="h-full bg-[#FF5F2E] rounded-full" style={{ width: `${lp}%` }} />
      </div>
      {/* center label */}
      <span className="text-[7px] font-bold text-gray-700 uppercase tracking-wider w-7 text-center shrink-0 font-condensed">
        {label}
      </span>
      {/* right: bar grows leftward from center, then value */}
      <div className="flex-1 h-[3px] bg-[#1c1c1c] rounded-full overflow-hidden">
        <div className="h-full bg-gray-500 rounded-full" style={{ width: `${rp}%` }} />
      </div>
      <span className="text-[10px] font-mono text-white w-8 tabular-nums leading-none">{fmt(r)}</span>
    </div>
  )
}

// ─── Picks rail ────────────────────────────────────────────────────────────
function PicksRail({ picks }: { picks: GameDetail['picks'] }) {
  const sorted = [...picks]
    .filter(p => p.edge > 0)
    .sort((a, b) => b.edge - a.edge)

  const isGame = (p: GameDetail['picks'][0]) => p.prop_type !== 'player'
  const hitPct = (n: number) => `${Math.round(n * 100)}%`
  const edgePct = (n: number) => `+${Math.round(n * 100)}%`

  return (
    <div className="bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111] flex items-center justify-between shrink-0">
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.15em] font-condensed">Our Picks</span>
        {sorted.length > 0 && (
          <span className="text-[8px] text-[#FF5F2E] font-bold font-condensed">
            {sorted.length} pick{sorted.length !== 1 ? 's' : ''} · by edge
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <span className="text-[11px] text-gray-700 font-condensed text-center">No picks generated for this game yet</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-[#111]">
          {sorted.map((pick, i) => {
            const name = isGame(pick)
              ? pick.prop_type === 'spread' ? `${pick.player_name ?? 'Spread'}` : pick.prop_type === 'total' ? 'Game Total' : pick.prop_type.toUpperCase()
              : (pick.player_name ?? `Player ${pick.entity_id}`)
            const lineLabel = isGame(pick)
              ? pick.prop_type === 'total' ? `O/U ${pick.recommended_line}` : `${pick.recommended_line > 0 ? '+' : ''}${pick.recommended_line}`
              : `${STAT_LBL[pick.stat] ?? pick.stat.toUpperCase()} O ${pick.recommended_line}+`
            const mktPct = pick.implied_prob != null ? Math.round(pick.implied_prob * 100) : null
            const isTop = i === 0
            const isSafe = pick.hit_rate >= 0.75

            return (
              <div
                key={i}
                className={cn(
                  'px-4 py-3 flex flex-col gap-2',
                  isTop && 'bg-[#0f0f0f]'
                )}
              >
                {/* name + badge row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-white leading-tight truncate">{name}</div>
                    <div className="text-[9px] text-gray-600 font-condensed mt-0.5 uppercase tracking-wider">{lineLabel}</div>
                  </div>
                  <span className={cn(
                    'text-[7px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 mt-0.5',
                    isSafe ? 'bg-green-950 text-green-400 border border-green-900' : 'bg-[#1c1400] text-[#FF5F2E] border border-[#3a2800]'
                  )}>
                    {isSafe ? 'SAFE' : 'VALUE'}
                  </span>
                </div>

                {/* big hit rate + sparkline concept */}
                <div className="flex items-end gap-3">
                  <div>
                    <div className="text-[22px] font-black text-white font-mono leading-none tabular-nums">
                      {hitPct(pick.hit_rate)}
                    </div>
                    <div className="text-[8px] text-gray-700 font-condensed mt-0.5">hit rate</div>
                  </div>
                  {/* hit rate bar */}
                  <div className="flex-1 mb-3">
                    <div className="w-full h-1.5 bg-[#1c1c1c] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#FF5F2E]"
                        style={{ width: `${Math.round(pick.hit_rate * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* metrics row */}
                <div className="flex items-center gap-3">
                  {mktPct != null && (
                    <div className="text-center">
                      <div className="text-[11px] font-mono text-gray-400 tabular-nums">{mktPct}%</div>
                      <div className="text-[7px] text-gray-700 uppercase tracking-wider font-condensed">mkt</div>
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-[11px] font-mono text-[#FF5F2E] font-bold tabular-nums">{edgePct(pick.edge)}</div>
                    <div className="text-[7px] text-gray-700 uppercase tracking-wider font-condensed">edge</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] font-mono text-gray-400 tabular-nums">{Math.round(pick.confidence_score)}</div>
                    <div className="text-[7px] text-gray-700 uppercase tracking-wider font-condensed">conf</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Starter head-to-head card ─────────────────────────────────────────────
function StarterMatchup({
  data,
}: {
  data: GameDetail
}) {
  const { rosters, injury_report, game } = data
  const away = rosters.away
  const home = rosters.home
  const count = Math.max(away.length, home.length, 1)
  const rows = Array.from({ length: count }, (_, i) => ({
    away: away[i] ?? null,
    home: home[i] ?? null,
  }))

  // max values across both rosters for normalized bars
  const allPts = [...away, ...home].map(p => p.pts ?? 0)
  const allReb = [...away, ...home].map(p => p.reb ?? 0)
  const allAst = [...away, ...home].map(p => p.ast ?? 0)
  const maxPts = Math.max(...allPts, 1)
  const maxReb = Math.max(...allReb, 1)
  const maxAst = Math.max(...allAst, 1)

  const outIds = new Set(injury_report.filter(i => i.status === 'out').map(i => i.player_id))
  const gtdIds = new Set(injury_report.filter(i => i.status === 'gtd').map(i => i.player_id))

  // picks for labeling player rows
  const pickedPlayerIds = new Set(data.picks.filter(p => p.prop_type === 'player' && p.edge > 0).map(p => p.entity_id))

  return (
    <div className="bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl overflow-hidden">

      {/* injury banner */}
      {injury_report.length > 0 && (
        <div className="bg-[#120808] border-b border-[#2a1010] px-4 py-2 flex items-center gap-3 flex-wrap">
          {injury_report.map((inj, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className={cn(
                'text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide',
                inj.status === 'out' ? 'bg-red-950 text-red-400 border border-red-900' :
                inj.status === 'gtd' ? 'bg-yellow-950 text-yellow-400 border border-yellow-900' :
                'bg-[#111] text-gray-500 border border-[#222]'
              )}>
                {inj.status.toUpperCase()}
              </span>
              <span className="text-[9px] text-gray-300 font-condensed font-semibold">{inj.name}</span>
              {inj.position && <span className="text-[8px] text-gray-600 font-condensed">{inj.position}</span>}
            </span>
          ))}
        </div>
      )}

      {/* team headers */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-2.5 border-b border-[#111]">
        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed">
          {game.away_team.abbreviation}
          <span className="text-gray-700 font-normal ml-1.5">away</span>
        </span>
        <span className="text-[8px] font-bold text-gray-700 uppercase tracking-widest font-condensed px-4">
          {rosters.stat_context}
        </span>
        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.15em] font-condensed text-right">
          <span className="text-gray-700 font-normal mr-1.5">home</span>
          {game.home_team.abbreviation}
        </span>
      </div>

      {/* player rows */}
      {rows.map((row, i) => {
        const ap = row.away
        const hp = row.home
        const aOut = ap ? outIds.has(ap.player_id) : false
        const hOut = hp ? outIds.has(hp.player_id) : false
        const aGtd = ap ? gtdIds.has(ap.player_id) : false
        const hGtd = hp ? gtdIds.has(hp.player_id) : false
        const aPicked = ap ? pickedPlayerIds.has(ap.player_id) : false
        const hPicked = hp ? pickedPlayerIds.has(hp.player_id) : false

        return (
          <div
            key={i}
            className="border-b border-[#0f0f0f] last:border-0 px-4 py-3 space-y-2"
          >
            {/* player name row */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
              {/* away player */}
              <div>
                {ap ? (
                  <>
                    <div className={cn(
                      'text-[12px] font-bold leading-tight flex items-center gap-1.5',
                      aOut ? 'line-through text-gray-700' : 'text-white'
                    )}>
                      {ap.name}
                      {aPicked && <span className="text-[7px] text-[#FF5F2E] font-black uppercase tracking-wide">PICK↑</span>}
                      {aOut && <span className="text-[7px] text-red-500 font-black uppercase tracking-wide ml-1">OUT</span>}
                      {aGtd && !aOut && <span className="text-[7px] text-yellow-500 font-black uppercase tracking-wide ml-1">GTD</span>}
                    </div>
                    <div className="text-[8px] text-gray-700 font-condensed uppercase tracking-wider mt-0.5">
                      {ap.position} · {ap.games_played}G
                    </div>
                  </>
                ) : <div className="text-[11px] text-gray-700">—</div>}
              </div>
              {/* position marker */}
              <div className="text-[8px] text-gray-700 font-condensed uppercase tracking-wider text-center w-6 mt-0.5">
                {ap?.position ?? hp?.position ?? ''}
              </div>
              {/* home player */}
              <div className="text-right">
                {hp ? (
                  <>
                    <div className={cn(
                      'text-[12px] font-bold leading-tight flex items-center justify-end gap-1.5',
                      hOut ? 'line-through text-gray-700' : 'text-white'
                    )}>
                      {hPicked && <span className="text-[7px] text-[#FF5F2E] font-black uppercase tracking-wide">PICK↑</span>}
                      {hOut && <span className="text-[7px] text-red-500 font-black uppercase tracking-wide mr-1">OUT</span>}
                      {hGtd && !hOut && <span className="text-[7px] text-yellow-500 font-black uppercase tracking-wide mr-1">GTD</span>}
                      {hp.name}
                    </div>
                    <div className="text-[8px] text-gray-700 font-condensed uppercase tracking-wider mt-0.5">
                      {hp.position} · {hp.games_played}G
                    </div>
                  </>
                ) : <div className="text-[11px] text-gray-700 text-right">—</div>}
              </div>
            </div>

            {/* diverging bars */}
            <div className={cn('space-y-1.5', (aOut || hOut) && 'opacity-30')}>
              <DivBar label="PTS" lv={ap?.pts ?? null} rv={hp?.pts ?? null} max={maxPts} />
              <DivBar label="REB" lv={ap?.reb ?? null} rv={hp?.reb ?? null} max={maxReb} />
              <DivBar label="AST" lv={ap?.ast ?? null} rv={hp?.ast ?? null} max={maxAst} />
            </div>
          </div>
        )
      })}

      {/* legend */}
      <div className="px-4 py-2 border-t border-[#0f0f0f] flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-[3px] bg-[#FF5F2E] rounded-full" />
          <span className="text-[8px] text-gray-700 font-condensed">{game.away_team.abbreviation}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-[3px] bg-gray-500 rounded-full" />
          <span className="text-[8px] text-gray-700 font-condensed">{game.home_team.abbreviation}</span>
        </div>
        <span className="text-[8px] text-gray-700 font-condensed ml-auto">bars = relative to group max</span>
      </div>
    </div>
  )
}

// ─── H2H History ───────────────────────────────────────────────────────────
function H2HHistory({ entries, homeId, awayId }: {
  entries: GameDetail['head_to_head']
  homeId: number
  awayId: number
}) {
  const navigate = useNavigate()
  if (entries.length === 0) return null

  return (
    <div className="bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#111]">
        <span className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.15em] font-condensed">Season Matchups</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-0 divide-x divide-[#111]">
        {entries.map((m, i) => {
          const isHomeWin = m.winner_team_id === m.home_team.id
          const away = m.away_team
          const home = m.home_team
          const date = new Date(m.game_date + 'T00:00:00')
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          const total = m.home_score + m.away_score
          const winnerAbbr = isHomeWin ? home.abbreviation : away.abbreviation

          return (
            <button
              key={i}
              onClick={() => navigate(`/game/${m.game_id}`)}
              className="px-3 py-3 text-left hover:bg-white/[0.02] transition-colors"
            >
              <div className="text-[8px] text-gray-700 font-condensed uppercase tracking-wider mb-1.5">{dateStr}</div>
              <div className="text-[11px] font-mono font-bold text-white tabular-nums mb-0.5">
                <span className={m.away_team.id === awayId || m.away_team.id === homeId ? (m.away_score > m.home_score ? 'text-white' : 'text-gray-500') : ''}>
                  {away.abbreviation} {m.away_score}
                </span>
                <span className="text-gray-700 mx-1">–</span>
                <span className={m.home_score > m.away_score ? 'text-white' : 'text-gray-500'}>
                  {home.abbreviation} {m.home_score}
                </span>
              </div>
              <div className="text-[9px] text-gray-600 font-condensed">Total {total}</div>
              <div className="text-[8px] text-[#FF5F2E] font-condensed mt-1.5">
                {winnerAbbr} wins →
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main UpcomingView ─────────────────────────────────────────────────────
export default function UpcomingView({ data }: Props) {
  return (
    <div className="space-y-4">
      {/* main grid: 2/3 matchup + 1/3 picks (stretch to same height) */}
      <div className="grid grid-cols-[2fr_1fr] gap-4 items-stretch">
        <StarterMatchup data={data} />
        <PicksRail picks={data.picks} />
      </div>

      {/* H2H history */}
      <H2HHistory
        entries={data.head_to_head}
        homeId={data.game.home_team.id}
        awayId={data.game.away_team.id}
      />

      {/* rest context row */}
      {(data.rest.away_days != null || data.rest.home_days != null) && (
        <div className="bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl px-4 py-3 flex items-center gap-6">
          <span className="text-[9px] font-bold text-gray-600 uppercase tracking-[0.15em] font-condensed">Rest</span>
          <span className="text-[11px] text-white font-condensed">
            {data.game.away_team.abbreviation}
            <span className="font-mono ml-1.5 text-gray-300">{data.rest.away_days != null ? `${data.rest.away_days}d` : '—'}</span>
          </span>
          <span className="text-gray-700 text-[10px]">vs</span>
          <span className="text-[11px] text-white font-condensed">
            {data.game.home_team.abbreviation}
            <span className="font-mono ml-1.5 text-gray-300">{data.rest.home_days != null ? `${data.rest.home_days}d` : '—'}</span>
          </span>
          {data.rest.away_days != null && data.rest.home_days != null && (() => {
            const diff = data.rest.home_days - data.rest.away_days
            if (diff === 0) return null
            const adv = diff > 0 ? data.game.home_team.abbreviation : data.game.away_team.abbreviation
            return (
              <span className="text-[8px] font-bold text-[#FF5F2E] border border-[#3a2800] bg-[#1c1400] rounded px-2 py-0.5 font-condensed uppercase tracking-wide ml-auto">
                {adv} rest adv
              </span>
            )
          })()}
        </div>
      )}
    </div>
  )
}
