import { computeTrends } from '../jobs/computeNBATrends'

// EventBridge-triggered Lambda entry point for infra/jobs.config.ts's
// "nba-trends" job. Mirrors what `npm run sync-data` runs locally.
export async function handler(): Promise<void> {
  await computeTrends()
}
