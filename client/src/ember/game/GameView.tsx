import type { GameDetail } from '@/services/api'
import { EmptyState } from '@/ember/components/EntityState'
import ScoreHeader from './components/ScoreHeader'
import BoxScoreTable from './components/BoxScoreTable'
import PreviewPanel from './components/PreviewPanel'
import MarketPanel from './components/MarketPanel'
import { HeadToHead, InjuryList } from './components/SidePanels'

interface GameViewProps {
  data: GameDetail
}

export default function GameView({ data }: GameViewProps) {
  const { league, game, box_score: box } = data
  const home = game.home_team
  const away = game.away_team

  const sidePanels = (
    <>
      <InjuryList league={league} injuries={data.injury_report} />
      <HeadToHead league={league} entries={data.head_to_head} home={home} away={away} />
    </>
  )
  const hasSidePanels = data.injury_report.length > 0 || data.head_to_head.length > 0

  return (
    <div className="w-full max-w-[1280px] mx-auto flex flex-col gap-[14px] px-8 pt-6 pb-11">
      <ScoreHeader league={league} game={game} rest={data.rest} />

      {data.has_markets && (
        <MarketPanel
          league={league}
          props={data.props}
          picks={data.picks}
          home={home}
          away={away}
        />
      )}

      {data.preview && (
        <PreviewPanel league={league} preview={data.preview} home={home} away={away} />
      )}

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

      {hasSidePanels && (
        <div
          className="grid gap-[14px]"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        >
          {sidePanels}
        </div>
      )}
    </div>
  )
}
