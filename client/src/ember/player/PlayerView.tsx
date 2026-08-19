import { useEffect, useMemo, useState } from 'react'
import type { LeagueSlug } from '@/config/leagues'
import { allStatsFor, getPlayerStatConfig } from '@/config/playerStats'
import { createLeagueApi } from '@/services/api'
import {
  filterGames,
  gamesVersus,
  hitRate,
  matchupSignal,
  opponentsOf,
  resolveMatchupOpponent,
  splitsFor,
} from './derive'
import { usePlayerFilters } from './usePlayerFilters'
import FilterBar from './components/FilterBar'
import LineControl from './components/LineControl'
import GameLogChart from './components/GameLogChart'
import StatLineCards from './components/StatLineCards'
import GameLogTable from './components/GameLogTable'
import MatchupPanel from './components/MatchupPanel'
import type { DefenseSplit, PlayerFilters, PlayerLogResponse } from './types'

interface PlayerViewProps {
  slug: LeagueSlug
  data: PlayerLogResponse
  mode: 'panel' | 'full'
  initialFilters?: Partial<PlayerFilters>
}

/** Teams per league, for turning a defensive rank into a percentile. */
const TEAM_COUNT: Record<LeagueSlug, number> = { nba: 30, mlb: 30, nhl: 32, nfl: 32 }

export default function PlayerView({ slug, data, mode, initialFilters }: PlayerViewProps) {
  const cfg = getPlayerStatConfig(slug)
  const games = data.games
  const role = cfg.roleOf(data.player, games[0])
  const statDefs = useMemo(() => allStatsFor(cfg, role), [cfg, role])
  const volumeDef = useMemo(() => cfg.volumeFor(role), [cfg, role])

  const { filters, setWindow, setVsTeam, setHomeAway, setStat, setLine, resetLine } =
    usePlayerFilters({ games, statDefs, initial: initialFilters })

  const activeDef = statDefs.find((s) => s.key === filters.stat) ?? statDefs[0]
  const filtered = useMemo(() => filterGames(games, filters), [games, filters])
  const opponents = useMemo(() => opponentsOf(games), [games])

  const target = resolveMatchupOpponent(data.upcoming, filters.vsTeam)
  const h2h = useMemo(() => (target ? gamesVersus(games, target.team) : []), [games, target])

  // Defensive split for the matchup signal. Null for leagues with no table.
  const [defense, setDefense] = useState<DefenseSplit | null>(null)
  const oppTeamId = target?.upcoming?.opponentTeamId ?? null
  const position = data.player.position
  useEffect(() => {
    if (oppTeamId == null) {
      setDefense(null)
      return
    }
    let cancelled = false
    createLeagueApi(slug)
      .getTeamDefense(oppTeamId, filters.stat, position)
      .then((d) => {
        if (!cancelled) setDefense(d)
      })
      .catch(() => {
        if (!cancelled) setDefense(null)
      })
    return () => {
      cancelled = true
    }
  }, [slug, oppTeamId, filters.stat, position])

  if (games.length === 0) {
    return (
      <div className="px-[28px] py-16 text-center">
        <div className="font-chakra italic font-bold text-[24px] text-[#EFEBE9]">
          {data.player.name}
        </div>
        <div className="font-martian text-[10px] text-[#665F5D] tracking-[1px] mt-4">
          NO GAMES LOGGED THIS SEASON
        </div>
      </div>
    )
  }

  const pad = mode === 'full' ? 'px-[28px]' : 'px-[18px]'

  return (
    <div className={`${pad} pt-6 pb-11`}>
      {/* Identity */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-chakra italic font-bold text-[clamp(22px,3vw,34px)] tracking-[-1px] leading-none text-[#EFEBE9]">
            {data.player.name}
          </div>
          <div className="font-martian text-[10px] text-[#9A918F] mt-[7px] tracking-[0.5px]">
            {`${data.player.team} · ${data.player.position ?? '—'} · ${data.gamesPlayed} GP`.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Filters + line + chart */}
      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-5">
        <FilterBar
          filters={filters}
          statDefs={statDefs}
          windows={cfg.windows}
          opponents={opponents}
          onWindow={setWindow}
          onVsTeam={setVsTeam}
          onHomeAway={setHomeAway}
          onStat={setStat}
        />
        <LineControl
          label={activeDef?.label ?? ''}
          line={filters.line}
          hitRate={hitRate(filtered, activeDef, filters.line)}
          versusHitRate={target ? hitRate(h2h, activeDef, filters.line) : null}
          versusTeam={target?.team ?? null}
          touched={filters.lineTouched}
          onLine={setLine}
          onReset={resetLine}
        />
        <StatLineCards
          games={filtered}
          statDefs={statDefs}
          volumeDef={volumeDef}
          activeStat={filters.stat}
        />
        <GameLogChart games={filtered} def={activeDef} line={filters.line} />
      </div>

      <MatchupPanel
        target={target}
        splits={splitsFor(games, h2h, [...(volumeDef ? [volumeDef] : []), ...statDefs])}
        signal={matchupSignal(defense, TEAM_COUNT[slug])}
        h2h={h2h}
        statDefs={statDefs}
        volumeDef={volumeDef}
      />

      <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg mt-[14px] overflow-hidden">
        <div className="px-[18px] py-[13px] border-b border-[#27221F]">
          <span className="font-chakra italic font-bold text-[13px] tracking-[0.5px] text-[#EFEBE9]">
            <span className="text-[#FF6B3D]">{'//'}</span>
            {` GAME LOG · ${filtered.length} GAMES`}
          </span>
        </div>
        <GameLogTable
          games={filtered}
          statDefs={statDefs}
          volumeDef={volumeDef}
          activeStat={filters.stat}
        />
      </div>
    </div>
  )
}
