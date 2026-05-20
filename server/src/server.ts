import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { startScheduler } from './jobs/scheduler';
import sportqueryRoutes from './routes/sportquery';
import nbaRoutes from './routes/nba';
import picksRoutes from './routes/picks';
import performanceRoutes from './routes/performance';

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

app.use('/api/nba', nbaRoutes);
app.use('/api/nba', picksRoutes);
app.use('/api/sportquery', sportqueryRoutes);
app.use('/api/performance', performanceRoutes);

app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`NBA trends: http://localhost:${PORT}/api/nba/trends/top`);
  startScheduler();
});
