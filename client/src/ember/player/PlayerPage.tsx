import type { ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
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

  if (loading) {
    return (
      <Centered>
        <span className="font-martian text-[10px] text-[#665F5D] tracking-[1px]">
          LOADING PLAYER…
        </span>
      </Centered>
    )
  }

  if (error || !data) {
    return (
      <Centered>
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
      </Centered>
    )
  }

  return <PlayerView slug={slug} data={data} mode="full" />
}
