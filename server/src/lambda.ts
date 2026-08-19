import { app } from './app';

/**
 * Lambda entrypoint, for the AWS Lambda Web Adapter layer.
 *
 * LWA is code-agnostic: it runs this as an ordinary HTTP server and translates
 * Function URL invocations into requests against it, so the Express app needs no
 * adapter shim and behaves exactly as it does locally.
 *
 * No dotenv here — Lambda supplies configuration as real environment variables.
 * No scheduler here — see server.ts.
 */
const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(JSON.stringify({ level: 'info', msg: `listening on ${PORT}` }));
});
