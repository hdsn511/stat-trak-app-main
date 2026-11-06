import { useCallback } from 'react'
import { createLeagueApi, getGameInsights, type GameDetail, type GameInsights, type ProjectsResponse } from '@/services/api'
import { EmptyState } from '@/ember/components/EntityState'
import ModuleCard from '@/ember/components/ModuleCard'
import { useEntityData } from '@/ember/useEntityData'
import ScoreHeader from './components/ScoreHeader'
import BoxScoreTable from './components/BoxScoreTable'
import MarketPanel from './components/MarketPanel'
import { HeadToHead, InjuryList } from './components/SidePanels'
import BestProps from './components/BestProps'
import Conditions from './components/Conditions'
import TaleOfTape from './components/TaleOfTape'
import TeamColumns from './components/TeamColumns'
import { StreaksTable, TrendsTable } from './components/PlayerTables'

interface GameViewProps {
  data: GameDetail
}

/** Leagues with a Projects pipeline, and how far ahead it picks. */
const PROJECTS_WINDOW: Record<string, string> = { nba: "TONIGHT'S SLATE", nfl: 'THE NEXT 7 DAYS' }

const noProjects = (): Promise<ProjectsResponse | null> => Promise.resolve(null)

function Pending({ title, label }: { title: string; label: string }) {
  return (
    <ModuleCard title={title}>
      <EmptyState compact label={label} />
    </ModuleCard>
  )
}

export default function GameView({ data }: GameViewProps) {
  const { league, game, box_score: box } = data
  const home = game.home_team
  const away = game.away_team
  const upcoming = !game.is_completed

  const loadInsights = useCallback(() => getGameInsights(league, game.id), [league, game.id])
  const insights = useEntityData<GameInsights>(loadInsights)

  const loadProjects = useCallback(
    () => (upcoming && PROJECTS_WINDOW[league] ? createLeagueApi(league).getProjects() : noProjects()),
    [league, upcoming]
  )
  const projects = useEntityData<ProjectsResponse | null>(loadProjects)
  const projectGame = projects.data?.games.find((g) => g.game_id === game.id) ?? null

  const ins = insights.data
  const insightsLabel = insights.loading
    ? 'LOADING MATCHUP DATA…'
    : `MATCHUP DATA UNAVAILABLE${insights.error ? `: ${insights.error}` : ''}`

  // ESPN's injury report replaces the availability table when it loaded.
  const showLegacyInjuries = !ins && data.injury_report.length > 0

  return (
    <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-[14px] px-8 pt-6 pb-11">
      <ScoreHeader league={league} game={game} rest={data.rest} />

      {upcoming && ins && <Conditions insights={ins} />}

      {upcoming && PROJECTS_WINDOW[league] && (
        projects.loading ? (
          <Pending title="BEST PROPS" label="LOADING PICKS…" />
        ) : (
          <BestProps
            league={league}
            game={projectGame}
            supported={projects.data?.supported ?? false}
            windowLabel={PROJECTS_WINDOW[league]!}
          />
        )
      )}

      {upcoming && (ins ? (
        <>
          <StreaksTable league={league} insights={ins} />
          <TrendsTable league={league} insights={ins} />
        </>
      ) : (
        <Pending title="STREAKS & TRENDS" label={insightsLabel} />
      ))}

      {box.groups.map((group) => (
        <BoxScoreTable key={group.id} league={league} group={group} home={home} away={away} />
      ))}

      {/* A finished game with no stat rows means the box score has not been
          ingested yet — say so rather than rendering nothing. */}
      {game.is_completed && box.groups.length === 0 && (
        <div className="bg-[#1B1715] border border-[#2C2624] rounded-lg">
          <EmptyState label="NO BOX SCORE INGESTED FOR THIS GAME YET" />
        </div>
      )}

      {ins ? (
        <TaleOfTape league={league} insights={ins} home={home} away={away} />
      ) : (
        <Pending title="TALE OF THE TAPE" label={insightsLabel} />
      )}

      {upcoming && ins && (
        <TeamColumns league={league} away={away} home={home} awayInfo={ins.away} homeInfo={ins.home} />
      )}

      {data.has_markets && (
        <MarketPanel league={league} props={data.props} picks={data.picks} home={home} away={away} />
      )}

      {(showLegacyInjuries || data.head_to_head.length > 0) && (
        <div
          className="grid gap-[14px] items-start"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}
        >
          {showLegacyInjuries && <InjuryList league={league} injuries={data.injury_report} />}
          <HeadToHead league={league} entries={data.head_to_head} home={home} away={away} />
        </div>
      )}
    </div>
  )
}
