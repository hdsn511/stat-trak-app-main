import serverlessHttp from 'serverless-http';
import { app } from './app';

// Buffered API Gateway (HTTP API) entry point. The scheduler never runs here —
// pipeline jobs are separate Lambdas driven by EventBridge (see infra/jobs.config.ts).
export const handler = serverlessHttp(app);
