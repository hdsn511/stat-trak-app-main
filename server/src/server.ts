import { app } from './app';
import { startScheduler } from './jobs/scheduler';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`NBA trends: http://localhost:${PORT}/api/nba/trends/top`);
  startScheduler();
});
