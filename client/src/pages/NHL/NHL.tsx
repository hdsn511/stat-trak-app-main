import LeaguePage from '@/ember/league/LeaguePage'
import { nhlConfig } from '@/ember/league/leagueConfigs'

export default function NHL() {
  return <LeaguePage config={nhlConfig} />
}
