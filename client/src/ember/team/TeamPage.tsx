import { useCallback } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import type { LeagueSlug } from '@/config/leagues'
import { createLeagueApi, type TeamDetail } from '@/services/api'
import { ErrorState, LoadingState } from '@/ember/components/EntityState'
import { useEntityData } from '@/ember/useEntityData'
import { isLeagueSlug } from '@/lib/leagueSlug'
import TeamView from './TeamView'

export default function TeamPage() {
  const { league, id } = useParams<{ league: string; id: string }>()
  const teamId = Number(id)

  if (!isLeagueSlug(league) || !Number.isFinite(teamId) || teamId <= 0) {
    return <Navigate to="/" replace />
  }
  return <TeamPageInner slug={league} id={teamId} />
}

function TeamPageInner({ slug, id }: { slug: LeagueSlug; id: number }) {
  const load = useCallback(() => createLeagueApi(slug).getTeam(id), [slug, id])
  const { data, loading, error, reload } = useEntityData<TeamDetail>(load)

  if (loading) return <LoadingState label="LOADING TEAM…" />
  if (error || !data) {
    return <ErrorState label="COULD NOT LOAD TEAM" detail={error ?? 'no data'} onRetry={reload} />
  }
  return <TeamView data={data} />
}
