import LeaguePage from '@/ember/league/LeaguePage'
import { nflConfig } from '@/ember/league/leagueConfigs'

export default function NFL() {
  return <LeaguePage config={nflConfig} />
}
