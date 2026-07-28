import { computeTrends } from '../jobs/computeNBATrends';

export async function main(): Promise<void> {
  console.log('Computing NBA trends...');
  await computeTrends();
  console.log('Done.');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
