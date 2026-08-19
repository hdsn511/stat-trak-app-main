// Loaded first: config modules read process.env at import time, so the
// entrypoint cannot rely on another module's dotenv side effect running first.
import 'dotenv/config';
import { app } from './app';
import { startScheduler } from './jobs/scheduler';

const PORT = process.env.PORT || 3000;

// Local/PM2 entrypoint. The scheduler lives here and not in app.ts because it
// spawns a Python venv and writes to local disk — neither exists on Lambda,
// where scheduling is GitHub Actions' job instead.
app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`NBA trends: http://localhost:${PORT}/api/nba/trends/top`);
  startScheduler();
});
