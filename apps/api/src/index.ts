import { config, setConfig } from './config.js';
import { openDb, setDb } from './db/sqlite.js';
import { recoverRuns } from './agents/runtime.js';
import { startScheduler } from './jobs/scheduler.js';
import { startWorker } from './jobs/worker.js';
import { getSettings } from './lib/settings.js';
import { buildServer } from './server.js';

// Entry point: database, HTTP server, job worker, scheduler, crash recovery (Solution Design §D7.2 – §D7.3).
if (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET is missing or shorter than 32 characters. Set it in .env, e.g.  SESSION_SECRET=$(openssl rand -hex 32)');
  process.exit(1);
}
setDb(openDb(config.DATABASE_PATH));
const s = getSettings();
if (s.timezone !== config.TZ) setConfig({ TZ: s.timezone });

const app = await buildServer();
await app.listen({ port: config.PORT, host: '127.0.0.1' });
if (config.WORKER_ENABLED) {
  startWorker();
  const n = recoverRuns();
  if (n) app.log.info(`Resumed ${n} interrupted agent run(s) from their checkpoints`);
}
if (config.SCHEDULER_ENABLED) startScheduler();
app.log.info(`StockPilot AI API on http://127.0.0.1:${config.PORT} — Gemini: ${config.GEMINI_API_KEY ? 'key set' : 'no key (deterministic mode)'}, email: ${config.BREVO_API_KEY ? 'Brevo' : 'outbox only'}`);
