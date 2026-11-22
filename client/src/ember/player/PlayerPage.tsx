import type { ReactNode } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { LEAGUES, type LeagueSlug } from '@/config/leagues'
import PlayerView from './PlayerView'
import { usePlayerData } from './usePlayerData'

const isLeague = (s: string | undefined): s is LeagueSlug => LEAGUES.some((l) => l.slug === s)

function Centered({ children }: { children: ReactNode }) {
  return <div className="px-[28px] py-20 text-center">{children}</div>
}

export default function PlayerPage() {
  const { league, id } = useParams<{ league: string; id: string }>()
  const playerId = Number(id)

  if (!isLeague(league) || !Number.isFinite(playerId) || playerId <= 0) {
    return <Navigate to="/" replace />
  }
  return <PlayerPageInner slug={league} id={playerId} />
}

function PlayerPageInner({ slug, id }: { slug: LeagueSlug; id: number }) {
  const { data, loading, error, reload } = usePlayerData(slug, id)
  // ?stat=PTS&line=10&window=10 from a row link preselects the filters.
  const [params] = useSearchParams()
  const line = params.get('line')
  const win = params.get('window')
  const initialFilters = {
    stat: params.get('stat') ?? undefined,
    line: line != null && Number.isFinite(Number(line)) ? Number(line) : undefined,
    window: win != null && Number.isFinite(Number(win)) ? Number(win) : undefined,
  }

  if (loading) {
    return (
      <Centered>
        <span className="font-martian text-[12px] text-[#A8A09C] tracking-[1px]">
          LOADING PLAYER…
        </span>
      </Centered>
    )
  }

  if (error || !data) {
    return (
      <Centered>
        <div className="font-martian text-[12px] text-[#FF6B5C] tracking-[1px]">
          {`COULD NOT LOAD PLAYER — ${error ?? 'no data'}`}
        </div>
        <button
          type="button"
          onClick={reload}
          className="font-martian text-[11px] text-[#C9C2BE] hover:text-[#EFEBE9] border border-[#2C2624] hover:border-[#665F5D] rounded-md px-[14px] py-[7px] mt-4 cursor-pointer"
        >
          RETRY
        </button>
      </Centered>
    )
  }

  return <PlayerView key={params.toString()} slug={slug} data={data} mode="full" initialFilters={initialFilters} />
}
