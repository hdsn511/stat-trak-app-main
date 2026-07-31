import GameDetail from './GameDetail'
import PlayerDetail from './PlayerDetail'
import PlayerView from '@/ember/player/PlayerView'
import { usePlayerData } from '@/ember/player/usePlayerData'
import { parseQueryFilters } from './queryFilters'
import { allStatsFor, getPlayerStatConfig } from '@/config/playerStats'
import { GAMES, STATLBL, type Selection } from './data'

interface DetailPaneProps {
  sel: Selection
  onClose: () => void
  onChange: (sel: Selection) => void
}

/** Real player panel, filters seeded from the query that produced the result. */
function PlayerPanel({ playerId, query }: { playerId: number; query: string }) {
  const { data, loading, error, reload } = usePlayerData('nba', playerId)
  const statKeys = allStatsFor(getPlayerStatConfig('nba'), 'player').map((s) => s.key)

  if (loading) {
    return (
      <div className="px-[18px] py-16 text-center font-martian text-[10px] text-[#665F5D] tracking-[1px]">
        LOADING PLAYER…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="px-[18px] py-16 text-center">
        <div className="font-martian text-[10px] text-[#FF6B5C] tracking-[1px]">
          {`COULD NOT LOAD PLAYER — ${error ?? 'no data'}`}
        </div>
        <button
          type="button"
          onClick={reload}
          className="font-martian text-[9px] text-[#9A918F] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md px-[14px] py-[7px] mt-4 cursor-pointer"
        >
          RETRY
        </button>
      </div>
    )
  }
  return (
    <PlayerView
      slug="nba"
      data={data}
      mode="panel"
      initialFilters={parseQueryFilters(query, statKeys)}
    />
  )
}

export default function DetailPane({ sel, onClose, onChange }: DetailPaneProps) {
  const chip =
    sel.type === 'player' ? `FOCUS: ${STATLBL[sel.stat]}` : GAMES[sel.id].live ? 'LIVE' : 'FINAL'
  // Fixture selections carry a string key, not a database id. Real ids arrive
  // once the chat pane is wired to the backend; until then those fall back to
  // the fixture panel.
  const realId = sel.type === 'player' ? Number(sel.id) : NaN

  return (
    <div className="flex-1 min-w-0 bg-[#171310] text-[#EFEBE9] overflow-y-auto animate-rise">
      {/* Query context bar */}
      <div className="sticky top-0 z-[5] flex items-center gap-3 px-[28px] py-[11px] border-b border-[#2A2320] bg-[#1D1815]">
        <span className="font-martian font-bold text-[10px] text-[#FF6B3D] shrink-0">&gt;_</span>
        <span className="font-martian text-[10px] text-[#9A918F] whitespace-nowrap overflow-hidden text-ellipsis flex-auto min-w-[72px]">
          FROM: “{sel.query}”
        </span>
        <div className="flex gap-[6px] shrink-0">
          <span className="font-martian font-medium text-[9px] tracking-[0.5px] px-[11px] py-1 rounded-xl border border-[#EFE9E0] bg-[#EFE9E0] text-[#14100F] whitespace-nowrap">
            {chip}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-martian font-bold text-[10px] text-[#9A918F] hover:text-[#EFEBE9] cursor-pointer px-[10px] py-[5px] border border-[#2C2624] hover:border-[#665F5D] rounded-md shrink-0"
        >
          ✕ CLOSE
        </button>
      </div>
      {sel.type === 'player' ? (
        Number.isFinite(realId) && realId > 0 ? (
          <PlayerPanel playerId={realId} query={sel.query} />
        ) : (
          <PlayerDetail sel={sel} onChange={onChange} />
        )
      ) : (
        <GameDetail sel={sel} onChange={onChange} />
      )}
    </div>
  )
}
