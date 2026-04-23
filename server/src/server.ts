export {};
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
import { startScheduler } from './jobs/scheduler';
import sportqueryRoutes from './routes/sportquery';

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

const nbaRoutes = require('./routes/nba');
app.use('/api/nba', nbaRoutes);
app.use('/api/sportquery', sportqueryRoutes);

app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`NBA trends: http://localhost:${PORT}/api/nba/trends/top`);
  startScheduler();
});
