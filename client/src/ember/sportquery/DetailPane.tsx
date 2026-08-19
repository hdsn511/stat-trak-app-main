import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import PlayerView from '@/ember/player/PlayerView'
import { ErrorState, LoadingState } from '@/ember/components/EntityState'
import { useEntityData } from '@/ember/useEntityData'
import { createLeagueApi } from '@/services/api'
import type { PlayerLogResponse } from '@/ember/player/types'
import { allStatsFor, getPlayerStatConfig } from '@/config/playerStats'
import { playerPath } from '@/lib/paths'
import { parseQueryFilters } from './queryFilters'
import type { Selection } from './selection'

// SportQuery's schema documents the NBA tables only, so every result row is an
// NBA player. When the prompt grows to other sports the selection will need to
// carry a league and this constant goes away.
const LEAGUE = 'nba' as const

interface DetailPaneProps {
  selection: Selection
  onClose: () => void
}

export default function DetailPane({ selection, onClose }: DetailPaneProps) {
  const { playerId, query } = selection

  const load = useCallback(
    () => createLeagueApi(LEAGUE).getPlayerLog(playerId, 'all'),
    [playerId]
  )
  const { data, loading, error, reload } = useEntityData<PlayerLogResponse>(load)

  const statKeys = allStatsFor(getPlayerStatConfig(LEAGUE), 'player').map((s) => s.key)

  return (
    <div className="flex-1 min-w-0 bg-[#171310] text-[#EFEBE9] overflow-y-auto animate-rise">
      <div className="sticky top-0 z-[5] flex items-center gap-3 px-[28px] py-[11px] border-b border-[#2A2320] bg-[#1D1815]">
        <span className="font-martian font-bold text-[10px] text-[#FF6B3D] shrink-0">&gt;_</span>
        <span className="font-martian text-[10px] text-[#9A918F] whitespace-nowrap overflow-hidden text-ellipsis flex-auto min-w-[72px]">
          {query ? `FROM: “${query}”` : selection.name}
        </span>
        <Link
          to={playerPath(LEAGUE, playerId)}
          className="font-martian text-[9px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md px-[10px] py-[5px] shrink-0 whitespace-nowrap"
        >
          FULL PAGE →
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="font-martian font-bold text-[10px] text-[#9A918F] hover:text-[#EFEBE9] cursor-pointer px-[10px] py-[5px] border border-[#2C2624] hover:border-[#665F5D] rounded-md shrink-0"
        >
          ✕ CLOSE
        </button>
      </div>

      {loading && <LoadingState label="LOADING PLAYER…" compact />}
      {!loading && (error || !data) && (
        <ErrorState
          label="COULD NOT LOAD PLAYER"
          detail={error ?? 'no data'}
          onRetry={reload}
          compact
        />
      )}
      {!loading && data && (
        <PlayerView
          // Selecting a different player reuses this same DetailPane instance
          // rather than remounting it, so without a key tied to the player,
          // PlayerView's internal filter state (seeded once via useState's
          // lazy initializer) would carry over instead of applying the newly
          // parsed initialFilters below.
          key={playerId}
          slug={LEAGUE}
          data={data}
          mode="panel"
          // Seed the filters from the question that surfaced this row, so the
          // panel opens on the stat and window the user actually asked about.
          initialFilters={parseQueryFilters(query, statKeys)}
        />
      )}
    </div>
  )
}
