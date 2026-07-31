import LeaguePage from '@/ember/league/LeaguePage'
import { mlbConfig } from '@/ember/league/leagueConfigs'

export default function MLB() {
  return <LeaguePage config={mlbConfig} />
}
