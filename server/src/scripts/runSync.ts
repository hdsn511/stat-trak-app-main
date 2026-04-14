import { computeTrends } from '../jobs/computeNBATrends';

async function main() {
  console.log('Computing NBA trends...');
  await computeTrends();
  console.log('Done.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
