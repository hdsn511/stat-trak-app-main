import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import sportqueryRoutes from './routes/sportquery';
import nbaRoutes from './routes/nba';
import picksRoutes from './routes/picks';
import performanceRoutes from './routes/performance';
import searchRoutes from './routes/search';
import { leagueMiddleware } from './config/leagues';
import { proxySecretGate } from './middleware/proxySecret';

const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * Origins allowed to call the API cross-origin. In production the SPA reaches
 * the API same-origin through the Cloudflare Pages Function, so this list is a
 * second line of defence rather than the primary one — an empty list is the
 * correct production default.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const corsOrigins = allowedOrigins.length > 0 ? allowedOrigins : isLambda ? [] : devOrigins;

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: false,
  })
);
// CloudWatch parses structured lines; a local terminal does not benefit from them.
app.use(
  morgan(isLambda ? ':method :url :status :response-time ms' : 'combined', {
    ...(isLambda && {
      stream: {
        write: (line: string) => {
          const [method, url, status, responseTime] = line.trim().split(' ');
          console.log(
            JSON.stringify({ level: 'info', method, url, status: Number(status), responseTime })
          );
        },
      },
    }),
  })
);
app.use(express.json());

// Ungated on purpose: uptime checks must not need the proxy secret.
app.get('/health', (req: any, res: any) => {
  res.json({
    status: 'OK',
    message: 'StatTrak API is running!',
    timestamp: new Date().toISOString()
  });
});

// Everything below is reachable only through the Cloudflare proxy.
app.use('/api', proxySecretGate());

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

// Deliberately not league-scoped: the nav search spans every sport and
// resolves each result's league from its row.
app.use('/api/search', searchRoutes);

// Performance: /api/performance stays NBA (backward-compatible for the existing
// client); per-league mounts add MLB.
app.use('/api/performance', performanceRoutes);
app.use('/api/nba/performance', leagueMiddleware('nba'), performanceRoutes);
app.use('/api/mlb/performance', leagueMiddleware('mlb'), performanceRoutes);
