import { computeMLBTrends } from '../jobs/computeMLBTrends'

// EventBridge-triggered Lambda entry point for infra/jobs.config.ts's
// "mlb-trends-compute" job. Mirrors what `npm run sync-data-mlb` runs locally.
export async function handler(): Promise<void> {
  await computeMLBTrends()
}
