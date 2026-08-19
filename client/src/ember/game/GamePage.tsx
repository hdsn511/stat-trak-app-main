import { useCallback } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import type { LeagueSlug } from '@/config/leagues'
import { createLeagueApi, type GameDetail } from '@/services/api'
import { ErrorState, LoadingState } from '@/ember/components/EntityState'
import { useEntityData } from '@/ember/useEntityData'
import { isLeagueSlug } from '@/lib/leagueSlug'
import GameView from './GameView'

export default function GamePage() {
  const { league, id } = useParams<{ league: string; id: string }>()
  const gameId = Number(id)

  if (!isLeagueSlug(league) || !Number.isFinite(gameId) || gameId <= 0) {
    return <Navigate to="/" replace />
  }
  return <GamePageInner slug={league} id={gameId} />
}

function GamePageInner({ slug, id }: { slug: LeagueSlug; id: number }) {
  const load = useCallback(() => createLeagueApi(slug).getGame(id), [slug, id])
  const { data, loading, error, reload } = useEntityData<GameDetail>(load)

  if (loading) return <LoadingState label="LOADING GAME…" />
  if (error || !data) {
    return <ErrorState label="COULD NOT LOAD GAME" detail={error ?? 'no data'} onRetry={reload} />
  }
  return <GameView data={data} />
}
