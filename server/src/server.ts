import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { startScheduler } from './jobs/scheduler';
import sportqueryRoutes from './routes/sportquery';
import nbaRoutes from './routes/nba';
import picksRoutes from './routes/picks';
import performanceRoutes from './routes/performance';
import { leagueMiddleware } from './config/leagues';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

app.get('/health', (req: any, res: any) => {
  res.json({
    status: 'OK',
    message: 'StatTrak API is running!',
    timestamp: new Date().toISOString()
  });
});

// Same handlers, mounted per-league. The middleware sets res.locals.league so
// the (league-agnostic) controllers resolve their tables/filters per sport.
app.use('/api/nba', leagueMiddleware('nba'), nbaRoutes);
app.use('/api/nba', leagueMiddleware('nba'), picksRoutes);
app.use('/api/mlb', leagueMiddleware('mlb'), nbaRoutes);
app.use('/api/mlb', leagueMiddleware('mlb'), picksRoutes);
// NHL/NFL have per-game stats but no trends or picks pipeline, so only the
// core routes are mounted for them.
app.use('/api/nhl', leagueMiddleware('nhl'), nbaRoutes);
app.use('/api/nfl', leagueMiddleware('nfl'), nbaRoutes);

app.use('/api/sportquery', sportqueryRoutes);

// Performance: /api/performance stays NBA (backward-compatible for the existing
// client); per-league mounts add MLB.
app.use('/api/performance', performanceRoutes);
app.use('/api/nba/performance', leagueMiddleware('nba'), performanceRoutes);
app.use('/api/mlb/performance', leagueMiddleware('mlb'), performanceRoutes);

app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`NBA trends: http://localhost:${PORT}/api/nba/trends/top`);
  startScheduler();
});
