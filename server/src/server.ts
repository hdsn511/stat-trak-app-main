const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Test route
app.get('/health', (req: any, res: any) => {
  res.json({ 
    status: 'OK', 
    message: 'StatTrak API is running!',
    timestamp: new Date().toISOString()
  });
});

// Basic API routes
app.get('/api/players', (req: any, res: any) => {
  res.json({
    success: true,
    message: 'Players endpoint working!',
    data: [
      { id: 1, name: 'LeBron James', team: 'LAL', position: 'SF' },
      { id: 2, name: 'Stephen Curry', team: 'GSW', position: 'PG' }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`StatTrak API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Players API: http://localhost:${PORT}/api/players`);
});
