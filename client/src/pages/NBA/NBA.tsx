import LeaguePage from '@/ember/league/LeaguePage'
import { nbaConfig } from '@/ember/league/leagueConfigs'

export default function NBA() {
  return <LeaguePage config={nbaConfig} />
}
