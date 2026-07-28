import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import sportqueryRoutes from './routes/sportquery';
import nbaRoutes from './routes/nba';
import picksRoutes from './routes/picks';
import performanceRoutes from './routes/performance';
import { leagueMiddleware } from './config/leagues';
import { apiRateLimiter } from './middleware/rateLimit';

export const app = express();

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

app.use('/api', apiRateLimiter);

// Same handlers, mounted per-league. The middleware sets res.locals.league so
// the (league-agnostic) controllers resolve their tables/filters per sport.
app.use('/api/nba', leagueMiddleware('nba'), nbaRoutes);
app.use('/api/nba', leagueMiddleware('nba'), picksRoutes);
app.use('/api/mlb', leagueMiddleware('mlb'), nbaRoutes);
app.use('/api/mlb', leagueMiddleware('mlb'), picksRoutes);

app.use('/api/sportquery', sportqueryRoutes);

// Performance: /api/performance stays NBA (backward-compatible for the existing
// client); per-league mounts add MLB.
app.use('/api/performance', performanceRoutes);
app.use('/api/nba/performance', leagueMiddleware('nba'), performanceRoutes);
app.use('/api/mlb/performance', leagueMiddleware('mlb'), performanceRoutes);
